import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import MagicString from 'magic-string';
import { parse as parseSFC } from '@vue/compiler-sfc';
import {
  parse,
  NodeTypes,
  ElementTypes,
  type ElementNode,
  type TemplateChildNode,
  type DirectiveNode,
} from '@vue/compiler-dom';
import type {
  ComponentIdentity,
  SourceReference,
  StaticCondition,
  MappingSite,
} from '@sonht113/core';
import type { InstrumentationResult, MappingDiagnostic } from './instrumentation.js';
import type { SourceInspectionOrigin } from './source-inspection.js';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export interface VueElement {
  readonly node: ElementNode;
  readonly source: SourceReference;
  readonly conditions: readonly StaticCondition[];
  readonly shadowed: ReadonlySet<string>;
}
export function sourceRange(
  code: string,
  file: string,
  start: number,
  end: number,
): SourceReference {
  const point = (offset: number) => {
    const before = code.slice(0, offset).split('\n');
    return { line: before.length, column: (before.at(-1)?.length ?? 0) + 1 };
  };
  return { file, start: point(start), end: point(end) };
}
/** Original compiler locations, not generated render functions or React ref semantics. */
export function parseVueSource(code: string, file: string) {
  if (code.length > 256 * 1024) throw new Error('SFC size limit');
  const { descriptor, errors } = parseSFC(code, { filename: file });
  if (
    errors.length ||
    !descriptor.template ||
    descriptor.template.src ||
    (descriptor.template.lang && descriptor.template.lang !== 'html') ||
    descriptor.script?.src ||
    descriptor.scriptSetup?.src ||
    (descriptor.scriptSetup?.lang && !['ts', 'js'].includes(descriptor.scriptSetup.lang))
  )
    throw new Error('Unsupported SFC');
  const template = descriptor.template;
  const ast = parse(template.content, { comments: true });
  const offset = template.loc.start.offset;
  const range = (start: number, end: number) =>
    sourceRange(code, file, offset + start, offset + end);
  const elements: VueElement[] = [];
  let count = 0;
  const condition = (
    directive: DirectiveNode,
    branch: StaticCondition['branch'],
  ): StaticCondition | null =>
    directive.exp?.type === NodeTypes.SIMPLE_EXPRESSION
      ? {
          expression: directive.exp.loc.source.trim(),
          branch,
          evidence: {
            source: range(directive.exp.loc.start.offset, directive.exp.loc.end.offset),
            code: directive.exp.loc.source.trim(),
          },
        }
      : null;
  function walk(
    children: readonly TemplateChildNode[],
    inherited: readonly StaticCondition[],
    shadowed: ReadonlySet<string>,
    depth: number,
  ) {
    if (depth > 128) throw new Error('Template depth');
    let previous: StaticCondition[] = [];
    for (const node of children) {
      if (++count > 20000) throw new Error('Template node limit');
      if (node.type !== NodeTypes.ELEMENT) continue;
      const conditions = [...inherited],
        names = new Set(shadowed);
      const branch = node.props.find(
        (prop): prop is DirectiveNode =>
          prop.type === NodeTypes.DIRECTIVE && ['if', 'else-if', 'else'].includes(prop.name),
      );
      if (branch?.name === 'if') {
        previous = [];
        const value = condition(branch, 'truthy');
        if (value) {
          conditions.push(value);
          previous.push(value);
        }
      } else if (branch) {
        conditions.push(...previous.map((value) => ({ ...value, branch: 'falsy' as const })));
        const value = condition(branch, 'truthy');
        if (value) {
          conditions.push(value);
          previous.push(value);
        }
      } else previous = [];
      for (const prop of node.props)
        if (
          prop.type === NodeTypes.DIRECTIVE &&
          prop.name === 'for' &&
          prop.exp?.type === NodeTypes.SIMPLE_EXPRESSION
        ) {
          const expression = prop.exp.content;
          const lhs = expression.split(/\s+(?:in|of)\s+/)[0] ?? '';
          for (const name of lhs.match(/[A-Za-z_$][\w$]*/g) ?? []) names.add(name);
          const value = condition(prop, 'iteration');
          if (value) conditions.push(value);
        }
      elements.push({
        node,
        source: range(node.loc.start.offset, node.loc.end.offset),
        conditions,
        shadowed: names,
      });
      walk(node.children, conditions, names, depth + 1);
    }
  }
  walk(ast.children, [], new Set(), 0);
  if (elements.length > 2048) throw new Error('Template site limit');
  let projection = code.replace(/[^\r\n]/g, ' ');
  for (const block of [descriptor.script, descriptor.scriptSetup])
    if (block)
      projection =
        projection.slice(0, block.loc.start.offset) +
        block.content +
        projection.slice(block.loc.end.offset);

  return { descriptor, template, elements, projection, range };
}
function privateNode(node: ElementNode): boolean {
  return (
    /^(?:input|textarea|select|option|script|style|noscript)$/.test(node.tag) ||
    node.props.some(
      (prop) =>
        (prop.type === NodeTypes.ATTRIBUTE &&
          ['data-private', 'data-devanalyst-private', 'contenteditable'].includes(
            prop.name.toLowerCase(),
          )) ||
        (prop.type === NodeTypes.DIRECTIVE &&
          (['html', 'text', 'model'].includes(prop.name) ||
            (prop.name === 'bind' &&
              prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION &&
              ['data-private', 'data-devanalyst-private', 'contenteditable'].includes(
                prop.arg.content.toLowerCase(),
              )))),
    )
  );
}
export function instrumentVueSource(
  code: string,
  file: string,
  runtimeUrl: string,
  framework: 'vue-vite' | 'nuxt' = 'vue-vite',
): InstrumentationResult {
  const manifest = {
    version: 1 as const,
    moduleId: hash('vue:' + file),
    revision: hash(code),
    framework,
    strategy: 'vue-directive-v1' as const,
    sites: [] as InstrumentationResult['manifest']['sites'],
  };
  const empty = (diagnostics: MappingDiagnostic[] = []): InstrumentationResult => ({
    code,
    map: null,
    manifest,
    inspections: [],
    diagnostics,
  });
  if (
    runtimeUrl !== '@sonht113/nuxt-module/vue-runtime' &&
    !/^\/[\w/.-]+\/vue-runtime\.js$/.test(runtimeUrl)
  )
    throw new Error('Invalid Vue runtime URL');
  let parsed: ReturnType<typeof parseVueSource>;
  try {
    parsed = parseVueSource(code, file);
  } catch {
    return empty([{ code: 'UNSUPPORTED_SFC', source: null }]);
  }
  const { descriptor, template, elements } = parsed;
  if (
    !descriptor.scriptSetup ||
    (descriptor.script && descriptor.script.lang !== descriptor.scriptSetup.lang)
  )
    return empty([{ code: 'UNSUPPORTED_SFC', source: null }]);
  let binding = '__devanalystVueModule',
    directive = 'vDevanalystOrigin';
  while (code.includes(binding) || code.includes(directive)) {
    binding += '_';
    directive += '_';
  }
  const directiveName = directive
    .slice(1)
    .replace(/[A-Z]/g, (character, index) => (index ? '-' : '') + character.toLowerCase());
  const editor = new MagicString(code),
    sites: MappingSite[] = [],
    inspections: SourceInspectionOrigin[] = [];
  const component: ComponentIdentity = {
    id: hash('vue-component:' + file),
    name: basename(file, '.vue'),
    source: sourceRange(
      code,
      file,
      descriptor.scriptSetup.loc.start.offset,
      descriptor.scriptSetup.loc.end.offset,
    ),
  };
  const ordinals = new Map<string, number>();
  for (const { node, source } of elements) {
    if (node.tagType !== ElementTypes.ELEMENT || !/^[a-z][a-zA-Z0-9]*$/.test(node.tag)) continue;
    const ordinal = ordinals.get(node.tag) ?? 0;
    ordinals.set(node.tag, ordinal + 1);
    const id = hash(`vue:${file}:${node.tag}:${ordinal}`);
    sites.push({ id, tag: node.tag, source, component });
    const privateAncestor = elements.some(
      (entry) =>
        entry.node.loc.start.offset <= node.loc.start.offset &&
        entry.node.loc.end.offset >= node.loc.end.offset &&
        privateNode(entry.node),
    );
    const parts: string[] = [];
    let literal = true,
      seen = 0;
    const collect = (children: readonly TemplateChildNode[]) => {
      for (const child of children) {
        if (++seen > 100) {
          literal = false;
          return;
        }
        if (child.type === NodeTypes.TEXT) parts.push(child.content);
        else if (
          child.type === NodeTypes.ELEMENT &&
          child.tagType === ElementTypes.ELEMENT &&
          !privateNode(child)
        )
          collect(child.children);
        else if (child.type !== NodeTypes.COMMENT) literal = false;
      }
    };
    collect(node.children);
    const text = parts.join(' ').replace(/\s+/g, ' ').trim();
    inspections.push({
      siteId: id,
      private: privateAncestor,
      literal:
        !privateAncestor && literal && text && text.length <= 1000
          ? { text, evidence: { source, code: node.loc.source.slice(0, 16384) } }
          : null,
    });
    const insert = template.loc.start.offset + node.loc.start.offset + 1 + node.tag.length;
    const payload = JSON.stringify({ manifest: { ...manifest, sites: [sites[sites.length - 1]] } })
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;');
    editor.appendLeft(insert, ` v-${directiveName}="${payload}"`);
  }
  if (!sites.length) return empty();
  // Stable script blocks keep template-only HMR equivalent to uninstrumented Vue.
  // Per-site manifests live solely in the template directive expression.
  const moduleCode = `\nimport {vueSourceDirective as ${binding}} from ${JSON.stringify(runtimeUrl)};\n`;
  if (descriptor.script) editor.appendLeft(descriptor.script.loc.start.offset, moduleCode);
  else
    editor.appendLeft(
      0,
      `<script${descriptor.scriptSetup.lang === 'ts' ? ' lang="ts"' : ''}>${moduleCode}</script>\n`,
    );
  editor.appendLeft(descriptor.scriptSetup.loc.start.offset, `\nconst ${directive}=${binding};\n`);
  const map = editor.generateMap({ source: file, includeContent: true, hires: true });
  return {
    code: editor.toString(),
    map: {
      version: 3,
      sources: map.sources,
      sourcesContent: map.sourcesContent ?? [code],
      names: map.names,
      mappings: map.mappings,
    },
    manifest: { ...manifest, sites },
    inspections,
    diagnostics: [],
  };
}
