import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, access, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createStaticAnalyzer, type StaticAnalyzerOptions } from './index.js';
import { findingSchema, type StaticAnalysisResult } from '@devanalyst/core';
const cleanup: string[] = [];
afterEach(async () => {
  for (const root of cleanup.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'devanalyst-analysis-'));
  cleanup.push(root);
  for (const [file, code] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), code);
  }
  return root;
}
const request = (file = 'src/App.tsx') => ({
  requestId: 'test-analysis',
  sources: [{ file, start: null, end: null }],
});
async function analyze(
  files: Record<string, string>,
  options: Omit<StaticAnalyzerOptions, 'workspaceRoot'> = {},
) {
  const root = await fixture(files);
  return createStaticAnalyzer({ workspaceRoot: root, ...options }).analyzeDetailed(
    request(Object.keys(files)[0] ?? 'src/App.tsx'),
  );
}
const kinds = (result: StaticAnalysisResult, kind: string) =>
  result.findings.filter((finding) => finding.detail.kind === kind);
describe('static AST analysis engine', () => {
  it.each(['ts', 'js', 'tsx', 'jsx'])(
    'parses %s and returns structured source evidence without executing application code',
    async (extension) => {
      const file = `src/App.${extension}`,
        jsx = extension.endsWith('x');
      const result = await analyze({
        [file]: jsx
          ? 'export function App(){return <button onClick={save}/>};function save(){fetch("/api/save")}'
          : 'export function save(){fetch("/api/save");}',
      });
      expect(result.diagnostics).toEqual([]);
      expect(kinds(result, 'api')[0]).toMatchObject({
        confidence: 'VERIFIED',
        detail: { client: 'fetch', endpoint: '/api/save', method: 'GET' },
        execution: 'not-evaluated',
        evidence: { source: { file, start: { line: 1 } } },
        cacheStatus: 'miss',
      });
    },
  );
  it('traces imported aliases/re-exports from a button handler through service wrappers', async () => {
    const result = await analyze({
      'src/App.tsx':
        'import {save as submit} from "./barrel";export function App(){return <button onClick={submit}>Save</button>}',
      'src/barrel.ts': 'export {save} from "./service";',
      'src/service.ts':
        'export function save(){return requestOrder()} function requestOrder(){return fetch("/orders",{method:"POST"})}',
    });
    const api = kinds(result, 'api')[0];
    expect(api?.detail).toMatchObject({ endpoint: '/orders', method: 'POST' });
    expect(
      api?.traces.some(
        (trace) =>
          trace.confidence === 'VERIFIED' &&
          trace.path.some((source) => source.file === 'src/App.tsx') &&
          trace.path.some((source) => source.file === 'src/service.ts'),
      ),
    ).toBe(true);
    const ids = new Set(result.graph.nodes.map((node) => node.id));
    expect(result.graph.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to))).toBe(true);
    expect(
      result.graph.edges.filter((edge) => edge.kind === 'calls').length,
    ).toBeGreaterThanOrEqual(2);
  });
  it('identifies named/default exports, prop names and parent-child relationships', async () => {
    const result = await analyze({
      'src/App.tsx':
        'import Child from "./Child";export const App=()=> <Child title="Hello" onSave={()=>fetch("/save")}/>;',
      'src/Child.tsx':
        'export default function Child({title,onSave}:{title:string;onSave:()=>void}){return <button onClick={onSave}>{title}</button>}',
    });
    expect(
      kinds(result, 'component').some(
        (f) =>
          f.detail.kind === 'component' &&
          f.detail.name === 'Child' &&
          f.detail.props.includes('onSave') &&
          f.detail.exports.some((item) => item.name === 'default'),
      ),
    ).toBe(true);
    expect(
      kinds(result, 'relationship').some(
        (f) =>
          f.detail.kind === 'relationship' &&
          f.detail.tag === 'Child' &&
          f.detail.child !== null &&
          f.detail.parent !== null,
      ),
    ).toBe(true);
    expect(
      result.graph.edges.some((edge) => edge.kind === 'callback' && edge.confidence === 'INFERRED'),
    ).toBe(true);
  });
  it('extracts true/false, logical and early-return rendering guards without assuming their values', async () => {
    const result = await analyze({
      'src/App.tsx':
        'export function App({ready,ok}){if(!ready)return null;return <>{ok?<button id="a"/>:<span/>}{ready&&<a/>}{ok||<p/>}</>}',
    });
    const conditions = kinds(result, 'condition').map((f) => f.detail);
    expect(conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ expression: 'ok', branch: 'truthy' }),
        expect.objectContaining({ expression: 'ok', branch: 'falsy' }),
        expect.objectContaining({ expression: '!ready', branch: 'falsy' }),
        expect.objectContaining({ expression: 'ready', branch: 'truthy' }),
      ]),
    );
    expect(
      kinds(result, 'condition').every(
        (f) => f.execution === 'not-evaluated' && f.explanation.includes('not evaluated'),
      ),
    ).toBe(true);
  });
  it('distinguishes native disabled/hidden, ARIA state, style expressions and unknown CSS visibility', async () => {
    const result = await analyze({
      'src/App.tsx':
        'export const App=({loading})=><button disabled={loading} aria-disabled={loading} hidden={!loading} aria-hidden="true" className={loading?"hide":"show"} style={{display:loading?"none":"block",opacity:loading?0:1}}/>',
    });
    expect(kinds(result, 'disabled')).toHaveLength(2);
    expect(kinds(result, 'visibility').map((f) => f.detail)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ attribute: 'hidden', expression: '!loading' }),
        expect.objectContaining({ attribute: 'style.display' }),
      ]),
    );
    expect(
      kinds(result, 'visibility').find(
        (f) => f.detail.kind === 'visibility' && f.detail.attribute === 'className',
      )?.confidence,
    ).toBe('UNKNOWN');
  });
  it('recognizes React useCallback, effects, state dispatch and imported hook aliases', async () => {
    const result = await analyze({
      'src/App.tsx':
        'import {useState as state,useEffect,useCallback} from "react";export function App(){const [count,setCount]=state(0);const save=useCallback(()=>{setCount(count+1);fetch("/save")},[count]);useEffect(()=>{fetch("/startup")},[]);return <button onClick={save}/>}',
    });
    expect(kinds(result, 'state').map((f) => f.detail)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'declaration', names: ['count', 'setCount'] }),
        expect.objectContaining({ operation: 'update' }),
      ]),
    );
    expect(
      kinds(result, 'hook').some(
        (f) =>
          f.detail.kind === 'hook' &&
          f.detail.name === 'useEffect' &&
          f.detail.dependencies?.length === 0,
      ),
    ).toBe(true);
    expect(
      kinds(result, 'api').find((f) => f.detail.kind === 'api' && f.detail.endpoint === '/startup')
        ?.traces.length,
    ).toBeGreaterThan(0);
  });
  it('recognizes router bindings, Link destinations, native navigation and dynamic targets', async () => {
    const result = await analyze({
      'src/App.tsx':
        'import {useNavigate as useNav,Link,redirect} from "react-router-dom";export function App({path}){const navigate=useNav();const go=()=>{navigate("/orders");navigate(path);redirect("/login");window.location.assign("/help");history.pushState({},"","/new")};return <><button onClick={go}/><Link to="/settings"/></>}',
    });
    const nav = kinds(result, 'navigation');
    expect(nav.map((f) => f.detail)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ destination: '/orders' }),
        expect.objectContaining({ destination: '/settings' }),
        expect.objectContaining({ destination: '/help' }),
        expect.objectContaining({ destination: '/new' }),
      ]),
    );
    expect(
      nav.find((f) => f.detail.kind === 'navigation' && f.detail.destination === null)?.confidence,
    ).toBe('INFERRED');
  });
  it('recognizes aliased Axios clients, instance configuration and dynamic request expressions', async () => {
    const result = await analyze({
      'src/api.ts':
        'import http from "axios";const client=http.create({baseURL:"/api"});export function save(path){http.get("/orders");client.post("/save",{});client.get(path);http({url:"/request",method:"PATCH"});}',
    });
    expect(kinds(result, 'api').map((f) => f.detail)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ client: 'axios', method: 'GET', endpoint: '/orders' }),
        expect.objectContaining({ method: 'POST', endpoint: '/save', baseURL: '/api' }),
        expect.objectContaining({ method: 'PATCH', endpoint: '/request' }),
      ]),
    );
    const dynamic = kinds(result, 'api').find(
      (f) => f.detail.kind === 'api' && f.detail.endpoint === null,
    );
    expect(dynamic?.confidence).toBe('INFERRED');
    expect(dynamic?.detail).toMatchObject({ expression: 'path', endpoint: null });
  });
  it('does not classify shadowed fetch/router/Axios/setter names as proven platform calls', async () => {
    const result = await analyze({
      'src/App.tsx':
        'function save(fetch,axios,navigate){fetch("/fake");axios.get("/fake");navigate("/fake")}export function App(){return <button onClick={save}/>}',
    });
    expect(kinds(result, 'api')).toEqual([]);
    expect(kinds(result, 'navigation')).toEqual([]);
    expect(kinds(result, 'call').some((f) => f.confidence === 'UNKNOWN')).toBe(true);
  });
  it('reports dynamic calls and mutable function targets as uncertain', async () => {
    const result = await analyze({
      'src/App.tsx':
        'function first(){fetch("/first")}function second(){}let action=first;action=second;export const App=({handlers,key})=><button onClick={()=>{action();handlers[key]()}}/>',
    });
    const calls = kinds(result, 'call');
    expect(
      calls.some(
        (f) => f.confidence === 'UNKNOWN' && f.detail.kind === 'call' && f.detail.targetId === null,
      ),
    ).toBe(true);
    expect(kinds(result, 'api')[0]?.traces).toEqual([]);
  });
  it('supports TypeScript paths and explicit aliases without invoking app config', async () => {
    const result = await analyze(
      {
        'src/App.tsx':
          'import {save} from "@services/orders";export const App=()=> <button onClick={save}/>',
        'src/services/orders.ts': 'export function save(){fetch("/aliased")} ',
      },
      { compilerOptions: { baseUrl: '.', paths: { '@services/*': ['src/services/*'] } } },
    );
    expect(kinds(result, 'api')[0]?.traces.length).toBeGreaterThan(0);
    const alias = await analyze(
      {
        'src/App.tsx':
          'import {save} from "@services/orders";export const App=()=> <button onClick={save}/>',
        'src/services/orders.ts': 'export function save(){fetch("/alias")} ',
      },
      { aliases: { '@services': 'src/services' } },
    );
    expect(kinds(alias, 'api')[0]?.traces.length).toBeGreaterThan(0);
  });
  it('reads only explicitly permitted JSONC tsconfig and local extends for paths', async () => {
    const root = await fixture({
      'src/App.tsx': 'import {save} from "@/orders";export const App=()=> <button onClick={save}/>',
      'src/orders.ts': 'export function save(){fetch("/config")}',
      'tsconfig.json': '{"extends":"./config/base.json", "compilerOptions": {"strict":true}}',
      'config/base.json':
        '{ // alias\n "compilerOptions":{"baseUrl":"..","paths":{"@/*":["src/*"]}} }',
    });
    const result = await createStaticAnalyzer({
      workspaceRoot: root,
      source: { include: ['src/**', 'tsconfig.json', 'config/**'] },
      tsconfig: 'tsconfig.json',
    }).analyzeDetailed(request());
    expect(kinds(result, 'api')[0]?.traces.length).toBeGreaterThan(0);
  });
  it('bounds circular imports and recursive call graphs', async () => {
    const result = await analyze({
      'src/App.tsx': 'import {a} from "./a";export const App=()=> <button onClick={a}/>',
      'src/a.ts': 'import {b} from "./b";export function a(){b()}',
      'src/b.ts': 'import {a} from "./a";export function b(){a();fetch("/cycle")}',
    });
    expect(result.metrics.files).toBe(3);
    expect(result.diagnostics.some((item) => item.code === 'CALL_CYCLE')).toBe(true);
    expect(kinds(result, 'api')[0]?.detail).toMatchObject({ endpoint: '/cycle' });
  });
  it('never executes top-level source, imported code or executable config', async () => {
    const root = await fixture({
      'src/App.tsx':
        'import {writeFileSync} from "node:fs";writeFileSync("MUST_NOT_EXIST","executed");throw new Error("application executed");export const App=()=> <button/>',
      'vite.config.ts': 'throw new Error("config executed")',
    });
    await writeFile(
      join(root, 'src/App.tsx'),
      `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(join(root, 'MUST_NOT_EXIST'))},'executed');throw new Error('application executed');export const App=()=> <button/>`,
    );
    const result = await createStaticAnalyzer({ workspaceRoot: root }).analyzeDetailed(request());
    expect(kinds(result, 'component').length).toBeGreaterThan(0);
    await expect(access(join(root, 'MUST_NOT_EXIST'))).rejects.toThrow();
  });
  it('rejects sensitive/outside/symlink imports and handles malformed files as UNKNOWN', async () => {
    const root = await fixture({
      'src/App.tsx':
        'import {secret} from "./.env";import {bad} from "./bad";import {escape} from "./escape";export const App=()=> <button onClick={bad}/>',
      'src/.env.ts': 'export const secret="never read"',
      'src/bad.ts': 'export function bad( {',
      'src/unused.ts': 'fetch("/unused")',
    });
    const outside = await fixture({ 'evil.ts': 'export function escape(){fetch("/escape")}' });
    await symlink(join(outside, 'evil.ts'), join(root, 'src/escape.ts'));
    const result = await createStaticAnalyzer({ workspaceRoot: root }).analyzeDetailed(request());
    expect(kinds(result, 'api')).toEqual([]);
    expect(result.diagnostics.some((item) => item.code === 'SOURCE_PARSE_ERROR')).toBe(true);
    expect(Object.keys(result.sourceHashes)).toEqual(['src/App.tsx']);
  });
  it.each([
    { maxFiles: 1 },
    { maxBytes: 128 },
    { maxAstNodes: 1 },
    { maxGraphNodes: 2 },
    { maxGraphEdges: 1 },
    { maxFindings: 1 },
    { maxResolutionAttempts: 1 },
  ])('returns explicit partial diagnostics under resource limit %j', async (limits) => {
    const result = await analyze(
      {
        'src/App.tsx':
          'import {save} from "./service";export function App(){return <main><button onClick={save} title="abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz"/></main>}',
        'src/service.ts': 'export function save(){fetch("/save")} ',
      },
      { limits },
    );
    expect(result.completion).toBe('partial');
    expect(result.diagnostics.some((item) => item.code.endsWith('_LIMIT'))).toBe(true);
  });
  it('supports cancellation and validates all public input', async () => {
    const root = await fixture({ 'src/App.tsx': 'export const App=()=> <button/>' });
    const controller = new AbortController();
    controller.abort();
    const engine = createStaticAnalyzer({ workspaceRoot: root });
    const result = await engine.analyzeDetailed({ ...request(), signal: controller.signal });
    expect(result.completion).toBe('cancelled');
    expect(result.findings).toEqual([]);
    expect(() => createStaticAnalyzer({ workspaceRoot: root, limits: { maxFiles: 0 } })).toThrow();
    await expect(engine.analyzeDetailed(request('../outside.tsx'))).rejects.toThrow();
  });
  it('retains the existing Finding[] API contract and exposes measured detailed output', async () => {
    const root = await fixture({
      'src/App.tsx': 'export const App=()=> <button onClick={()=>fetch("/save")}/>',
    });
    const engine = createStaticAnalyzer({ workspaceRoot: root });
    const base = await engine.analyze(request());
    expect(base.length).toBeGreaterThan(0);
    for (const finding of base) expect(findingSchema.safeParse(finding).success).toBe(true);
    const detailed = await engine.analyzeDetailed(request());
    expect(detailed.metrics.durationMs).toBeGreaterThan(0);
    expect(detailed.sourceHashes['src/App.tsx']).toMatch(/^[a-f0-9]{64}$/);
    expect(detailed.selectedSubjects.length).toBeGreaterThan(0);
  });
});

