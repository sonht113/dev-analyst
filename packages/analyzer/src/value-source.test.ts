import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { createStaticAnalyzer } from './engine.js';

it('extracts lexical display sources from JSX without evaluating state or attributing sibling values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devanalyst-values-'));
  try {
    await writeFile(
      join(root, 'App.tsx'),
      `import {useState} from 'react';
export function App({order}:{order:{total:number}}){const [count,setCount]=useState(0);
return <><button onClick={()=>setCount(count+1)}>{count}</button><span>{order.total}</span><a href='/orders'>注文</a><a href={order.total}>動的</a></>}`,
    );
    const result = await createStaticAnalyzer({
      workspaceRoot: root,
      source: { include: ['**/*.tsx'] },
    }).analyzeDetailed({
      requestId: 'values',
      sources: [{ file: 'App.tsx', start: null, end: null }],
    });
    const values = result.findings.filter((finding) => finding.detail.kind === 'value');
    expect(values.map((finding) => finding.detail)).toEqual(
      expect.arrayContaining([
        { kind: 'value', expression: 'count', bindings: ['[count,setCount]=useState(0)'] },
        { kind: 'value', expression: 'order.total', bindings: ['{order}:{order:{total:number}}'] },
      ]),
    );
    expect(new Set(values.map((finding) => finding.subjectId)).size).toBe(2);
    expect(values.every((finding) => finding.evidence && finding.confidence === 'VERIFIED')).toBe(
      true,
    );
    const destinations = result.findings.filter((finding) => finding.detail.kind === 'navigation');
    expect(destinations.map((finding) => finding.detail)).toEqual(
      expect.arrayContaining([
        { kind: 'navigation', mechanism: 'href', destination: '/orders', expression: "'/orders'" },
        { kind: 'navigation', mechanism: 'href', destination: null, expression: 'order.total' },
      ]),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('extracts Vue interpolation and display bindings from original SFC evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devanalyst-vue-values-'));
  try {
    await writeFile(
      join(root, 'App.vue'),
      `<script setup lang="ts">import {ref} from 'vue';const count=ref(0);const orders=ref([]);</script>
<template><span>{{ count }}</span><input :value="count"/><span v-for="count in orders">{{ count }}</span><a :href="destination">注文</a></template>`,
    );
    const result = await createStaticAnalyzer({
      workspaceRoot: root,
      framework: 'vue-vite',
      source: { include: ['**/*.vue'] },
    }).analyzeDetailed({
      requestId: 'vue-values',
      sources: [{ file: 'App.vue', start: null, end: null }],
    });
    const values = result.findings.filter((finding) => finding.detail.kind === 'value');
    expect(values.map((finding) => finding.detail)).toEqual([
      { kind: 'value', expression: 'count', bindings: ['count=ref(0)'] },
      { kind: 'value', expression: 'count', bindings: ['count=ref(0)'] },
      { kind: 'value', expression: 'count', bindings: [] },
    ]);
    expect(
      values.every(
        (finding) =>
          finding.evidence?.source.file === 'App.vue' && finding.evidence.source.start?.line === 2,
      ),
    ).toBe(true);
    expect(
      result.findings.some(
        (finding) =>
          finding.detail.kind === 'navigation' &&
          finding.detail.destination === null &&
          finding.confidence === 'INFERRED',
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
