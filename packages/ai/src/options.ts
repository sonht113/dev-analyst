import { z } from 'zod';
import { configSchema, DevAnalystError } from '@devanalyst/core';

export const claudeOptionsSchema = z.strictObject({
  workspaceRoot: z.string().min(1).max(4096),
  source: configSchema.shape.source,
  ai: configSchema.shape.ai,
  /** Native executable or executable on PATH; command strings and batch files are unsupported. */
  executable: z.string().min(1).max(4096).default('claude'),
  model: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/)
    .default('sonnet'),
  maxQueue: z.number().int().min(0).max(32).default(8),
  retries: z.number().int().min(0).max(2).default(1),
  retryDelayMs: z.number().int().min(10).max(5000).default(1000),
  maxFindings: z.number().int().min(1).max(64).default(24),
  maxFiles: z.number().int().min(1).max(16).default(8),
  maxSourceBytes: z
    .number()
    .int()
    .min(256)
    .max(256 * 1024)
    .default(64 * 1024),
  maxContextBytes: z.number().int().min(512).max(64000).default(24000),
  maxInputTokens: z.number().int().min(1024).max(64000).default(16000),
  maxOutputTokens: z.number().int().min(256).max(8192).default(2048),
  maxTotalTokens: z.number().int().min(1024).max(128000).default(40000),
  maxBudgetUsd: z.number().min(0.01).max(10).default(0.5),
  maxOutputBytes: z
    .number()
    .int()
    .min(4096)
    .max(1024 * 1024)
    .default(256 * 1024),
});
export type ClaudeCodeOptions = z.input<typeof claudeOptionsSchema>;
export type Options = z.output<typeof claudeOptionsSchema>;
export function aiError(code: ConstructorParameters<typeof DevAnalystError>[0]): DevAnalystError {
  const messages: Partial<Record<typeof code, string>> = {
    AI_DISABLED:
      'Enable AI explicitly with permitted paths before sending context to the Claude provider.',
    CLI_NOT_INSTALLED: 'Install the native Claude Code CLI or configure its executable path.',
    AI_CLI_INCOMPATIBLE:
      'This adapter requires Claude Code 2.1.323 and its restricted structured-output capabilities.',
    AI_AUTH_UNAVAILABLE:
      'Claude CLI authentication is unavailable. Authenticate the CLI separately; SDK access is not assumed.',
    AI_QUOTA_EXHAUSTED:
      'Claude reported a billing or quota restriction. Check the configured CLI account.',
    AI_RATE_LIMITED: 'Claude rate-limited this request. Retry later.',
    AI_PROVIDER_UNAVAILABLE:
      'Claude could not complete the request. Check CLI/provider availability.',
    AI_CLI_FAILED:
      'Claude exited unsuccessfully. Check the CLI separately; raw CLI output is intentionally omitted.',
    AI_PERMISSION_DENIED:
      'Claude did not preserve the required no-tools execution policy. No result was accepted.',
    AI_INVALID_OUTPUT:
      'Claude returned missing, malformed or unsupported structured output. No result was accepted.',
    AI_CONTEXT_REJECTED:
      'Context was excluded, sensitive, stale, too large or lacked matching source evidence.',
    AI_BUDGET_EXCEEDED: 'The request exceeded a configured context, output or token budget.',
    AI_QUEUE_FULL: 'The bounded Claude request queue is full. Retry later.',
    AI_TIMEOUT: 'The Claude request exceeded its deadline and was terminated.',
    CANCELLED: 'The Claude request was cancelled and terminated.',
    DEVELOPMENT_ONLY: 'Claude integration is available only outside production.',
  };
  return new DevAnalystError(
    code,
    messages[code] ?? 'Claude integration could not safely complete this request.',
  );
}
export const compatibleVersion = '2.1.323';
export const safetyArguments: readonly string[] = Object.freeze([
  '--safe-mode',
  '--restricted',
  '--setting-sources',
  '',
  '--settings',
  JSON.stringify({
    disableAllHooks: true,
    disableClaudeAiConnectors: true,
    permissions: {
      defaultMode: 'dontAsk',
      deny: [
        'Bash',
        'PowerShell',
        'Edit',
        'Write',
        'Read',
        'Glob',
        'Grep',
        'Agent',
        'WebFetch',
        'WebSearch',
        'Skill',
        'NotebookEdit',
      ],
    },
  }),
]);
