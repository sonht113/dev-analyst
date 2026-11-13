import { describe, expect, it } from 'vitest';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { instrumentReactSource } from './instrumentation.js';
const instrument = (code: string, file = 'src/App.tsx') =>
  instrumentReactSource(code, file, '/__devanalyst/mapping-runtime.js');
describe('React compile-time source instrumentation', () => {
  it('locates the complete JSX range and lexical owner using one-based coordinates', () => {
    const code = 'export function App(){\n  return <button title="ok">Save</button>;\n}';
    const result = instrument(code);
    expect(result.manifest.sites).toHaveLength(1);
    expect(result.manifest.sites[0]).toMatchObject({
      tag: 'button',
      source: { file: 'src/App.tsx', start: { line: 2, column: 10 }, end: { line: 2, column: 42 } },
      component: { name: 'App' },
    });
    expect(result.code).toContain('ref={__devanalystBinding.ref(0)}');
    expect(result.code).not.toContain('data-devanalyst');
  });
  it.each([
    ['fragment', 'export const App=()=> <><span/><button/></>', ['span', 'button']],
    ['conditional', 'export const App=()=>ok ? <a/> : <button/>', ['a', 'button']],
    [
      'list',
      'export const App=()=> <ul>{xs.map(x=><li key={x.id}>{x.name}</li>)}</ul>',
      ['ul', 'li'],
    ],
    [
      'nested',
      'function App(){function Inner(){return <b/>}return <main><Inner/></main>}',
      ['b', 'main'],
    ],
    ['memo', 'export const App=memo(()=> <button/>);', ['button']],
    ['class', 'class App extends Component {render(){return <div/>}}', ['div']],
    [
      'SVG',
      'const App=()=> <svg><linearGradient/><path/></svg>',
      ['svg', 'linearGradient', 'path'],
    ],
    ['anonymous default', 'export default ()=> <button/>', ['button']],
  ])(
    'instruments %s without wrappers, component props, key or children rewrites',
    (_name, code, tags) => {
      const result = instrument(code);
      expect(result.manifest.sites.map((site) => site.tag)).toEqual(tags);
      expect(
        result.code.replace(/ ref=\{__devanalystBinding.ref\(\d+\)\}/g, '').endsWith(code),
      ).toBe(true);
    },
  );
  it('keeps identifiers stable over whitespace and text edits but changes content revision', () => {
    const first = instrument('const App=()=> <button>A</button>');
    const next = instrument('\n\nconst App = () => <button>B</button>');
    expect(first.manifest.moduleId).toBe(next.manifest.moduleId);
    expect(first.manifest.sites[0]?.id).toBe(next.manifest.sites[0]?.id);
    expect(first.manifest.sites[0]?.component?.id).toBe(next.manifest.sites[0]?.component?.id);
    expect(first.manifest.revision).not.toBe(next.manifest.revision);
    expect(
      instrument('const App=()=> <button>A</button>', 'ui/App.tsx').manifest.moduleId,
    ).not.toBe(first.manifest.moduleId);
  });
  it('distinguishes same-tag sites and nested component identities', () => {
    const result = instrument(
      'function App(){function Inner(){return <button/>}return <><button/><button/><Inner/></>}',
    );
    expect(new Set(result.manifest.sites.map((site) => site.id)).size).toBe(3);
    expect(result.manifest.sites.map((site) => site.component?.name)).toEqual([
      'App.Inner',
      'App',
      'App',
    ]);
  });
  it.each([
    ['<button ref={nativeRef}/>', 'EXISTING_REF'],
    ['<button {...props}/>', 'SPREAD_PROPS'],
    ['<custom-button/>', 'CUSTOM_ELEMENT'],
    ['cloneElement(<button/>)', 'DYNAMIC_ELEMENT_REWRITE'],
    ['createElement("button")', 'DYNAMIC_ELEMENT_REWRITE'],
  ])('leaves unsafe JSX %s unchanged and reports a diagnostic', (jsx, diagnostic) => {
    const code = `export const App=()=>${jsx}`;
    const result = instrument(code);
    expect(result.code).toBe(code);
    expect(result.map).toBeNull();
    expect(result.diagnostics.map((item) => item.code)).toContain(diagnostic);
  });
  it('does not map component boundaries, dynamic tag names, imperative DOM or invalid JSX', () => {
    for (const code of [
      'export const App=()=> <UI.Button/>',
      'const node=document.createElement("button")',
      'const App=()=> <div>',
    ])
      expect(instrument(code).manifest.sites).toHaveLength(0);
    expect(instrument('const App=()=> <div>').diagnostics[0]?.code).toBe('PARSE_ERROR');
  });
  it('preserves directives, avoids identifier capture and retains expression evaluation order', () => {
    const result = instrument(
      '"use strict";\nconst __devanalystBinding=1;const __devanalystRegister=2;export const App=()=> <button a={first()} b={second()}/>',
    );
    expect(result.code.startsWith('"use strict";')).toBe(true);
    expect(result.code).toContain('const __devanalystBinding_=');
    expect(result.code).toContain('registerSourceModule as __devanalystRegister_');
    expect(result.code).toContain('a={first()} b={second()}');
  });
  it('maps unchanged expression positions back through the high-resolution source map', () => {
    const code = 'export function App(){\n return <button onClick={()=>explode()}>保存</button>\n}';
    const result = instrument(code);
    if (!result.map) throw new Error('Missing map');
    const position = result.code.indexOf('explode()');
    const prefix = result.code.slice(0, position).split('\n');
    const original = originalPositionFor(new TraceMap(result.map), {
      line: prefix.length,
      column: prefix.at(-1)?.length ?? 0,
    });
    const before = code.slice(0, code.indexOf('explode()')).split('\n');
    expect(original).toMatchObject({
      source: 'src/App.tsx',
      line: before.length,
      column: before.at(-1)?.length,
    });
    expect(result.map.sourcesContent).toEqual([code]);
  });
  it('bounds work and rejects non-workspace paths and arbitrary runtime imports', () => {
    expect(instrument(' '.repeat(256 * 1024 + 1)).diagnostics[0]?.code).toBe('LIMIT_EXCEEDED');
    expect(() => instrument('<div/>', '../outside.tsx')).toThrow();
    expect(() => instrumentReactSource('<div/>', 'src/a.tsx', 'https://outside/evil.js')).toThrow();
  });
});

it('does not invent a component for JSX constants and bounds skip diagnostics', () => {
  expect(instrument('const Template = <button/>').manifest.sites[0]?.component).toBeNull();
  const result = instrument('const App=()=> <>' + '<button ref={nativeRef}/>'.repeat(101) + '</>');
  expect(result.diagnostics).toEqual([{ code: 'LIMIT_EXCEEDED', source: null }]);
  expect(result.manifest.sites).toEqual([]);
});