it('does not invent a false guard for JSX returned inside its own if statement', async () => {
  const result = await analyze({
    'src/App.tsx': 'export function App({ready}){if(ready)return <button/>;return null;}',
  });
  const conditions = kinds(result, 'condition');
  expect(conditions.map((item) => item.detail)).toEqual([
    { kind: 'condition', expression: 'ready', branch: 'truthy' },
  ]);
});
it('resolves anonymous/default/memo component exports and custom hook references', async () => {
  const result = await analyze({
    'src/App.tsx':
      'import Child from "./Child";import {useData} from "./hook";export default function(){useData();return <Child/>}',
    'src/Child.jsx': 'import {memo} from "react";export default memo(()=> <button/>);',
    'src/hook.ts': 'export function useData(){return fetch("/hook")}',
  });
  expect(
    kinds(result, 'component').some(
      (item) =>
        item.detail.kind === 'component' &&
        item.detail.exports.some(
          (value) => value.file === 'src/Child.jsx' && value.name === 'default',
        ),
    ),
  ).toBe(true);
  expect(
    kinds(result, 'hook').find(
      (item) => item.detail.kind === 'hook' && item.detail.name === 'useData',
    )?.confidence,
  ).toBe('INFERRED');
  expect(kinds(result, 'api')[0]?.traces.length).toBeGreaterThan(0);
});
it('preserves overwritten/spread/computed request options as unknown expressions', async () => {
  const result = await analyze({
    'src/api.ts':
      'fetch("/a",{method:"POST",...options});fetch("/b",{...options,method:"PATCH"});fetch("/c",{[key]:value});fetch("/d",{method:"POST",method:operation});',
  });
  const api = kinds(result, 'api');
  for (const endpoint of ['/a', '/c', '/d'])
    expect(
      api.find((item) => item.detail.kind === 'api' && item.detail.endpoint === endpoint),
    ).toMatchObject({ confidence: 'INFERRED', detail: { method: null } });
  expect(
    api.find((item) => item.detail.kind === 'api' && item.detail.endpoint === '/b'),
  ).toMatchObject({ confidence: 'VERIFIED', detail: { method: 'PATCH' } });
});
it('does not attribute uncalled nested functions to a button handler', async () => {
  const result = await analyze({
    'src/App.tsx':
      'export function App(){function save(){const unused=()=>fetch("/not-called");fetch("/called")}return <button onClick={save}/>;}',
  });
  expect(
    kinds(result, 'api').find(
      (item) => item.detail.kind === 'api' && item.detail.endpoint === '/not-called',
    )?.traces,
  ).toEqual([]);
  expect(
    kinds(result, 'api').find(
      (item) => item.detail.kind === 'api' && item.detail.endpoint === '/called',
    )?.traces.length,
  ).toBeGreaterThan(0);
});
it('retains class state and property callbacks without claiming method dispatch certainty', async () => {
  const result = await analyze({
    'src/App.tsx':
      'import {Component} from "react";export class App extends Component{save(){this.setState({ready:true})}render(){return <button onClick={this.save}/>}}',
  });
  expect(
    kinds(result, 'state').some(
      (item) => item.detail.kind === 'state' && item.detail.operation === 'update',
    ),
  ).toBe(true);
  expect(kinds(result, 'handler')[0]?.confidence).toBe('INFERRED');
});
it('distinguishes React class declarations from a render-method naming convention', async () => {
  const result = await analyze({
    'src/App.tsx':
      'import {Component} from "react"; export class App extends Component{render(){return <button/>}} export class Report{render(){return "report"}}',
  });
  expect(
    kinds(result, 'component').find(
      (finding) => finding.detail.kind === 'component' && finding.detail.name === 'App',
    ),
  ).toMatchObject({ confidence: 'VERIFIED' });
  expect(
    kinds(result, 'component').find(
      (finding) => finding.detail.kind === 'component' && finding.detail.name === 'Report',
    ),
  ).toMatchObject({ confidence: 'INFERRED' });
});
it('does not select a source subject at its exclusive end boundary', async () => {
  const code = 'export const App=()=> <button/>;';
  const root = await fixture({ 'src/App.tsx': code });
  const result = await createStaticAnalyzer({ workspaceRoot: root }).analyzeDetailed({
    ...request(),
    sources: [{ file: 'src/App.tsx', start: { line: 1, column: code.length + 1 }, end: null }],
  });
  expect(result.completion).toBe('complete');
  expect(result.selectedSubjects).toEqual([]);
});
it('does not trust a React-named import redirected to a local fake by path mappings', async () => {
  const result = await analyze(
    {
      'src/App.tsx':
        'import {useState} from "react";export function App(){const [value,setValue]=useState(0);return <button onClick={()=>setValue(1)}/>;}',
      'src/fake.ts': 'export function useState(){return []}',
    },
    { compilerOptions: { paths: { react: ['src/fake.ts'] } } },
  );
  expect(kinds(result, 'state')).toEqual([]);
  expect(kinds(result, 'hook')[0]?.confidence).toBe('INFERRED');
});
it('canonicalizes source aliases and prevents symlink import cycles from expanding the graph', async () => {
  const root = await fixture({
    'src/App.tsx': 'import {save} from "./alias";export const App=()=> <button onClick={save}/>',
    'src/service.ts':
      'import {save as again} from "./alias";export function save(){again();fetch("/canonical")}',
  });
  await symlink(join(root, 'src/service.ts'), join(root, 'src/alias.ts'));
  const result = await createStaticAnalyzer({ workspaceRoot: root }).analyzeDetailed(request());
  expect(result.metrics.files).toBe(2);
  expect(Object.keys(result.sourceHashes)).toEqual(['src/App.tsx', 'src/service.ts']);
  expect(result.diagnostics.some((item) => item.code === 'CALL_CYCLE')).toBe(true);
});
it('supports bounded import depth and config extension cycle diagnostics', async () => {
  const result = await analyze(
    {
      'src/App.tsx': 'import {a} from "./a";export const App=()=> <button onClick={a}/>',
      'src/a.ts': 'export {b as a} from "./b"',
      'src/b.ts': 'export function b(){fetch("/deep")}',
    },
    { limits: { maxDepth: 1 } },
  );
  expect(result.diagnostics.some((item) => item.code === 'IMPORT_DEPTH_LIMIT')).toBe(true);
  const root = await fixture({
    'src/App.tsx': 'export const App=()=> <button/>',
    'tsconfig.json': '{"extends":"./tsconfig.json"}',
  });
  const config = await createStaticAnalyzer({
    workspaceRoot: root,
    source: { include: ['src/**', 'tsconfig.json'] },
    tsconfig: 'tsconfig.json',
  }).analyzeDetailed(request());
  expect(config.diagnostics.some((item) => item.code === 'CONFIG_CYCLE')).toBe(true);
});

