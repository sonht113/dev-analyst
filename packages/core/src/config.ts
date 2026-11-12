import { z } from 'zod';

/** Minimum exclusions. Filesystem enforcement belongs to the source-access runtime. */
export const sensitivePathPatterns: readonly string[] = Object.freeze([
  '**/.env',
  '**/.env.*',
  '**/.git/**',
  '**/.ssh/**',
  '**/*.{pem,key,p12,pfx}',
  '**/node_modules/**',
]);

/** Workspace-relative syntax only; this does not resolve paths or symlinks. */
export const workspacePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .refine((value) => {
    const normalized = value.replaceAll('\\', '/');
    return (
      !normalized.startsWith('/') &&
      !/^[a-z]:/i.test(normalized) &&
      !normalized.includes('\0') &&
      !normalized.includes(':') &&
      !normalized.split('/').includes('..')
    );
  }, 'Expected a workspace-relative path without parent traversal');

export const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error', 'silent']);

/** Local bridge policy. Remote binding is deliberately unsupported. */
export const bridgeOptionsSchema = z.strictObject({
  host: z.literal('127.0.0.1').default('127.0.0.1'),
  port: z.number().int().min(0).max(65535).default(0),
  strictPort: z.boolean().default(true),
  maxPortAttempts: z.number().int().min(1).max(20).default(10),
  maxConnections: z.number().int().min(1).max(128).default(32),
  maxMessageBytes: z.number().int().min(1024).max(65_536).default(16_384),
  reconnectAttempts: z.number().int().min(0).max(20).default(12),
});

export type BridgeOptionsInput = z.input<typeof bridgeOptionsSchema>;
export type BridgeOptions = z.output<typeof bridgeOptionsSchema>;

/** Validated defaults are local, bounded, and do not opt the developer into AI. */
export const configSchema = z
  .strictObject({
    workspaceRoot: z.string().trim().min(1).max(4096).default('.'),
    source: z
      .strictObject({
        include: z.array(workspacePathSchema).min(1).max(100).default(['src/**']),
        exclude: z
          .array(workspacePathSchema)
          .max(100)
          .default([])
          .transform((patterns) => [...new Set([...sensitivePathPatterns, ...patterns])]),
      })
      .prefault({}),
    ai: z
      .strictObject({
        enabled: z.boolean().default(false),
        provider: z.literal('claude-code').default('claude-code'),
        permittedPaths: z.array(workspacePathSchema).max(100).default([]),
        depth: z.enum(['shallow', 'standard', 'deep']).default('standard'),
        concurrency: z.number().int().min(1).max(4).default(1),
        timeoutMs: z.number().int().min(1000).max(300_000).default(60_000),
      })
      .prefault({}),
    cache: z
      .strictObject({
        enabled: z.boolean().default(true),
        maxSizeMb: z.number().int().min(1).max(4096).default(256),
      })
      .prefault({}),
    inspector: z
      .strictObject({
        enabled: z.boolean().default(true),
        theme: z.enum(['system', 'light', 'dark']).default('system'),
      })
      .prefault({}),
    logLevel: logLevelSchema.default('info'),
  })
  .superRefine((config, context) => {
    if (config.ai.enabled && config.ai.permittedPaths.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['ai', 'permittedPaths'],
        message: 'Enabling AI requires explicit permitted workspace paths',
      });
    }
  });

export type DevAnalystConfigInput = z.input<typeof configSchema>;
export type DevAnalystConfig = z.output<typeof configSchema>;
export type LogLevel = z.infer<typeof logLevelSchema>;

/** Validate and normalize a configuration without loading files or starting services. */
export function defineConfig(input: DevAnalystConfigInput): DevAnalystConfig {
  return configSchema.parse(input);
}
