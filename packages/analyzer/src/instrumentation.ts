import { createHash } from 'node:crypto';
import ts from 'typescript';
import MagicString from 'magic-string';
import {
  workspacePathSchema,
  type ComponentIdentity,
  type MappingSite,
  type SourceModuleManifest,
  type SourceReference,
} from '@devanalyst/core';

export interface MappingDiagnostic {
  readonly code:
    | 'EXISTING_REF'
    | 'SPREAD_PROPS'
    | 'CUSTOM_ELEMENT'
    | 'DYNAMIC_ELEMENT_REWRITE'
    | 'PARSE_ERROR'
    | 'LIMIT_EXCEEDED'
    | 'NON_REACT_JSX';
  readonly source: SourceReference | null;
}
export interface InstrumentationResult {
  readonly code: string;
  readonly map: {
    readonly version: 3;
    readonly sources: string[];
    readonly sourcesContent: (string | null)[];
    readonly names: string[];
    readonly mappings: string;
  } | null;
  readonly manifest: SourceModuleManifest;
  readonly diagnostics: readonly MappingDiagnostic[];
}
function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Add ref-only provenance to original, authorized React JSX. No source I/O or application evaluation. */
export function instrumentReactSource(
  code: string,
  file: string,
  runtimeUrl: string,
): InstrumentationResult {
  const path = workspacePathSchema.parse(file);
  if (path !== file || file.includes('\\'))
    throw new Error('Expected a normalized relative source file');
  if (!/^\/[\w/.-]+\/mapping-runtime\.js$/.test(runtimeUrl))
    throw new Error('Invalid development runtime URL');
  const manifest: SourceModuleManifest = {
    version: 1,
    moduleId: hash(file),
    revision: hash(code),
    sites: [],
  };
  const diagnostics: MappingDiagnostic[] = [];
  const sites: MappingSite[] = [];
  const result = (
    text = code,
    map: InstrumentationResult['map'] = null,
  ): InstrumentationResult => ({ code: text, map, manifest: { ...manifest, sites }, diagnostics });
  if (code.length > 256 * 1024) {
    diagnostics.push({ code: 'LIMIT_EXCEEDED', source: null });
    return result();
  }
  const ast = ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.TSX,
  );
  // Public compiler diagnostics API, including malformed JSX, without building/typechecking a project.
  const diagnosticsProgram = ts.transpileModule(code, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022 },
  });
  if (
    diagnosticsProgram.diagnostics?.some(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    )
  ) {
    diagnostics.push({ code: 'PARSE_ERROR', source: null });
    return result();
  }
  if (/@jsxImportSource\s+(?!react\b)\S+|@jsxRuntime\s+classic|@jsx\s+[^\s*]+/.test(code)) {
    diagnostics.push({ code: 'NON_REACT_JSX', source: null });
    return result();
  }
  let dynamicRewrite = false;
  function inspect(node: ts.Node): void {
    if (ts.isIdentifier(node) && ['cloneElement', 'createElement'].includes(node.text))
      dynamicRewrite = true;
    ts.forEachChild(node, inspect);
  }
  inspect(ast);
  if (dynamicRewrite) {
    diagnostics.push({ code: 'DYNAMIC_ELEMENT_REWRITE', source: null });
    return result();
  }
  function source(node: ts.Node): SourceReference {
    const start = ast.getLineAndCharacterOfPosition(node.getStart(ast));
    const end = ast.getLineAndCharacterOfPosition(node.end);
    return {
      file,
      start: { line: start.line + 1, column: start.character + 1 },
      end: { line: end.line + 1, column: end.character + 1 },
    };
  }
  const componentOwners = new Map<ts.Node, ComponentIdentity>();
  const componentOrdinals = new Map<string, number>();
  function owner(node: ts.Node): ComponentIdentity | null {
    for (
      let current: ts.Node | undefined = node.parent;
      current && current !== ast;
      current = current.parent
    ) {
      let name: string | undefined;
      if (
        ts.isFunctionDeclaration(current) ||
        ts.isFunctionExpression(current) ||
        ts.isClassDeclaration(current) ||
        ts.isClassExpression(current)
      )
        name = current.name?.text;
      if (
        ts.isVariableDeclaration(current) &&
        ts.isIdentifier(current.name) &&
        current.initializer &&
        (ts.isArrowFunction(current.initializer) ||
          ts.isFunctionExpression(current.initializer) ||
          (ts.isCallExpression(current.initializer) &&
            /(?:^|\.)(?:memo|forwardRef)$/.test(current.initializer.expression.getText(ast))))
      )
        name = current.name.text;
      if (name && /^[A-Z]/.test(name)) {
        const parents: string[] = [];
        for (let parent = current.parent; parent && parent !== ast; parent = parent.parent) {
          if ((ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent)) && parent.name)
            parents.unshift(parent.name.text);
        }
        const qualified = [...parents, name].join('.');
        const existing = componentOwners.get(current);
        if (existing) return existing;
        const ordinal = componentOrdinals.get(qualified) ?? 0;
        componentOrdinals.set(qualified, ordinal + 1);
        const identity = {
          id: hash(`${file}\0component\0${qualified}\0${ordinal}`),
          name: qualified,
          source: source(current),
        };
        componentOwners.set(current, identity);
        return identity;
      }
      if (ts.isExportAssignment(current))
        return {
          id: hash(`${file}\0component\0default`),
          name: 'default',
          source: source(current),
        };
      if (
        ts.isFunctionDeclaration(current) &&
        !current.name &&
        current.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
      )
        return {
          id: hash(`${file}\0component\0default`),
          name: 'default',
          source: source(current),
        };
    }
    return null;
  }
  const editor = new MagicString(code);
  const identifierNames = new Set<string>();
  function names(node: ts.Node): void {
    if (ts.isIdentifier(node)) identifierNames.add(node.text);
    ts.forEachChild(node, names);
  }
  names(ast);
  function fresh(base: string): string {
    let name = base;
    while (identifierNames.has(name)) name += '_';
    identifierNames.add(name);
    return name;
  }
  const register = fresh('__devanalystRegister');
  const binding = fresh('__devanalystBinding');
  const ordinals = new Map<string, number>();
  let limitExceeded = false;
  function visit(node: ts.Node): void {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(ast);
      if (/^[a-z][a-zA-Z0-9-]*$/.test(tag)) {
        const component = owner(node);
        const scope = `${component?.id ?? 'module'}:${tag}`;
        const ordinal = ordinals.get(scope) ?? 0;
        ordinals.set(scope, ordinal + 1);
        const location = source(ts.isJsxOpeningElement(node) ? node.parent : node);
        const properties = node.attributes.properties;
        const reason = tag.includes('-')
          ? 'CUSTOM_ELEMENT'
          : properties.some(ts.isJsxSpreadAttribute)
            ? 'SPREAD_PROPS'
            : properties.some(
                  (property) => ts.isJsxAttribute(property) && property.name.getText(ast) === 'ref',
                )
              ? 'EXISTING_REF'
              : null;
        if (reason) {
          if (diagnostics.length < 100) diagnostics.push({ code: reason, source: location });
          else limitExceeded = true;
        } else if (sites.length >= 2048) limitExceeded = true;
        else {
          const site: MappingSite = {
            id: hash(`${file}\0${scope}\0${ordinal}`),
            tag,
            source: location,
            component,
          };
          sites.push(site);
          editor.appendLeft(node.tagName.end, ` ref={${binding}.ref(${sites.length - 1})}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (limitExceeded) {
    sites.length = 0;
    diagnostics.length = 0;
    diagnostics.push({ code: 'LIMIT_EXCEEDED', source: null });
    return result();
  }
  if (!sites.length) return result();
  // Preserve directive prologues and every original byte; never reprint JSX/expressions.
  let insertion = code.startsWith('#!') ? code.indexOf('\n') + 1 : 0;
  for (const statement of ast.statements) {
    if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression))
      insertion = statement.end;
    else break;
  }
  const payload = JSON.stringify({ ...manifest, sites })
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
  editor.appendLeft(
    insertion,
    `\nimport {registerSourceModule as ${register}} from ${JSON.stringify(runtimeUrl)};\nconst ${binding}=${register}(${payload});\nif(import.meta.hot){import.meta.hot.on("devanalyst:source-invalidated",${binding}.invalidateSource);import.meta.hot.dispose(()=>{${binding}.invalidate();import.meta.hot.off("devanalyst:source-invalidated",${binding}.invalidateSource);});import.meta.hot.prune(${binding}.invalidate);}\n`,
  );
  const map = editor.generateMap({ source: file, includeContent: true, hires: true });
  return result(editor.toString(), {
    version: 3,
    sources: map.sources,
    sourcesContent: map.sourcesContent ?? [code],
    names: map.names,
    mappings: map.mappings,
  });
}