it('reports conditional handler targets as candidates without guaranteeing the chosen behavior', async () => {
  const result = await analyze({
    'src/App.tsx':
      'function save(){fetch("/save")}function remove(){fetch("/remove")}export function App({ready}){return <button onClick={ready?save:remove}/>}',
  });
  expect(kinds(result, 'handler')[0]?.confidence).toBe('UNKNOWN');
  for (const finding of kinds(result, 'api'))
    expect(finding.traces.some((trace) => trace.confidence === 'INFERRED')).toBe(true);
});
it('extracts loop guards but makes switch fallthrough predicates explicitly UNKNOWN', async () => {
  const result = await analyze({
    'src/App.tsx':
      'export function App({ready,mode,rows}){while(ready){return <button/>;}switch(mode){case "a": log();case "b":return <span/>;}for(const item of rows){return <p/>;}return null;}',
  });
  expect(kinds(result, 'condition').map((item) => item.detail)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ expression: 'ready', branch: 'truthy' }),
      expect.objectContaining({ expression: 'rows', branch: 'iteration' }),
    ]),
  );
  expect(
    kinds(result, 'condition').find(
      (item) => item.detail.kind === 'condition' && item.detail.branch === 'unknown',
    )?.confidence,
  ).toBe('UNKNOWN');
});

