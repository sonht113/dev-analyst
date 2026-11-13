import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createClaudeCodeProvider } from './index.js';
import { claudeFixture } from '../../../tests/active/helpers/claude-fixture.js';
import { RequestGate } from './process.js';
import { sensitiveText } from './context.js';
const cleanup: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of cleanup.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(scenario: Readonly<Record<string, unknown>> = {}) {
  const value = await claudeFixture(scenario);
  cleanup.push(value.root);
  return value;
}
async function until(work: () => Promise<boolean>) {
  for (let count = 0; count < 150; count++) {
    if (await work()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Fixture did not start');
}
describe('Claude CLI provider', () => {
  it('validates source-grounded Vietnamese explanations, downgrades AI certainty and keeps source unchanged', async () => {
    const f = await fixture();
    const provider = createClaudeCodeProvider(f.options);
    const result = await provider.explainDetailed(f.request);
    expect(result.findings).toHaveLength(2);
    expect(result.findings.every((item) => item.confidence === 'INFERRED')).toBe(true);
    expect(result.citations.every((item) => item.evidenceIds[0] === f.evidence.id)).toBe(true);
    expect(result.findings[0]?.evidence).toEqual(f.evidence.evidence);
    expect(result.usage).toMatchObject({ attempts: 1, inputTokens: 110, outputTokens: 40 });
    expect(await readFile(join(f.root, f.file), 'utf8')).toBe(f.code);
    const calls = await f.calls(),
      inference = calls.find((call) => call.input);
    expect(inference?.args).toEqual(
      expect.arrayContaining([
        '--restricted',
        '--safe-mode',
        '--tools',
        '',
        '--strict-mcp-config',
        '--no-session-persistence',
        'dontAsk',
      ]),
    );
    expect(inference?.args.join(' ')).not.toContain(f.code);
    expect(inference?.cwd).not.toBe(f.root);
    expect(inference?.input).not.toContain(f.root);
    if (!inference) throw new Error('Missing subprocess');
    await expect(access(inference.cwd)).rejects.toThrow();
  });
  it('retains the AIProvider explain Finding[] contract', async () => {
    const f = await fixture();
    expect(await createClaudeCodeProvider(f.options).explain(f.request)).toHaveLength(2);
  });
  it('does not serialize caller-supplied explanation text or extra runtime fields', async () => {
    const f = await fixture();
    const evidence = {
      ...f.evidence,
      explanation: 'DO_NOT_TRANSMIT_THIS',
      runtimeValue: 'NEVER_TRANSMIT_RUNTIME',
    };
    await createClaudeCodeProvider(f.options).explain({ ...f.request, evidence: [evidence] });
    const input = (await f.calls()).find((call) => call.input)?.input;
    expect(input).not.toContain('DO_NOT_TRANSMIT_THIS');
    expect(input).not.toContain('NEVER_TRANSMIT_RUNTIME');
  });
  it('distinguishes auth status from verified non-interactive readiness', async () => {
    const f = await fixture(),
      provider = createClaudeCodeProvider(f.options);
    expect(await provider.checkReadiness()).toMatchObject({
      available: true,
      compatible: true,
      authenticated: true,
      nonInteractive: 'unverified',
    });
    expect((await f.calls()).filter((call) => call.input)).toHaveLength(0);
    expect(await provider.checkReadiness({ probe: true })).toMatchObject({
      nonInteractive: 'ready',
      error: null,
    });
    expect((await f.calls()).find((call) => call.input)?.input).not.toContain(f.code);
  });
  it('reports unavailable CLI without retaining command errors', async () => {
    const f = await fixture();
    expect(
      await createClaudeCodeProvider({
        ...f.options,
        executable: join(f.root, 'absent'),
      }).checkReadiness(),
    ).toMatchObject({ available: false, error: { code: 'CLI_NOT_INSTALLED' } });
  });
  it('fails closed for an unverified CLI release', async () => {
    const f = await fixture({ version: '2.1.324' });
    expect(await createClaudeCodeProvider(f.options).checkReadiness()).toMatchObject({
      compatible: false,
      error: { code: 'AI_CLI_INCOMPATIBLE' },
    });
    expect((await f.calls()).some((call) => call.input)).toBe(false);
  });
  it('does not invoke inference when CLI auth status is unavailable', async () => {
    const f = await fixture({ auth: false }),
      provider = createClaudeCodeProvider(f.options);
    expect(await provider.checkReadiness({ probe: true })).toMatchObject({
      available: true,
      authenticated: false,
      error: { code: 'AI_AUTH_UNAVAILABLE' },
    });
    await expect(provider.explain(f.request)).rejects.toMatchObject({
      code: 'AI_AUTH_UNAVAILABLE',
    });
    expect((await f.calls()).some((call) => call.input)).toBe(false);
  });
  it('requires opt-in, explicit path consent and development mode', async () => {
    const f = await fixture();
    await expect(
      createClaudeCodeProvider({ ...f.options, ai: { enabled: false } }).explain(f.request),
    ).rejects.toMatchObject({ code: 'AI_DISABLED' });
    expect(() =>
      createClaudeCodeProvider({ ...f.options, ai: { enabled: true, permittedPaths: [] } }),
    ).toThrow();
    vi.stubEnv('NODE_ENV', 'production');
    await expect(createClaudeCodeProvider(f.options).explain(f.request)).rejects.toMatchObject({
      code: 'DEVELOPMENT_ONLY',
    });
    expect(await f.calls()).toEqual([]);
  });
  it('does not treat a successful login status as proof of inference access', async () => {
    const f = await fixture({ mode: 'auth-failure' });
    expect(await createClaudeCodeProvider(f.options).checkReadiness({ probe: true })).toMatchObject(
      {
        authenticated: true,
        nonInteractive: 'unavailable',
        error: { code: 'AI_AUTH_UNAVAILABLE' },
      },
    );
  });
  it('does not inherit code loaders, telemetry or arbitrary application environment', async () => {
    const f = await fixture();
    vi.stubEnv('NODE_OPTIONS', '--require=unsafe');
    vi.stubEnv('APP_PASSWORD', 'private');
    vi.stubEnv('OTEL_LOG_USER_PROMPTS', 'true');
    await createClaudeCodeProvider(f.options).explain(f.request);
    for (const call of await f.calls())
      for (const key of ['NODE_OPTIONS', 'APP_PASSWORD', 'OTEL_LOG_USER_PROMPTS'])
        expect(call.envKeys).not.toContain(key);
    for (const call of await f.calls()) expect(call.envPath).toBe('/usr/bin:/bin:/usr/sbin:/sbin');
  });
  it('rejects unsupported custom provider routing instead of silently changing credential destinations', async () => {
    const f = await fixture();
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://gateway.example.test');
    await expect(createClaudeCodeProvider(f.options).explain(f.request)).rejects.toMatchObject({
      code: 'AI_CLI_INCOMPATIBLE',
    });
    expect(await f.calls()).toEqual([]);
  });
  it.each(['tools', 'mcp', 'plugin', 'permission', 'tool-use', 'hook'])(
    'rejects forbidden CLI runtime capability: %s',
    async (mode) => {
      const f = await fixture({ mode });
      await expect(createClaudeCodeProvider(f.options).explain(f.request)).rejects.toMatchObject({
        code: 'AI_PERMISSION_DENIED',
      });
      expect((await f.calls()).filter((call) => call.input)).toHaveLength(1);
      expect(await readFile(join(f.root, f.file), 'utf8')).toBe(f.code);
    },
  );
  it.each(['malformed', 'schema', 'language', 'missing', 'citation', 'ui-id', 'empty'])(
    'rejects invalid or unsupported structured output: %s',
    async (mode) => {
      const f = await fixture({ mode });
      await expect(createClaudeCodeProvider(f.options).explain(f.request)).rejects.toMatchObject({
        code: 'AI_INVALID_OUTPUT',
      });
      expect((await f.calls()).filter((call) => call.input)).toHaveLength(1);
    },
  );
  it.each([
    ['auth-failure', 'AI_AUTH_UNAVAILABLE'],
    ['quota', 'AI_QUOTA_EXHAUSTED'],
    ['stderr', 'AI_CLI_FAILED'],
  ])('classifies %s without leaking raw diagnostics', async (mode, code) => {
    const f = await fixture({ mode });
    const error = await createClaudeCodeProvider(f.options)
      .explain(f.request)
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ code });
    expect(JSON.stringify(error)).not.toContain('NEVER_EXPOSE_THIS');
    expect((await f.calls()).filter((call) => call.input)).toHaveLength(1);
  });
  it('retries a transient rate limit within the bounded policy', async () => {
    const f = await fixture({ mode: 'rate' });
    const result = await createClaudeCodeProvider(f.options).explainDetailed(f.request);
    expect(result.usage.attempts).toBe(2);
    expect(result.usage.inputTokens).toBe(115);
    expect((await f.calls()).filter((call) => call.input)).toHaveLength(2);
  });
  it('stops retrying at the configured limit', async () => {
    const f = await fixture({ mode: 'rate', failures: 10 });
    await expect(createClaudeCodeProvider(f.options).explain(f.request)).rejects.toMatchObject({
      code: 'AI_RATE_LIMITED',
    });
    expect((await f.calls()).filter((call) => call.input)).toHaveLength(2);
  });
  it.each([{ maxContextBytes: 512 }, { maxInputTokens: 1024 }, { maxTotalTokens: 1024 }])(
    'rejects oversized supplied context without invoking Claude: %j',
    async (limits) => {
      const f = await fixture();
      await expect(
        createClaudeCodeProvider({ ...f.options, ...limits }).explain(f.request),
      ).rejects.toMatchObject({ code: 'AI_BUDGET_EXCEEDED' });
      expect(await f.calls()).toEqual([]);
    },
  );
  it.each([{ mode: 'flood' }, { outputTokens: 9999 }, { inputTokens: 1000000 }])(
    'bounds CLI output and reported usage: %j',
    async (scenario) => {
      const f = await fixture(scenario);
      await expect(createClaudeCodeProvider(f.options).explain(f.request)).rejects.toMatchObject({
        code: 'AI_BUDGET_EXCEEDED',
      });
    },
  );
  it('checks fresh hashes and exact evidence ranges before transmission', async () => {
    const f = await fixture(),
      provider = createClaudeCodeProvider(f.options);
    await expect(provider.explain({ ...f.request, sourceHashes: {} })).rejects.toMatchObject({
      code: 'AI_CONTEXT_REJECTED',
    });
    await expect(
      provider.explain({
        ...f.request,
        evidence: [
          {
            ...f.evidence,
            evidence: {
              ...f.evidence.evidence,
              source: {
                file: f.file,
                start: { line: 1, column: 1 },
                end: { line: 1, column: f.code.length + 1 },
              },
              code: 'invented',
            },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'AI_CONTEXT_REJECTED' });
    await expect(
      provider.explain({
        ...f.request,
        evidence: [{ ...f.evidence, cacheStatus: 'stale', confidence: 'INFERRED' }],
      }),
    ).rejects.toMatchObject({ code: 'AI_CONTEXT_REJECTED' });
    expect(await f.calls()).toEqual([]);
  });
  it('uses the intersection of source and AI permissions, including canonical aliases', async () => {
    const f = await fixture();
    await expect(
      createClaudeCodeProvider({
        ...f.options,
        ai: { ...f.options.ai, permittedPaths: ['src/other/**'] },
      }).explain(f.request),
    ).rejects.toMatchObject({ code: 'AI_CONTEXT_REJECTED' });
    await writeFile(join(f.root, 'src/secrets.ts'), f.code);
    await rm(join(f.root, f.file));
    await symlink(join(f.root, 'src/secrets.ts'), join(f.root, f.file));
    await expect(createClaudeCodeProvider(f.options).explain(f.request)).rejects.toMatchObject({
      code: 'AI_CONTEXT_REJECTED',
    });
    expect(await f.calls()).toEqual([]);
  });
  it('rejects secret-bearing source, selected UI or questions before starting CLI', async () => {
    const f = await fixture(),
      provider = createClaudeCodeProvider(f.options);
    await expect(
      provider.explain({ ...f.request, question: 'password="do-not-send"' }),
    ).rejects.toMatchObject({ code: 'AI_CONTEXT_REJECTED' });
    const code = f.code + ' const api_key="private-value";';
    await writeFile(join(f.root, f.file), code);
    await expect(
      provider.explain({
        ...f.request,
        sourceHashes: { [f.file]: createHash('sha256').update(code).digest('hex') },
      }),
    ).rejects.toMatchObject({ code: 'AI_CONTEXT_REJECTED' });
    expect(await f.calls()).toEqual([]);
  });
  it('reports UI-only translations as UNKNOWN without source evidence', async () => {
    const f = await fixture();
    const result = await createClaudeCodeProvider(f.options).explain({
      ...f.request,
      evidence: [],
      sourceHashes: {},
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: 'translation', confidence: 'UNKNOWN', evidence: null });
  });
  it('rejects changed sources after inference instead of accepting stale explanations', async () => {
    const f = await fixture({ delay: 200 }),
      provider = createClaudeCodeProvider(f.options);
    const outcome = provider.explain(f.request).catch((error: unknown) => error);
    await until(async () => (await f.calls()).some((call) => !!call.input));
    await writeFile(join(f.root, f.file), f.code + '\n');
    expect(await outcome).toMatchObject({ code: 'SOURCE_CHANGED' });
  });
  it('cancels running work and preserves source', async () => {
    const f = await fixture({ mode: 'hang' }),
      controller = new AbortController();
    const outcome = createClaudeCodeProvider(f.options)
      .explain({ ...f.request, signal: controller.signal })
      .catch((error: unknown) => error);
    await until(async () => (await f.calls()).some((call) => !!call.input));
    controller.abort();
    expect(await outcome).toMatchObject({ code: 'CANCELLED' });
    expect(await readFile(join(f.root, f.file), 'utf8')).toBe(f.code);
  });
  it('times out and terminates inherited child processes', async () => {
    const f = await fixture({ mode: 'descendant' });
    await expect(
      createClaudeCodeProvider({ ...f.options, ai: { ...f.options.ai, timeoutMs: 1000 } }).explain(
        f.request,
      ),
    ).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    await new Promise((resolve) => setTimeout(resolve, 900));
    await expect(access(join(f.root, 'late-write'))).rejects.toThrow();
  });
  it('bounds queue length and permits cancellation while waiting', async () => {
    const f = await fixture({ delay: 250 }),
      provider = createClaudeCodeProvider({ ...f.options, maxQueue: 1 });
    const first = provider.explain(f.request);
    const controller = new AbortController();
    const queued = provider
      .explain({ ...f.request, signal: controller.signal })
      .catch((error: unknown) => error);
    await expect(provider.explain(f.request)).rejects.toMatchObject({ code: 'AI_QUEUE_FULL' });
    controller.abort();
    expect(await queued).toMatchObject({ code: 'CANCELLED' });
    await first;
    expect((await f.calls()).filter((call) => call.input)).toHaveLength(1);
  });
});
describe('bounded primitives', () => {
  it('reserves the concurrency slot for each queued request', async () => {
    const gate = new RequestGate(2, 4),
      controller = new AbortController();
    let active = 0,
      maximum = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        gate.run(controller.signal, async () => {
          maximum = Math.max(maximum, ++active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active--;
        }),
      ),
    );
    expect(maximum).toBe(2);
  });
  it.each([
    '-----BEGIN RSA PRIVATE KEY-----',
    'Bearer abcdefghijklmnop',
    'password: "private"',
    'https://user:password@example.test',
    'sk-ant-abcdefghijklmnopqrstuvwxyz',
    '"client_secret": "private-value"',
    'password: 123456',
    'token: "private-value"',
    'eyJabcdefghijk.abcdefghijk.abcdefghijk',
  ])('detects a sensitive context pattern', (value) => {
    expect(sensitiveText(value)).toBe(true);
  });
});
