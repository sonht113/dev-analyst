import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createWorkerAnalyzer } from '@devanalyst/analyzer';
import { createClaudeCodeProvider } from '@devanalyst/ai';
import { cacheFingerprint, openPersistentCache, type CacheIdentityInput } from '@devanalyst/cache';
import { claudeFixture } from '../helpers/claude-fixture.js';
it('reuses enforced Claude and SQLite contracts for real Vue evidence with original SFC hashes and adapter isolation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devanalyst-vue-ai-')),
    cli = await claudeFixture();
  try {
    await mkdir(join(root, 'src'));
    const code = `<script setup lang="ts">\nimport {ref} from 'vue';const visible=ref(true);function save(){return fetch('/api/orders')}\n</script>\n<template><button v-if="visible" @click="save">保存</button></template>`;
    await writeFile(join(root, 'src/App.vue'), code);
    const result = await createWorkerAnalyzer({
      workspaceRoot: root,
      framework: 'vue-vite',
    }).analyzeDetailed({
      requestId: randomUUID(),
      sources: [{ file: 'src/App.vue', start: null, end: null }],
    });
    expect(result.completion).toBe('complete');
    expect(
      result.findings.some(
        (finding) => finding.detail.kind === 'handler' && finding.confidence === 'VERIFIED',
      ),
    ).toBe(true);
    const provider = createClaudeCodeProvider({
      workspaceRoot: root,
      executable: cli.executable,
      ai: { enabled: true, permittedPaths: ['src/**'] },
    });
    const explanation = await provider.explainDetailed({
      requestId: randomUUID(),
      depth: 'standard',
      sourceHashes: result.sourceHashes,
      evidence: result.findings.filter((finding) => finding.evidence).slice(0, 24),
    });
    expect(explanation.findings.length).toBeGreaterThan(0);
    expect(explanation.findings.every((finding) => finding.confidence !== 'VERIFIED')).toBe(true);
    const store = await openPersistentCache({ workspaceRoot: root });
    const identity: CacheIdentityInput = {
      scope: 'component',
      kind: 'analysis',
      subject: cacheFingerprint('src/App.vue'),
      revision: result.sourceHashes['src/App.vue'] ?? '',
      policy: cacheFingerprint({ framework: 'vue-vite' }),
      provider: 'deterministic',
      model: 'typescript',
      schemaVersion: 'framework-1',
    };
    try {
      const miss = await store.get(identity);
      expect(
        (
          await store.put({
            identity,
            generation: miss.generation,
            hashes: result.sourceHashes,
            payload: { type: 'static', result },
          })
        ).stored,
      ).toBe(true);
    } finally {
      await store.close();
    }
    const reopened = await openPersistentCache({ workspaceRoot: root });
    try {
      expect((await reopened.get(identity)).status).toBe('fresh');
      expect(
        (await reopened.get({ ...identity, policy: cacheFingerprint({ framework: 'react-vite' }) }))
          .status,
      ).toBe('miss');
    } finally {
      await reopened.close();
    }
    expect(await readFile(join(root, 'src/App.vue'), 'utf8')).toBe(code);
    expect((await cli.calls()).filter((call) => call.input).length).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(cli.root, { recursive: true, force: true });
  }
});
