import { describe, expect, it } from 'vitest';
import { createLogger, type LogRecord } from './logger.js';
import { DevAnalystError } from './errors.js';

describe('structured logging', () => {
  it('emits structured records and respects the level threshold', () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      scope: 'core',
      level: 'warn',
      sink: (record) => records.push(record),
      now: () => new Date('2026-11-12T04:00:00Z'),
    });
    expect(logger.log('debug', 'analysis.started').status).toBe('filtered');
    expect(
      logger.log('warn', 'analysis.failed', { code: 'SOURCE_PARSE_FAILED', count: 1 }).status,
    ).toBe('written');
    expect(records).toEqual([
      {
        timestamp: '2026-11-12T04:00:00.000Z',
        scope: 'core',
        level: 'warn',
        event: 'analysis.failed',
        metadata: { code: 'SOURCE_PARSE_FAILED', count: 1 },
      },
    ]);
  });

  it('does not write when logging is silent', () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      scope: 'core',
      level: 'silent',
      sink: (record) => records.push(record),
    });
    expect(logger.log('error', 'analysis.failed').status).toBe('filtered');
    expect(records).toEqual([]);
  });

  it('rejects arbitrary metadata without exposing it in an error', () => {
    const records: LogRecord[] = [];
    const logger = createLogger({ scope: 'core', sink: (record) => records.push(record) });
    const unsafe: Record<string, unknown> = { password: 'secret' };
    const result = logger.log('info', 'analysis.started', unsafe);
    expect(result.status).toBe('failed');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(records).toEqual([]);
  });

  it('returns a structured sink failure rather than crashing the caller', () => {
    const logger = createLogger({
      scope: 'core',
      sink: () => {
        throw new Error('private sink detail');
      },
    });
    const result = logger.log('error', 'analysis.failed');
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.error.code).toBe('LOG_WRITE_FAILED');
    expect(JSON.stringify(result)).not.toContain('private sink detail');
  });
});

describe('domain error serialization', () => {
  it('preserves stable fields and excludes causes and stack traces', () => {
    const error = new DevAnalystError('AI_TIMEOUT', 'Analysis timed out. Retry the selection.', {
      recoverable: true,
      cause: new Error('private token'),
    });
    expect(error).toBeInstanceOf(Error);
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      code: 'AI_TIMEOUT',
      message: 'Analysis timed out. Retry the selection.',
      recoverable: true,
    });
  });
});