it('does not treat type-only callable imports as runtime handler bindings', async () => {
  const result = await analyze({
    'src/App.tsx':
      'import type {save} from "./service";export const App=()=> <button onClick={save}/>',
    'src/service.ts': 'export function save(){fetch("/type-only")}',
  });
  expect(kinds(result, 'handler')[0]?.confidence).toBe('UNKNOWN');
  expect(kinds(result, 'api')[0]?.traces).toEqual([]);
});
it('loads a shared config ancestor once without misclassifying an extends diamond as a cycle', async () => {
  const root = await fixture({
    'src/App.tsx': 'import {save} from "@/service";export const App=()=> <button onClick={save}/>',
    'src/service.ts': 'export function save(){fetch("/diamond")}',
    'tsconfig.json': '{"extends":["./a.json","./b.json"]}',
    'a.json': '{"extends":"./base.json"}',
    'b.json': '{"extends":"./base.json"}',
    'base.json': '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}',
  });
  const result = await createStaticAnalyzer({
    workspaceRoot: root,
    source: { include: ['src/**', '*.json'] },
    tsconfig: 'tsconfig.json',
  }).analyzeDetailed(request());
  expect(result.diagnostics).toEqual([]);
  expect(kinds(result, 'api')[0]?.traces.length).toBeGreaterThan(0);
});

it('identifies list-returning component candidates without assuming arbitrary map behavior', async () => {
  const result = await analyze({
    'src/List.tsx':
      'export const List=({items})=>items.map(item=><button key={item.id}>{item.name}</button>)',
  });
  expect(kinds(result, 'component')[0]).toMatchObject({
    confidence: 'INFERRED',
    detail: { name: 'List' },
  });
  expect(kinds(result, 'relationship')[0]?.detail).toMatchObject({ parent: expect.any(String) });
});

it('does not interpret non-script files as executable-source evidence', async () => {
  const result = await analyze({ 'src/theme.css': 'fetch("/not-javascript")' });
  expect(result.findings).toEqual([]);
  expect(result.diagnostics[0]?.code).toBe('UNSUPPORTED_SOURCE_FORMAT');
});
