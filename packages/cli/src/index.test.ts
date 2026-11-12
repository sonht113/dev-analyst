import { describe, expect, it } from 'vitest';
import { runCli } from './index.js';

describe('foundation CLI', () => {
  it.each([
    ['dev', '--port', '65536'],
    ['dev', '--port', 'private-value'],
    ['doctor', '--port', '1234'],
  ])('rejects invalid command options without echoing values: %j', async (...args) => {
    const stderr: string[] = [];
    expect(
      await runCli(args, { stdout: () => undefined, stderr: (value) => stderr.push(value) }),
    ).toBe(2);
    expect(stderr.join('')).not.toContain('private-value');
    expect(JSON.parse(stderr.join('')).code).toBe('INVALID_CONFIG');
  });
  it.each([{ args: [] }, { args: ['--help'] }, { args: ['-h'] }])(
    'prints help for $args',
    async ({ args }) => {
      const stdout: string[] = [];
      const stderr: string[] = [];
      expect(
        await runCli(args, {
          stdout: (value) => stdout.push(value),
          stderr: (value) => stderr.push(value),
        }),
      ).toBe(0);
      expect(stdout.join('')).toContain('Usage: devanalyst');
      expect(stderr).toEqual([]);
    },
  );

  it('prints the version', async () => {
    const stdout: string[] = [];
    expect(
      await runCli(['--version'], {
        stdout: (value) => stdout.push(value),
        stderr: () => undefined,
      }),
    ).toBe(0);
    expect(stdout).toEqual(['0.1.0\n']);
  });

  it('rejects unavailable commands without echoing arbitrary arguments', async () => {
    const stderr: string[] = [];
    expect(
      await runCli(['inspect', 'private-token'], {
        stdout: () => undefined,
        stderr: (value) => stderr.push(value),
      }),
    ).toBe(2);
    expect(stderr.join('')).not.toContain('private-token');
    expect(JSON.parse(stderr.join('')).code).toBe('UNSUPPORTED_FEATURE');
  });
});
