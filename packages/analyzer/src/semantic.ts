import ts from 'typescript';
import { createHash, randomUUID } from 'node:crypto';
import type {
  AnalysisConfidence,
  AnalysisDiagnostic,
  AnalysisGraphEdge,
  AnalysisGraphNode,
  Finding,
  StaticAnalysisDetail,
  StaticAnalysisFinding,
  SourceReference,
} from '@devanalyst/core';
import type { StaticProject } from './project.js';
import type { AnalysisBudget } from './analysis-options.js';
import { AnalysisStop } from './analysis-options.js';
import { conditionsOf, evidenceOf, isFunction, sourceOf, textOf, unwrap } from './syntax.js';
export interface FunctionTarget {
  readonly fn: ts.FunctionLikeDeclaration;
  readonly confidence: AnalysisConfidence;
}
export interface ComponentInfo {
  readonly node: ts.Node;
  readonly fn: ts.FunctionLikeDeclaration | null;
  readonly id: string;
  readonly name: string;
  readonly props: string[];
  readonly exports: { file: string; name: string }[];
  readonly inferred?: boolean;
}
export interface PropBinding {
  readonly component: ComponentInfo;
  readonly name: string;
  readonly expression: ts.Expression;
  readonly source: ts.Node;
}
export class SemanticModel {
  readonly nodes = new Map<string, AnalysisGraphNode>();
  readonly edges = new Map<string, AnalysisGraphEdge>();
  readonly findings = new Map<string, StaticAnalysisFinding>();
  readonly components = new Map<ts.Node, ComponentInfo>();
  readonly propBindings: PropBinding[] = [];
  readonly functions: ts.FunctionLikeDeclaration[] = [];
  readonly calls: ts.CallExpression[] = [];
  readonly mutated = new Set<ts.Symbol>();
  readonly setters = new Map<ts.Symbol, string[]>();
  constructor(
    readonly project: StaticProject,
    readonly budget: AnalysisBudget,
    readonly diagnostics: AnalysisDiagnostic[],
  ) {}
  diagnostic(code: string, message: string, node?: ts.Node): void {
    if (this.diagnostics.length < 100)
      this.diagnostics.push({ code, message, source: node ? sourceOf(node) : null });
  }
  symbol(node: ts.Node): ts.Symbol | undefined {
    return this.project.checker.getSymbolAtLocation(
      ts.isPropertyAccessExpression(node) ? node.name : node,
    );
  }
  canonical(symbol: ts.Symbol): ts.Symbol {
    try {
      return symbol.flags & ts.SymbolFlags.Alias
        ? this.project.checker.getAliasedSymbol(symbol)
        : symbol;
    } catch {
      return symbol;
    }
  }
  external(
    node: ts.Node,
    seen = new Set<ts.Symbol>(),
  ): { module: string; name: string; member: string | null } | null {
    node = unwrap(node);
    if (ts.isPropertyAccessExpression(node)) {
      const root = this.external(node.expression, seen);
      return root ? { ...root, member: node.name.text } : null;
    }
    const symbol = this.symbol(node);
    if (!symbol || seen.has(symbol) || seen.size > 12 || this.mutated.has(symbol)) return null;
    seen.add(symbol);
    for (const decl of symbol.declarations ?? []) {
      if (ts.isImportSpecifier(decl) || ts.isImportClause(decl) || ts.isNamespaceImport(decl)) {
        let parent: ts.Node | undefined = decl.parent;
        while (parent && !ts.isImportDeclaration(parent)) parent = parent.parent;
        if (
          parent &&
          ts.isImportDeclaration(parent) &&
          (parent.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword ||
            (ts.isImportSpecifier(decl) && decl.isTypeOnly))
        )
          return null;
        if (
          parent &&
          ts.isImportDeclaration(parent) &&
          this.project.imports
            .get(sourceOf(parent).file)
            ?.some((item) => item.node === parent && item.target !== null)
        )
          return null;
        if (
          parent &&
          ts.isImportDeclaration(parent) &&
          ts.isStringLiteralLike(parent.moduleSpecifier)
        )
          return {
            module: parent.moduleSpecifier.text,
            name: ts.isImportSpecifier(decl)
              ? (decl.propertyName?.text ?? decl.name.text)
              : ts.isNamespaceImport(decl)
                ? '*'
                : 'default',
            member: null,
          };
      }
      if (ts.isVariableDeclaration(decl) && decl.initializer && this.constant(decl))
        return this.external(decl.initializer, seen);
    }
    return null;
  }
  reactCall(call: ts.CallExpression): string | null {
    const origin = this.external(call.expression);
    return origin?.module === 'react' ? (origin.member ?? origin.name) : null;
  }
  constant(node: ts.VariableDeclaration): boolean {
    return !!(node.parent.flags & ts.NodeFlags.Const);
  }
  target(expression: ts.Node, seen = new Set<ts.Symbol>()): FunctionTarget | null {
    expression = unwrap(expression);
    if (isFunction(expression))
      return expression.body ? { fn: expression, confidence: 'VERIFIED' } : null;
    if (
      ts.isCallExpression(expression) &&
      ['useCallback', 'memo', 'forwardRef'].includes(this.reactCall(expression) ?? '')
    ) {
      const first = expression.arguments[0];
      return first ? this.target(first, seen) : null;
    }
    const original = this.symbol(expression);
    if (!original || seen.has(original) || seen.size > 16 || this.mutated.has(original))
      return null;
    seen.add(original);
    for (const declaration of original.declarations ?? []) {
      if (
        (ts.isImportSpecifier(declaration) &&
          (declaration.isTypeOnly ||
            declaration.parent.parent.phaseModifier === ts.SyntaxKind.TypeKeyword)) ||
        (ts.isImportClause(declaration) && declaration.phaseModifier === ts.SyntaxKind.TypeKeyword)
      )
        return null;
    }
    const symbol = this.canonical(original);
    if (this.mutated.has(symbol)) return null;
    for (const decl of symbol.declarations ?? []) {
      if (ts.isExportAssignment(decl)) return this.target(decl.expression, seen);
      if (isFunction(decl) && decl.body)
        return {
          fn: decl,
          confidence:
            ts.isMethodDeclaration(decl) ||
            ts.isGetAccessorDeclaration(decl) ||
            ts.isSetAccessorDeclaration(decl)
              ? 'INFERRED'
              : 'VERIFIED',
        };
      if ((ts.isVariableDeclaration(decl) || ts.isPropertyAssignment(decl)) && decl.initializer) {
        const found = this.target(decl.initializer, seen);
        if (found)
          return {
            fn: found.fn,
            confidence:
              ts.isVariableDeclaration(decl) && this.constant(decl) ? found.confidence : 'INFERRED',
          };
      }
    }
    return null;
  }
  global(node: ts.Node): boolean {
    node = unwrap(node);
    if (ts.isIdentifier(node)) return !this.symbol(node);
    if (ts.isPropertyAccessExpression(node)) return this.global(node.expression);
    return false;
  }
  id(kind: AnalysisGraphNode['kind'], node: ts.Node | null, name: string): string {
    return createHash('sha256')
      .update(
        `${kind}\0${node ? node.getSourceFile().fileName + ':' + node.getStart() : ''}\0${name}`,
      )
      .digest('hex');
  }
  graphNode(kind: AnalysisGraphNode['kind'], node: ts.Node | null, name: string): string {
    this.budget.check();
    const id = this.id(kind, node, name);
    if (!this.nodes.has(id)) {
      if (this.nodes.size >= this.budget.limits.maxGraphNodes)
        throw new AnalysisStop('GRAPH_NODE_LIMIT');
      this.nodes.set(id, {
        id,
        kind,
        name: name.slice(0, 512),
        source: node ? sourceOf(node) : null,
      });
    }
    return id;
  }
  edge(
    from: string,
    to: string,
    kind: AnalysisGraphEdge['kind'],
    node: ts.Node,
    confidence: AnalysisConfidence = 'VERIFIED',
  ): void {
    const key = `${from}:${to}:${kind}:${node.getStart()}`;
    if (!this.edges.has(key)) {
      if (this.edges.size >= this.budget.limits.maxGraphEdges)
        throw new AnalysisStop('GRAPH_EDGE_LIMIT');
      this.edges.set(key, { from, to, kind, confidence, evidence: evidenceOf(node) });
    }
  }
  fact(
    node: ts.Node,
    detail: StaticAnalysisDetail,
    confidence: AnalysisConfidence,
    explanation: string,
    subjectId?: string,
    trace?: { confidence: AnalysisConfidence; path: readonly SourceReference[] },
  ): StaticAnalysisFinding {
    this.budget.check();
    const key = `${node.getSourceFile().fileName}:${node.getStart()}:${JSON.stringify(detail)}`;
    const previous = this.findings.get(key);
    if (previous) {
      if (
        trace &&
        previous.traces.length < 8 &&
        !previous.traces.some((item) => JSON.stringify(item.path) === JSON.stringify(trace.path))
      )
        this.findings.set(key, { ...previous, traces: [...previous.traces, trace] });
      return this.findings.get(key) ?? previous;
    }
    if (this.findings.size >= this.budget.limits.maxFindings)
      throw new AnalysisStop('FINDING_LIMIT');
    const type: Finding['type'] =
      detail.kind === 'api'
        ? 'api-call'
        : detail.kind === 'navigation'
          ? 'navigation'
          : detail.kind === 'handler'
            ? 'event-handler'
            : ['condition', 'visibility', 'disabled'].includes(detail.kind)
              ? 'render-condition'
              : detail.kind === 'state'
                ? 'state-change'
                : ['component', 'prop', 'relationship'].includes(detail.kind)
                  ? 'component'
                  : 'explanation';
    const finding: StaticAnalysisFinding = {
      id: randomUUID(),
      type,
      confidence,
      explanation: explanation.slice(0, 4096),
      evidence: evidenceOf(node),
      analyzedAt: this.budget.timestamp,
      cacheStatus: 'miss',
      subjectId:
        subjectId ??
        this.graphNode(
          isFunction(node) ? 'function' : ts.isCallExpression(node) ? 'call' : 'element',
          node,
          (ts.isCallExpression(node) ? textOf(node.expression) : textOf(node)).slice(0, 96),
        ),
      detail,
      conditions: conditionsOf(node),
      execution: 'not-evaluated',
      traces: trace ? [trace] : [],
    };
    this.findings.set(key, finding);
    return finding;
  }
  functionId(fn: ts.FunctionLikeDeclaration): string {
    return this.graphNode('function', fn, this.functionName(fn));
  }
  functionName(fn: ts.FunctionLikeDeclaration): string {
    if (fn.name) return textOf(fn.name);
    if (
      ts.isFunctionDeclaration(fn) &&
      fn.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
    )
      return 'default';
    if (ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name))
      return fn.parent.name.text;
    return '<anonymous>';
  }
  owner(node: ts.Node): ComponentInfo | null {
    for (let parent: ts.Node | undefined = node; parent; parent = parent.parent) {
      const found = this.components.get(parent);
      if (found) return found;
    }
    return null;
  }
  componentFor(expression: ts.Node): ComponentInfo | null {
    const target = this.target(expression);
    if (target) {
      const found = this.components.get(target.fn);
      if (found) return found;
    }
    const symbol = this.symbol(expression);
    for (const declaration of symbol ? (this.canonical(symbol).declarations ?? []) : []) {
      const found = this.components.get(declaration);
      if (found) return found;
    }
    return null;
  }
  index(): void {
    for (const sf of this.project.files.values()) {
      const stack: ts.Node[] = [sf];
      while (stack.length) {
        this.budget.check();
        const node = stack.pop();
        if (!node) break;
        if (
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        ) {
          const symbol = this.symbol(node.left);
          if (symbol) this.mutated.add(symbol);
        }
        if (
          (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
          [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)
        ) {
          const symbol = this.symbol(node.operand);
          if (symbol) this.mutated.add(symbol);
        }
        if (isFunction(node) && node.body) this.functions.push(node);
        if (ts.isCallExpression(node)) this.calls.push(node);
        ts.forEachChild(node, (child) => {
          stack.push(child);
        });
      }
    }
    for (const fn of this.functions) {
      let name = this.functionName(fn),
        declaration: ts.Node = fn;
      if (name === '<anonymous>') {
        let parent = fn.parent;
        while (ts.isCallExpression(parent) || ts.isParenthesizedExpression(parent))
          parent = parent.parent;
        if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
          name = parent.name.text;
          declaration = parent;
        } else if (ts.isExportAssignment(parent)) {
          name = 'default';
          declaration = parent;
        }
      }
      let hasJsx = false;
      const visit = (node: ts.Node): void => {
        if (isFunction(node) && node !== fn) return;
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node))
          hasJsx = true;
        ts.forEachChild(node, visit);
      };
      if (fn.body) visit(fn.body);
      const mapReturnsJsx = (expression: ts.Node): boolean => {
        expression = unwrap(expression);
        if (
          !ts.isCallExpression(expression) ||
          !ts.isPropertyAccessExpression(expression.expression) ||
          expression.expression.name.text !== 'map'
        )
          return false;
        return expression.arguments.some((argument) => {
          if (!isFunction(argument) || !argument.body) return false;
          let jsx = false;
          const pending: ts.Node[] = [argument.body];
          while (pending.length) {
            this.budget.check();
            const node = pending.pop();
            if (!node) break;
            if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node))
              jsx = true;
            ts.forEachChild(node, (child) => {
              pending.push(child);
            });
          }
          return jsx;
        });
      };
      const inferredJsx =
        !hasJsx &&
        !!fn.body &&
        (ts.isBlock(fn.body)
          ? fn.body.statements.some(
              (statement) =>
                ts.isReturnStatement(statement) &&
                !!statement.expression &&
                mapReturnsJsx(statement.expression),
            )
          : mapReturnsJsx(fn.body));
      if ((/^[A-Z]/.test(name) || name === 'default') && (hasJsx || inferredJsx)) {
        const props: string[] = [];
        for (const parameter of fn.parameters) {
          if (ts.isObjectBindingPattern(parameter.name))
            for (const prop of parameter.name.elements)
              props.push(prop.propertyName ? textOf(prop.propertyName) : textOf(prop.name));
          else if (parameter.type) {
            const type = this.project.checker.getTypeFromTypeNode(parameter.type);
            for (const prop of type.getProperties().slice(0, 64)) props.push(prop.name);
          }
        }
        const id = this.graphNode('component', declaration, name),
          info = {
            node: declaration,
            fn,
            id,
            name,
            props: props.slice(0, 64),
            exports: [],
            inferred: inferredJsx,
          };
        this.components.set(fn, info);
        this.components.set(declaration, info);
      }
    }
    // Classes and declarations used directly as JSX components, including components returning helper output.
    for (const sf of this.project.files.values()) {
      const stack: ts.Node[] = [sf];
      while (stack.length) {
        const node = stack.pop();
        if (!node) break;
        this.budget.check();
        if (ts.isClassDeclaration(node) && node.name && /^[A-Z]/.test(node.name.text)) {
          const members = node.members.some(
            (member) => ts.isMethodDeclaration(member) && member.name.getText() === 'render',
          );
          if (members) {
            const info: ComponentInfo = {
              node,
              fn: null,
              id: this.graphNode('component', node, node.name.text),
              name: node.name.text,
              props: [],
              exports: [],
              inferred: !node.heritageClauses?.some((clause) =>
                clause.types.some((type) => {
                  const origin = this.external(type.expression);
                  return (
                    origin?.module === 'react' &&
                    ['Component', 'PureComponent'].includes(origin.member ?? origin.name)
                  );
                }),
              ),
            };
            this.components.set(node, info);
          }
        }
        if (
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          /^[A-Z]/.test(node.tagName.getText())
        ) {
          const target = this.target(node.tagName);
          if (target && !this.components.has(target.fn)) {
            const name = node.tagName.getText();
            const info: ComponentInfo = {
              node: target.fn,
              fn: target.fn,
              id: this.graphNode('component', target.fn, name),
              name,
              props: [],
              exports: [],
              inferred: target.confidence !== 'VERIFIED',
            };
            this.components.set(target.fn, info);
          }
        }
        ts.forEachChild(node, (child) => {
          stack.push(child);
        });
      }
    }
    for (const [file, sf] of this.project.files) {
      const module = this.project.checker.getSymbolAtLocation(sf);
      if (!module) continue;
      for (const item of this.project.checker.getExportsOfModule(module).slice(0, 128)) {
        const symbol = this.canonical(item);
        for (const decl of symbol.declarations ?? []) {
          const info =
            this.components.get(decl) ??
            (ts.isVariableDeclaration(decl) && decl.initializer
              ? this.componentFor(decl.initializer)
              : null);
          if (
            info &&
            !info.exports.some((value) => value.file === file && value.name === item.name)
          )
            info.exports.push({ file, name: item.name });
        }
      }
    }
    for (const info of new Set(this.components.values()))
      this.fact(
        info.node,
        { kind: 'component', name: info.name, exports: info.exports, props: info.props },
        info.inferred ? 'INFERRED' : 'VERIFIED',
        info.inferred
          ? 'This declaration is a component candidate from source shape or a possible callable target; component semantics are inferred, not executed.'
          : 'Source declares or references this component through JSX; runtime rendering is not evaluated.',
        info.id,
      );
    for (const [file, sf] of this.project.files) {
      const from = this.graphNode('module', sf, file);
      for (const item of this.project.imports.get(file) ?? []) {
        const target = item.target ? this.project.files.get(item.target) : undefined;
        const to = target
          ? this.graphNode('module', target, item.target ?? '')
          : this.graphNode('external', null, item.specifier);
        this.edge(from, to, 'imports', item.node, target ? 'VERIFIED' : 'UNKNOWN');
        if (!target && item.specifier.startsWith('.'))
          this.diagnostic(
            'IMPORT_UNAVAILABLE',
            'Relative import is missing, excluded, malformed or outside the permitted graph.',
            item.node,
          );
      }
    }
  }
  propCandidates(expression: ts.Node): PropBinding[] {
    expression = unwrap(expression);
    let name: string | null = null,
      owner: ComponentInfo | null = null;
    if (ts.isPropertyAccessExpression(expression)) {
      const symbol = this.symbol(expression.expression);
      const decl = symbol?.declarations?.find(ts.isParameter);
      if (decl) {
        name = expression.name.text;
        owner = this.owner(decl);
      }
    }
    if (ts.isIdentifier(expression)) {
      const symbol = this.symbol(expression);
      const declaration = symbol?.declarations?.find(ts.isBindingElement);
      if (declaration && ts.isParameter(declaration.parent.parent)) {
        name = declaration.propertyName
          ? textOf(declaration.propertyName)
          : textOf(declaration.name);
        owner = this.owner(declaration);
      }
    }
    return name && owner
      ? this.propBindings
          .filter((binding) => binding.component === owner && binding.name === name)
          .slice(0, 8)
      : [];
  }
}
