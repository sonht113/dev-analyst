import { z } from 'zod';

export const errorCodeSchema = z.enum([
  'INVALID_CONFIG',
  'INVALID_MESSAGE',
  'INVALID_LOG_ENTRY',
  'LOG_WRITE_FAILED',
  'CLI_NOT_INSTALLED',
  'AI_AUTH_UNAVAILABLE',
  'AI_QUOTA_EXHAUSTED',
  'AI_TIMEOUT',
  'AI_INVALID_OUTPUT',
  'AI_DISABLED',
  'AI_CLI_INCOMPATIBLE',
  'AI_PERMISSION_DENIED',
  'AI_CONTEXT_REJECTED',
  'AI_BUDGET_EXCEEDED',
  'AI_QUEUE_FULL',
  'AI_RATE_LIMITED',
  'AI_PROVIDER_UNAVAILABLE',
  'AI_CLI_FAILED',
  'CANCELLED',
  'WORKSPACE_ACCESS_DENIED',
  'SOURCE_MAPPING_UNAVAILABLE',
  'SOURCE_PARSE_FAILED',
  'SOURCE_NOT_FOUND',
  'SOURCE_CHANGED',
  'BRIDGE_DISCONNECTED',
  'BRIDGE_START_FAILED',
  'BRIDGE_PORT_IN_USE',
  'BRIDGE_AUTH_FAILED',
  'DEVELOPMENT_ONLY',
  'SOURCE_TOO_LARGE',
  'CACHE_CORRUPT',
  'UNSUPPORTED_FEATURE',
  'INTERNAL_ERROR',
]);

/** Wire-safe error. Callers must supply an actionable message without secrets. */
export const serializedErrorSchema = z.strictObject({
  code: errorCodeSchema,
  message: z.string().trim().min(1).max(2048),
  recoverable: z.boolean(),
});

export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type SerializedError = z.infer<typeof serializedErrorSchema>;

export interface DevAnalystErrorOptions {
  readonly recoverable?: boolean;
  readonly cause?: unknown;
}

/** Structured domain error; serialization deliberately excludes stack and cause. */
export class DevAnalystError extends Error {
  public readonly code: ErrorCode;
  public readonly recoverable: boolean;

  public constructor(code: ErrorCode, message: string, options: DevAnalystErrorOptions = {}) {
    const value = serializedErrorSchema.parse({
      code,
      message,
      recoverable: options.recoverable ?? true,
    });
    super(value.message, { cause: options.cause });
    this.name = 'DevAnalystError';
    this.code = value.code;
    this.recoverable = value.recoverable;
  }

  public toJSON(): SerializedError {
    return { code: this.code, message: this.message, recoverable: this.recoverable };
  }
}
