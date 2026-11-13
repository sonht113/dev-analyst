import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { DevAnalystError } from '@devanalyst/core';
import { aiError, type Options } from './options.js';

export function cancellation(signal: AbortSignal): DevAnalystError {
  return signal.reason instanceof DevAnalystError ? signal.reason : aiError('CANCELLED');
}
export class Deadline {
  readonly started = performance.now();
  readonly controller = new AbortController();
  readonly signal: AbortSignal = this.controller.signal;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly abort = () => this.controller.abort(aiError('CANCELLED'));
  constructor(
    private readonly ms: number,
    private readonly parent?: AbortSignal,
  ) {
    this.timer = setTimeout(() => this.controller.abort(aiError('AI_TIMEOUT')), ms);
    parent?.addEventListener('abort', this.abort, { once: true });
    if (parent?.aborted) this.abort();
  }
  check(): void {
    if (performance.now() - this.started >= this.ms) this.controller.abort(aiError('AI_TIMEOUT'));
    if (this.signal.aborted) throw cancellation(this.signal);
  }
  dispose(): void {
    clearTimeout(this.timer);
    this.parent?.removeEventListener('abort', this.abort);
  }
}
/** Slots include preparation, subprocesses, retries and cleanup. Queued requests retain their original deadline. */
export class RequestGate {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(
    private readonly concurrency: number,
    private readonly maximum: number,
  ) {}
  async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    if (signal.aborted) throw cancellation(signal);
    if (this.active >= this.concurrency) {
      if (this.queue.length >= this.maximum) throw aiError('AI_QUEUE_FULL');
      await new Promise<void>((resolve, reject) => {
        const grant = () => {
          signal.removeEventListener('abort', abort);
          resolve();
        };
        const abort = () => {
          const index = this.queue.indexOf(grant);
          if (index >= 0) this.queue.splice(index, 1);
          reject(cancellation(signal));
        };
        this.queue.push(grant);
        signal.addEventListener('abort', abort, { once: true });
      });
    } else this.active++;
    try {
      if (signal.aborted) throw cancellation(signal);
      return await work();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}
export async function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw cancellation(signal);
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(cancellation(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
export interface Executable {
  readonly path: string;
  readonly identity: string;
}
async function identity(file: string): Promise<string> {
  const item = await stat(file);
  if (!item.isFile()) throw aiError('CLI_NOT_INSTALLED');
  return `${item.dev}:${item.ino}:${item.size}:${item.mtimeMs}`;
}
export async function resolveExecutable(command: string): Promise<Executable> {
  if (process.platform === 'win32' || /\.(?:bat|cmd)$/i.test(command))
    throw aiError('AI_CLI_INCOMPATIBLE');
  const candidates = isAbsolute(command)
    ? [command]
    : command.includes('/') || command.includes('\\')
      ? []
      : (process.env['PATH'] ?? '')
          .split(delimiter)
          .filter(isAbsolute)
          .map((path) => join(path, command));
  for (const candidate of candidates) {
    try {
      const path = await realpath(candidate);
      await access(path, constants.X_OK);
      return { path, identity: await identity(path) };
    } catch {
      /* Try only the remaining explicit PATH candidates. */
    }
  }
  throw aiError('CLI_NOT_INSTALLED');
}
export function processEnvironment(options: Options): NodeJS.ProcessEnv {
  // No inherited NODE_OPTIONS, loader paths, CLI overrides, telemetry, helper commands or project variables.
  const env: NodeJS.ProcessEnv = {
    HOME: homedir(),
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: 'en_US.UTF-8',
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_MAX_RETRIES: '0',
    MAX_STRUCTURED_OUTPUT_RETRIES: '0',
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(options.maxOutputTokens),
    MAX_THINKING_TOKENS: '0',
    CLAUDE_CODE_DISABLE_THINKING: '1',
    CLAUDE_CODE_SKIP_PROMPT_HISTORY: '1',
  };
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}
export interface ProcessResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}
export async function runProcess(
  executable: Executable,
  args: readonly string[],
  cwd: string,
  options: Options,
  signal: AbortSignal,
  input = '',
  observe?: (chunk: string, final: boolean) => void,
): Promise<ProcessResult> {
  if (signal.aborted) throw cancellation(signal);
  try {
    if ((await identity(executable.path)) !== executable.identity)
      throw aiError('AI_CLI_INCOMPATIBLE');
  } catch (error: unknown) {
    throw error instanceof DevAnalystError ? error : aiError('CLI_NOT_INSTALLED');
  }
  if (signal.aborted) throw cancellation(signal);
  return new Promise((resolve, reject) => {
    const child = spawn(executable.path, [...args], {
      cwd,
      env: processEnvironment(options),
      shell: false,
      detached: true,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      bytes = 0,
      failure: DevAnalystError | undefined;
    let force: ReturnType<typeof setTimeout> | undefined;
    let abandon: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const kill = (kind: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, kind);
      } catch (error: unknown) {
        if (!(
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'ESRCH'
        ))
          failure ??= aiError('AI_PROVIDER_UNAVAILABLE');
      }
    };
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(force);
      clearTimeout(abandon);
      signal.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else resolve({ code, stdout, stderr });
    };
    const stop = (error: DevAnalystError) => {
      if (failure || done) return;
      failure = error;
      kill('SIGTERM');
      force = setTimeout(() => kill('SIGKILL'), 200);
      abandon = setTimeout(() => {
        kill('SIGKILL');
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        finish(null);
      }, 1500);
    };
    const abort = () => stop(cancellation(signal));
    signal.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > options.maxOutputBytes) {
        stop(aiError('AI_BUDGET_EXCEEDED'));
        return;
      }
      stdout += chunk;
      try {
        observe?.(chunk, false);
      } catch (error: unknown) {
        stop(error instanceof DevAnalystError ? error : aiError('AI_INVALID_OUTPUT'));
      }
    });
    child.stderr.on('data', (chunk: string) => {
      if (Buffer.byteLength(stderr) + Buffer.byteLength(chunk) > 16384)
        stop(aiError('AI_BUDGET_EXCEEDED'));
      else stderr += chunk;
    });
    child.stdin.on('error', () => {
      /* EPIPE is classified from process exit/output, never logged with input. */
    });
    child.on('error', () => {
      failure ??= aiError('AI_PROVIDER_UNAVAILABLE');
      finish(null);
    });
    child.on('close', (code) => {
      if (!failure)
        try {
          observe?.('', true);
        } catch (error: unknown) {
          failure = error instanceof DevAnalystError ? error : aiError('AI_INVALID_OUTPUT');
        }
      // Terminate inherited pipe holders even if the CLI exited first.
      if (failure) kill('SIGKILL');
      finish(code);
    });
    if (signal.aborted) abort();
    if (!failure) child.stdin.end(input);
    else child.stdin.end();
  });
}
