import { z } from 'zod';
import { logLevelSchema, type LogLevel } from './config.js';
import { DevAnalystError, errorCodeSchema } from './errors.js';

const identifierSchema = z.string().regex(/^[a-z][a-z0-9_.-]{0,95}$/);

/** An allowlist prevents arbitrary payloads, source snippets, or credentials in metadata. */
export const logMetadataSchema = z.strictObject({
  requestId: z.uuid().optional(),
  code: errorCodeSchema.optional(),
  durationMs: z.number().finite().nonnegative().optional(),
  count: z.number().int().nonnegative().optional(),
});

export type LogMetadata = z.infer<typeof logMetadataSchema>;
export type ActiveLogLevel = Exclude<LogLevel, 'silent'>;

export interface LogRecord {
  readonly timestamp: string;
  readonly level: ActiveLogLevel;
  readonly scope: string;
  readonly event: string;
  readonly metadata: LogMetadata;
}

export type LogResult =
  | { readonly status: 'written' | 'filtered' }
  | { readonly status: 'failed'; readonly error: DevAnalystError };

export interface Logger {
  /** Use a stable event identifier, never user text, source code, or secret values. */
  log(level: ActiveLogLevel, event: string, metadata?: LogMetadata): LogResult;
}

export interface LoggerOptions {
  readonly scope: string;
  readonly level?: LogLevel;
  readonly sink: (record: LogRecord) => void;
  readonly now?: () => Date;
}

const priorities: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

/** Creates a browser-safe logger without installing global hooks or emitting telemetry. */
export function createLogger(options: LoggerOptions): Logger {
  const scope = identifierSchema.parse(options.scope);
  const minimum = logLevelSchema.parse(options.level ?? 'info');
  const now = options.now ?? (() => new Date());

  return {
    log(level, event, metadata = {}): LogResult {
      const parsedLevel = logLevelSchema.exclude(['silent']).safeParse(level);
      const parsedEvent = identifierSchema.safeParse(event);
      const parsedMetadata = logMetadataSchema.safeParse(metadata);
      if (!parsedLevel.success || !parsedEvent.success || !parsedMetadata.success) {
        return {
          status: 'failed',
          error: new DevAnalystError(
            'INVALID_LOG_ENTRY',
            'Use a valid level, event, and safe metadata.',
          ),
        };
      }
      if (priorities[parsedLevel.data] < priorities[minimum]) {
        return { status: 'filtered' };
      }
      try {
        options.sink({
          timestamp: now().toISOString(),
          level: parsedLevel.data,
          scope,
          event: parsedEvent.data,
          metadata: parsedMetadata.data,
        });
        return { status: 'written' };
      } catch (cause: unknown) {
        return {
          status: 'failed',
          error: new DevAnalystError('LOG_WRITE_FAILED', 'The configured log sink failed.', {
            cause,
          }),
        };
      }
    },
  };
}
