import { AnalysisStop } from './analysis-options.js';
import { randomUUID, createHash } from 'node:crypto';
import ts from 'typescript';
import { NodeTypes } from '@vue/compiler-dom';
import type {
  StaticAnalysisDetail,
  StaticAnalysisFinding,
  StaticCondition,
  Evidence,
  AnalysisConfidence,
} from '@sonht113/core';
import type { SemanticModel } from './semantic.js';
import type { TraceRoot } from './extract.js';
import { parseVueSource } from './vue-source.js';
import { sourceOf, textOf, isFunction } from './syntax.js';
import { valueBindings } from './value-source.js';
/** Vue template syntax and explicit Composition API imports; source-only relationships, never runtime values. */
export function extractVueStructure(model: SemanticModel): TraceRoot[] {
  const roots: TraceRoot[] = [];
  const digest = (text: string) => createHash('sha256').update(text).digest('hex');
  function fact(
    evidence: Evidence,
    detail: StaticAnalysisDetail,
    subjectId: string,
    conditions: readonly StaticCondition[] = [],
    confidence: AnalysisConfidence = 'VERIFIED',
  ) {
    model.budget.check();
    if (model.findings.size >= model.budget.limits.maxFindings)
      throw new AnalysisStop('FINDING_LIMIT');
    const type: StaticAnalysisFinding['type'] =
      detail.kind === 'handler'
        ? 'event-handler'
        : ['condition', 'visibility', 'disabled'].includes(detail.kind)
          ? 'render-condition'
          : detail.kind === 'state'
            ? 'state-change'
            : detail.kind === 'component' || detail.kind === 'relationship'
              ? 'component'
              : 'explanation';
    const value: StaticAnalysisFinding = {
      id: randomUUID(),
      type,
      confidence,
      explanation:
        'Explicit Vue source syntax/reference; runtime execution and current values are not evaluated.',
      evidence,
      analyzedAt: model.budget.timestamp,
      cacheStatus: 'miss',
      subjectId,
      detail,
      conditions,
      execution: 'not-evaluated',
      traces: [],
    };
    model.findings.set(value.id, value);
  }
  for (const [file, sf] of model.project.files) {
    if (!file.endsWith('.vue')) continue;
    const original = model.project.originals.get(file);
    if (!original) continue;
    const parsed = parseVueSource(original, file);
    const component = digest('vue-component:' + file);
    const source = parsed.descriptor.scriptSetup
      ? {
          file,
          start: parsed.elements[0]?.source.start ?? { line: 1, column: 1 },
          end: parsed.elements.at(-1)?.source.end ?? { line: 1, column: 1 },
        }
      : { file, start: null, end: null };
    model.nodes.set(component, {
      id: component,
      kind: 'component',
      name:
        file
          .split('/')
          .at(-1)
          ?.replace(/\.vue$/, '') ?? file,
      source,
    });
    const definition = parsed.descriptor.scriptSetup;
    if (definition?.content.trim())
      fact(
        {
          source: {
            file,
            start: { line: definition.loc.start.line, column: definition.loc.start.column },
            end: { line: definition.loc.end.line, column: definition.loc.end.column },
          },
          code: definition.content.trim().slice(0, 16384),
        },
        {
          kind: 'component',
          name:
            file
              .split('/')
              .at(-1)
              ?.replace(/\.vue$/, '') ?? file,
          exports: [{ file, name: 'default' }],
          props: [],
        },
        component,
      );
    const names = new Map<string, ts.Identifier[]>();
    for (const statement of sf.statements) {
      const add = (name: ts.BindingName | ts.ModuleExportName | undefined) => {
        if (name && ts.isIdentifier(name)) {
          const values = names.get(name.text) ?? [];
          values.push(name);
          names.set(name.text, values);
        }
      };
      if (ts.isFunctionDeclaration(statement)) add(statement.name);
      if (ts.isVariableStatement(statement))
        for (const declaration of statement.declarationList.declarations) add(declaration.name);
      if (ts.isImportDeclaration(statement)) {
        add(statement.importClause?.name);
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings))
          for (const entry of bindings.elements) add(entry.name);
      }
    }
    for (const entry of parsed.elements) {
      model.budget.node();
      const { node, source, conditions, shadowed } = entry;
      const subject = digest(`vue-element:${file}:${node.loc.start.offset}`);
      if (model.nodes.size >= model.budget.limits.maxGraphNodes)
        throw new AnalysisStop('GRAPH_NODE_LIMIT');
      model.nodes.set(subject, { id: subject, kind: 'element', name: node.tag, source });
      const elementEvidence = { source, code: node.loc.source.slice(0, 16384) };
      if (model.edges.size >= model.budget.limits.maxGraphEdges)
        throw new AnalysisStop('GRAPH_EDGE_LIMIT');
      model.edges.set(component + subject, {
        from: component,
        to: subject,
        kind: 'renders',
        confidence: 'VERIFIED',
        evidence: elementEvidence,
      });
      fact(
        elementEvidence,
        { kind: 'relationship', parent: component, child: null, tag: node.tag },
        subject,
        conditions,
      );
      for (const value of conditions)
        fact(
          value.evidence,
          { kind: 'condition', expression: value.expression, branch: value.branch },
          subject,
          conditions,
        );
      const displayValue = (expression: string, evidence: Evidence) => {
        const name = /^\s*([A-Za-z_$][\w$]*)/.exec(expression)?.[1];
        const identifiers = name && !shadowed.has(name) ? names.get(name) : undefined;
        const identifier = identifiers?.length === 1 ? identifiers[0] : undefined;
        fact(
          evidence,
          {
            kind: 'value',
            expression,
            bindings: identifier ? valueBindings(model, identifier) : [],
          },
          subject,
          conditions,
        );
      };
      for (const content of node.children)
        if (content.type === NodeTypes.INTERPOLATION)
          displayValue(content.content.loc.source, {
            source: parsed.range(content.loc.start.offset, content.loc.end.offset),
            code: content.loc.source,
          });
      for (const prop of node.props) {
        if (
          node.tag === 'a' &&
          prop.type === NodeTypes.ATTRIBUTE &&
          prop.name === 'href' &&
          prop.value
        )
          fact(
            {
              source: parsed.range(prop.loc.start.offset, prop.loc.end.offset),
              code: prop.loc.source,
            },
            {
              kind: 'navigation',
              mechanism: 'href',
              destination: prop.value.content,
              expression: prop.value.loc.source,
            },
            subject,
            conditions,
          );
        if (prop.type !== NodeTypes.DIRECTIVE) continue;
        const evidence = {
          source: parsed.range(prop.loc.start.offset, prop.loc.end.offset),
          code: prop.loc.source,
        };
        const expression = prop.exp?.type === NodeTypes.SIMPLE_EXPRESSION ? prop.exp.content : '';
        if (
          node.tag === 'a' &&
          prop.name === 'bind' &&
          prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION &&
          prop.arg.content === 'href'
        )
          fact(
            evidence,
            { kind: 'navigation', mechanism: ':href', destination: null, expression },
            subject,
            conditions,
            'INFERRED',
          );
        if (
          ['text', 'model'].includes(prop.name) ||
          (prop.name === 'bind' &&
            prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION &&
            ['value', 'alt', 'title', 'placeholder', 'aria-label'].includes(prop.arg.content))
        )
          displayValue(expression, evidence);
        if (prop.name === 'show')
          fact(
            evidence,
            { kind: 'visibility', attribute: 'v-show', expression },
            subject,
            conditions,
          );
        if (
          prop.name === 'bind' &&
          prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION &&
          prop.arg.content === 'disabled'
        )
          fact(
            evidence,
            { kind: 'disabled', attribute: ':disabled', expression },
            subject,
            conditions,
          );
        if (prop.name !== 'on') continue;
        const event =
          prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION && prop.arg.isStatic
            ? prop.arg.content
            : 'UNKNOWN';
        const match = /^([A-Za-z_$][\w$]*)(?:\s*\([\s\S]*\))?$/.exec(expression.trim());
        const name = match?.[1],
          identifiers = name ? names.get(name) : undefined;
        const identifier =
          identifiers?.length === 1 && !shadowed.has(name ?? '') ? identifiers[0] : undefined;
        const target = identifier ? model.target(identifier) : null;
        const targetId = target ? model.functionId(target.fn) : null;
        fact(
          evidence,
          { kind: 'handler', event, expression, targetId },
          subject,
          conditions,
          target && event !== 'UNKNOWN' ? target.confidence : 'UNKNOWN',
        );
        if (target && targetId) {
          if (model.edges.size >= model.budget.limits.maxGraphEdges)
            throw new AnalysisStop('GRAPH_EDGE_LIMIT');
          model.edges.set(subject + targetId, {
            from: subject,
            to: targetId,
            kind: 'handler',
            confidence: target.confidence,
            evidence,
          });
          roots.push({
            expression: target.fn,
            subjectId: targetId,
            source: target.fn,
            confidence: target.confidence,
            edgeKind: 'calls',
          });
        }
      }
    }
    for (const call of model.calls.filter((call) => sourceOf(call).file === file)) {
      const external = model.external(call.expression);
      if (external?.module !== 'vue') continue;
      const name = external.member ?? external.name;
      if (
        ![
          'ref',
          'shallowRef',
          'reactive',
          'shallowReactive',
          'computed',
          'watch',
          'watchEffect',
          'onMounted',
          'onUnmounted',
          'onActivated',
          'onDeactivated',
        ].includes(name)
      )
        continue;
      model.fact(
        call,
        { kind: 'hook', name: 'Vue.' + name, dependencies: null },
        'VERIFIED',
        'Explicit Vue Composition API source call; reactive values and lifecycle execution are not observed.',
        component,
      );
      if (
        ['ref', 'shallowRef', 'reactive', 'shallowReactive'].includes(name) &&
        ts.isVariableDeclaration(call.parent)
      )
        model.fact(
          call.parent,
          {
            kind: 'state',
            operation: 'declaration',
            names: [textOf(call.parent.name)],
            expression: textOf(call),
          },
          'VERIFIED',
          'Vue reactive declaration from an explicit import; runtime value is unavailable.',
          component,
        );
      const callback = call.arguments[name === 'watch' ? 1 : 0];
      if (
        callback &&
        [
          'watch',
          'watchEffect',
          'onMounted',
          'onUnmounted',
          'onActivated',
          'onDeactivated',
        ].includes(name)
      )
        roots.push({
          expression: callback,
          subjectId: component,
          source: call,
          confidence: 'VERIFIED',
          edgeKind: 'callback',
        });
    }
    const stack: ts.Node[] = [sf];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      model.budget.node();
      if (
        (ts.isBinaryExpression(node) &&
          node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
        ((ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
          (node.operator === ts.SyntaxKind.PlusPlusToken ||
            node.operator === ts.SyntaxKind.MinusMinusToken))
      ) {
        const left = ts.isBinaryExpression(node) ? node.left : node.operand;
        if (ts.isPropertyAccessExpression(left) && left.name.text === 'value') {
          const symbol = model.symbol(left.expression),
            declaration = symbol?.declarations?.[0];
          if (
            declaration &&
            ts.isVariableDeclaration(declaration) &&
            declaration.initializer &&
            ts.isCallExpression(declaration.initializer)
          ) {
            const origin = model.external(declaration.initializer.expression);
            if (
              origin?.module === 'vue' &&
              ['ref', 'shallowRef', 'computed'].includes(origin.member ?? origin.name)
            ) {
              let owner: ts.Node | undefined = node.parent;
              while (owner && !isFunction(owner)) owner = owner.parent;
              model.fact(
                node,
                {
                  kind: 'state',
                  operation: 'update',
                  names: [textOf(left.expression)],
                  expression: textOf(node),
                },
                'VERIFIED',
                'Source writes a Vue ref value; execution and effective value are not evaluated.',
                owner && isFunction(owner) ? model.functionId(owner) : component,
              );
            }
          }
        }
      }
      ts.forEachChild(node, (child) => {
        stack.push(child);
      });
    }
  }
  return roots;
}
