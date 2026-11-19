import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createStaticAnalyzer } from './engine.js';
it('analyzes real SFC conditions, handlers, explicit Composition API and imported services without executing source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devanalyst-vue-'));
  try {
    await mkdir(join(root, 'src'));
    const code = `<script setup lang="ts">\nimport {ref,computed,onMounted} from 'vue';import {save} from './service';\nconst count=ref(0); const visible=computed(()=>count.value>=0);function increment(){const negated=!count.value;count.value++;save();return negated}\nonMounted(()=>save());\n</script>\n<template><main v-if="visible"><button :disabled="count > 10" @click="increment">保存</button></main></template>`;
    await writeFile(join(root, 'src/App.vue'), code);
    await writeFile(
      join(root, 'src/service.ts'),
      'export function save(){return fetch("/api/vue-orders")}',
    );
    const result = await createStaticAnalyzer({
      workspaceRoot: root,
      framework: 'vue-vite',
    }).analyzeDetailed({
      requestId: 'vue',
      sources: [{ file: 'src/App.vue', start: null, end: null }],
    });
    expect(result.sourceHashes['src/App.vue']).toBe(
      createHash('sha256').update(code).digest('hex'),
    );
    expect(result.diagnostics).toEqual([]);
    for (const kind of ['handler', 'condition', 'disabled', 'hook', 'state', 'api'])
      expect(result.findings.some((finding) => finding.detail.kind === kind)).toBe(true);
    const handler = result.findings.find((finding) => finding.detail.kind === 'handler');
    expect(handler?.evidence?.source.start?.line).toBe(6);
    expect(
      result.findings.some(
        (finding) => finding.detail.kind === 'api' && finding.detail.endpoint === '/api/vue-orders',
      ),
    ).toBe(true);
    expect(result.findings.every((finding) => finding.execution === 'not-evaluated')).toBe(true);
    expect(
      result.findings.some(
        (finding) =>
          finding.detail.kind === 'state' &&
          finding.detail.operation === 'update' &&
          finding.detail.expression === '!count.value',
      ),
    ).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('keeps Next server action bodies outside browser call traces', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devanalyst-next-boundary-'));
  try {
    await mkdir(join(root, 'src'));
    await writeFile(
      join(root, 'src/Button.tsx'),
      `'use client';import {save} from './action';export default function Button(){return <button onClick={()=>save()}>Save</button>}`,
    );
    await writeFile(
      join(root, 'src/action.ts'),
      `'use server';export async function save(){return fetch('https://server-only.invalid/private')}`,
    );
    const result = await createStaticAnalyzer({
      workspaceRoot: root,
      framework: 'next-react',
    }).analyzeDetailed({
      requestId: 'next',
      sources: [{ file: 'src/Button.tsx', start: null, end: null }],
    });
    expect(result.diagnostics.some((value) => value.code === 'SERVER_BOUNDARY')).toBe(true);
    expect(
      result.findings.some(
        (value) => value.detail.kind === 'api' && value.detail.endpoint?.includes('server-only'),
      ),
    ).toBe(false);
    expect(result.sourceHashes['src/action.ts']).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
