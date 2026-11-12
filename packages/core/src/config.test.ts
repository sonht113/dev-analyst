import { describe, expect, it } from 'vitest';
import {
  configSchema,
  defineConfig,
  sensitivePathPatterns,
  workspacePathSchema,
} from './config.js';

describe('configuration', () => {
  it('defaults to disabled AI with no source access grant', () => {
    const config = defineConfig({});
    expect(config.ai.enabled).toBe(false);
    expect(config.ai.permittedPaths).toEqual([]);
    expect(config.ai.concurrency).toBe(1);
    expect(config.source.include).toEqual(['src/**']);
  });

  it('requires explicitly permitted paths when enabling AI', () => {
    expect(configSchema.safeParse({ ai: { enabled: true } }).success).toBe(false);
    expect(
      defineConfig({ ai: { enabled: true, permittedPaths: ['src/components/**'] } }).ai.enabled,
    ).toBe(true);
  });

  it('retains minimum exclusions when users add their own', () => {
    const config = defineConfig({ source: { exclude: ['private/**'] } });
    expect(config.source.exclude).toEqual([...sensitivePathPatterns, 'private/**']);
    expect(defineConfig(config)).toEqual(config);
  });

  it.each([
    '../secret',
    '/etc/passwd',
    'C:\\keys',
    '\\\\server\\share',
    'src/../../secret',
    'src\0key',
  ])('rejects unsafe path syntax: %s', (path) => {
    expect(workspacePathSchema.safeParse(path).success).toBe(false);
  });

  it.each([
    { ai: { concurrency: 0 } },
    { ai: { concurrency: 5 } },
    { ai: { timeoutMs: 0 } },
    { cache: { maxSizeMb: 0 } },
    { unexpected: true },
    { ai: { unrestricted: true } },
  ])('rejects invalid configuration: %j', (input) => {
    expect(configSchema.safeParse(input).success).toBe(false);
  });
});
