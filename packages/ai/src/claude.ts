import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { DevAnalystError, findingSchema } from '@devanalyst/core';
import type {
  ClaudeCodeProvider,
  ClaudeReadiness,
  ExplanationRequest,
  ExplanationResult,
} from './contracts.js';
import {
  aiError,
  claudeOptionsSchema,
  compatibleVersion,
  safetyArguments,
  type ClaudeCodeOptions,
} from './options.js';
import {
  Deadline,
  RequestGate,
  pause,
  resolveExecutable,
  runProcess,
  type Executable,
} from './process.js';
import { ClaudeStream, inferenceArguments, responseJsonSchema, systemPrompt } from './protocol.js';
import { prepareContext, sensitiveText, verifySnapshots, type PreparedContext } from './context.js';

const globalGate = new RequestGate(4, 32);
const authSchema = z.looseObject({ loggedIn: z.boolean() });
/** No side effects at import/factory time. AI context transmission requires explicit enabled + permitted paths. */
export function createClaudeCodeProvider(input: ClaudeCodeOptions): ClaudeCodeProvider {
  const parsed = claudeOptionsSchema.safeParse(input);
  if (!parsed.success || (parsed.data.ai.enabled && !parsed.data.ai.permittedPaths.length))
    throw new DevAnalystError(
      'INVALID_CONFIG',
      'Provide bounded Claude options and explicit AI permitted paths.',
    );
  const options = parsed.data,
    gate = new RequestGate(options.ai.concurrency, options.maxQueue);
  function guard(inference: boolean): void {
    if (process.env['NODE_ENV'] === 'production') throw aiError('DEVELOPMENT_ONLY');
    if (inference && !options.ai.enabled) throw aiError('AI_DISABLED');
    if (
      process.env['ANTHROPIC_BASE_URL'] ||
      ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'].some(
        (key) => process.env[key] === '1',
      )
    )
      throw aiError('AI_CLI_INCOMPATIBLE');
  }
  async function job<T>(
    signal: AbortSignal | undefined,
    work: (deadline: Deadline, cwd: string) => Promise<T>,
  ): Promise<T> {
    if (signal !== undefined && !(signal instanceof AbortSignal))
      throw aiError('AI_CONTEXT_REJECTED');
    const deadline = new Deadline(options.ai.timeoutMs, signal);
    try {
      return await gate.run(deadline.signal, () =>
        globalGate.run(deadline.signal, async () => {
          deadline.check();
          const cwd = await mkdtemp(join(tmpdir(), 'devanalyst-claude-'));
          try {
            return await work(deadline, cwd);
          } finally {
            await rm(cwd, { recursive: true, force: true });
          }
        }),
      );
    } catch (error: unknown) {
      throw error instanceof DevAnalystError ? error : aiError('AI_PROVIDER_UNAVAILABLE');
    } finally {
      deadline.dispose();
    }
  }
  async function discover(deadline: Deadline, cwd: string) {
    const executable = await resolveExecutable(options.executable);
    const version = await runProcess(executable, ['--version'], cwd, options, deadline.signal);
    const match = /^(\d+\.\d+\.\d+) \(Claude Code\)\s*$/.exec(version.stdout);
    if (version.code !== 0 || match?.[1] !== compatibleVersion)
      throw aiError('AI_CLI_INCOMPATIBLE');
    const help = await runProcess(executable, ['--help'], cwd, options, deadline.signal);
    if (
      help.code !== 0 ||
      [
        '--safe-mode',
        '--restricted',
        '--json-schema',
        '--tools',
        '--setting-sources',
        '--strict-mcp-config',
        '--permission-mode',
        '--disable-slash-commands',
        '--no-session-persistence',
        '--max-budget-usd',
      ].some((flag) => !help.stdout.includes(flag))
    )
      throw aiError('AI_CLI_INCOMPATIBLE');
    const status = await runProcess(
      executable,
      [...safetyArguments, 'auth', 'status', '--json'],
      cwd,
      options,
      deadline.signal,
    );
    let raw: unknown;
    try {
      raw = JSON.parse(status.stdout);
    } catch {
      throw aiError('AI_AUTH_UNAVAILABLE');
    }
    const auth = authSchema.safeParse(raw);
    if (!auth.success) throw aiError('AI_AUTH_UNAVAILABLE');
    return { executable, authenticated: status.code === 0 && auth.data.loggedIn };
  }
  async function invoke(
    executable: Executable,
    cwd: string,
    deadline: Deadline,
    prompt: string,
    account?: (usage: { inputTokens: number; outputTokens: number }) => void,
  ) {
    deadline.check();
    const supplied = Buffer.byteLength(prompt + systemPrompt + responseJsonSchema);
    if (
      Buffer.byteLength(prompt) > options.maxContextBytes ||
      supplied > options.maxInputTokens ||
      supplied + options.maxOutputTokens > options.maxTotalTokens
    )
      throw aiError('AI_BUDGET_EXCEEDED');
    const stream = new ClaudeStream();
    const process = await runProcess(
      executable,
      inferenceArguments(options),
      cwd,
      options,
      deadline.signal,
      prompt,
      stream.observe,
    );
    const usage = stream.usage();
    account?.(usage);
    if (
      usage.inputTokens + usage.outputTokens > options.maxTotalTokens ||
      usage.outputTokens > options.maxOutputTokens
    )
      throw aiError('AI_BUDGET_EXCEEDED');
    return stream.finish(process);
  }
  function convert(
    context: PreparedContext,
    response: Awaited<ReturnType<typeof invoke>>['response'],
  ) {
    const findings: ExplanationResult['findings'][number][] = [],
      citations: ExplanationResult['citations'][number][] = [];
    for (const item of response.explanations) {
      if (
        sensitiveText(item.text) ||
        new Set(item.evidenceIds).size !== item.evidenceIds.length ||
        item.evidenceIds.some((id) => !context.evidence.has(id)) ||
        (item.kind === 'translation'
          ? !item.uiTextId || !context.uiText.has(item.uiTextId)
          : item.uiTextId !== null)
      )
        throw aiError('AI_INVALID_OUTPUT');
      const ui = item.uiTextId ? context.uiText.get(item.uiTextId) : null;
      const references = item.evidenceIds.flatMap((id) => {
        const reference = context.evidence.get(id);
        return reference && (!ui || reference.evidence?.code.includes(ui)) ? [reference] : [];
      });
      const evidence = references[0]?.evidence ?? null;
      // Semantic model prose is never promoted to VERIFIED merely for citing a real source.
      const confidence =
        evidence &&
        item.confidence !== 'UNKNOWN' &&
        references.every((reference) => reference.confidence !== 'UNKNOWN')
          ? 'INFERRED'
          : 'UNKNOWN';
      const finding = findingSchema.parse({
        id: randomUUID(),
        type: item.kind === 'translation' ? 'translation' : 'explanation',
        explanation: item.text,
        confidence,
        evidence,
        analyzedAt: new Date().toISOString(),
        cacheStatus: 'miss',
      });
      findings.push(finding);
      citations.push({
        findingId: finding.id,
        evidenceIds: references.map((reference) => reference.id),
        uiTextId: item.uiTextId,
      });
    }
    return { findings, citations };
  }
  const provider: ClaudeCodeProvider = {
    id: 'claude-code',
    async checkReadiness(input = {}): Promise<ClaudeReadiness> {
      let available = false,
        authenticated: boolean | null = null,
        compatible = false;
      try {
        guard(input.probe ?? false);
        return await job(input.signal, async (deadline, cwd) => {
          await resolveExecutable(options.executable);
          available = true;
          const found = await discover(deadline, cwd);
          compatible = true;
          authenticated = found.authenticated;
          if (!authenticated) throw aiError('AI_AUTH_UNAVAILABLE');
          if (input.probe) {
            const result = await invoke(
              found.executable,
              cwd,
              deadline,
              JSON.stringify({
                language: 'vi',
                question: 'Dịch lời chào tiếng Nhật sang tiếng Việt.',
                deterministicFindings: [],
                uiText: [{ id: 'probe', text: 'こんにちは' }],
              }),
            );
            if (
              !result.response.explanations.every(
                (item) =>
                  item.evidenceIds.length === 0 &&
                  (item.uiTextId === null || item.uiTextId === 'probe'),
              )
            )
              throw aiError('AI_INVALID_OUTPUT');
          }
          return {
            available: true,
            version: compatibleVersion,
            compatible: true,
            authenticated: true,
            nonInteractive: input.probe ? 'ready' : 'unverified',
            error: null,
          };
        });
      } catch (error: unknown) {
        const failure =
          error instanceof DevAnalystError ? error : aiError('AI_PROVIDER_UNAVAILABLE');
        return {
          available,
          version: compatible ? compatibleVersion : null,
          compatible,
          authenticated,
          nonInteractive: 'unavailable',
          error: failure.toJSON(),
        };
      }
    },
    async explainDetailed(request: ExplanationRequest): Promise<ExplanationResult> {
      guard(true);
      if (typeof request !== 'object' || request === null) throw aiError('AI_CONTEXT_REJECTED');
      return job(request.signal, async (deadline, cwd) => {
        const context = await prepareContext(options, request, deadline);
        const found = await discover(deadline, cwd);
        if (!found.authenticated) throw aiError('AI_AUTH_UNAVAILABLE');
        let attempts = 0,
          inputTokens = 0,
          outputTokens = 0;
        while (attempts <= options.retries) {
          deadline.check();
          if (
            (attempts + 1) * (context.tokenUpperBound + options.maxOutputTokens) >
            options.maxTotalTokens
          )
            throw aiError('AI_BUDGET_EXCEEDED');
          attempts++;
          try {
            const result = await invoke(
              found.executable,
              cwd,
              deadline,
              context.prompt,
              (usage) => {
                inputTokens += usage.inputTokens;
                outputTokens += usage.outputTokens;
                if (inputTokens + outputTokens > options.maxTotalTokens)
                  throw aiError('AI_BUDGET_EXCEEDED');
              },
            );
            if (
              result.inputTokens + result.outputTokens > options.maxTotalTokens ||
              result.outputTokens > options.maxOutputTokens
            )
              throw aiError('AI_BUDGET_EXCEEDED');
            await verifySnapshots(context, deadline);
            const converted = convert(context, result.response);
            return {
              requestId: request.requestId,
              provider: 'claude-code',
              language: 'vi',
              ...converted,
              usage: {
                attempts,
                inputTokens,
                outputTokens,
                suppliedTokenUpperBound: context.tokenUpperBound,
                durationMs: performance.now() - deadline.started,
              },
            };
          } catch (error: unknown) {
            if (
              !(error instanceof DevAnalystError) ||
              !['AI_RATE_LIMITED', 'AI_PROVIDER_UNAVAILABLE'].includes(error.code) ||
              attempts > options.retries
            )
              throw error;
            await pause(
              Math.min(options.retryDelayMs * 2 ** (attempts - 1), 5000),
              deadline.signal,
            );
            await verifySnapshots(context, deadline);
          }
        }
        throw aiError('AI_PROVIDER_UNAVAILABLE');
      });
    },
    async explain(request) {
      return (await provider.explainDetailed(request)).findings;
    },
  };
  return provider;
}
