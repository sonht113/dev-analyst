import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfigFromFile } from 'vite';
import {
  configSchema,
  DevAnalystError,
  type DevAnalystConfig,
  type DevAnalystConfigInput,
} from '@devanalyst/core';

/** Trusted executable project configuration, like vite.config.ts. Arrays replace; sections merge. */
export type ConfigurationFile = DevAnalystConfigInput & {
  readonly environments?: Readonly<Record<string, DevAnalystConfigInput>>;
};
export function defineConfig(input: ConfigurationFile): ConfigurationFile {
  return input;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function mergeConfiguration(base: unknown, override: unknown): unknown {
  if (!record(base) || !record(override)) return override;
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key))
      throw new DevAnalystError(
        'INVALID_CONFIG',
        'Unsupported configuration key. Use documented options.',
      );
    result[key] =
      record(result[key]) && record(override[key])
        ? mergeConfiguration(result[key], override[key])
        : override[key];
  }
  return result;
}
export function validateConfiguration(input: unknown): DevAnalystConfig {
  const result = configSchema.safeParse(input);
  if (!result.success) {
    const fields = [
      ...new Set(
        result.error.issues.map((issue) =>
          issue.path
            .filter(
              (part) =>
                typeof part === 'string' &&
                new Set([
                  'source',
                  'include',
                  'exclude',
                  'ai',
                  'enabled',
                  'provider',
                  'permittedPaths',
                  'depth',
                  'concurrency',
                  'timeoutMs',
                  'cache',
                  'directory',
                  'maxSizeMb',
                  'inspector',
                  'theme',
                  'language',
                  'shortcuts',
                  'toggle',
                  'pin',
                  'copy',
                  'workspaceRoot',
                  'bridge',
                  'host',
                  'port',
                  'strictPort',
                  'maxPortAttempts',
                  'maxConnections',
                  'maxMessageBytes',
                  'reconnectAttempts',
                  'analysis',
                  'routes',
                  'editor',
                  'command',
                  'logLevel',
                ]).has(part),
            )
            .join('.'),
        ),
      ),
    ]
      .slice(0, 8)
      .join(', ');
    throw new DevAnalystError(
      'INVALID_CONFIG',
      `Invalid DevAnalyst configuration (${fields || 'root options'}). Check types, bounds, documented keys, distinct shortcuts and explicit AI permittedPaths in devanalyst.config.ts.`,
    );
  }
  return result.data;
}
export async function loadConfiguration(
  root: string,
  mode = 'development',
  inline: DevAnalystConfigInput = {},
): Promise<DevAnalystConfig> {
  const file = resolve(root, 'devanalyst.config.ts');
  let data: unknown = {};
  try {
    const info = await lstat(file).catch((error: unknown) => {
      if (record(error) && error['code'] === 'ENOENT') return null;
      throw error;
    });
    if (info) {
      if (!info.isFile() || info.isSymbolicLink() || info.size > 65536)
        throw new Error('Invalid config file');
      const loaded = await loadConfigFromFile({ command: 'serve', mode }, file, root, 'silent');
      data = loaded?.config;
    }
  } catch {
    throw new DevAnalystError(
      'INVALID_CONFIG',
      'Cannot load devanalyst.config.ts. Fix its default export/imports and TypeScript syntax; use a regular file up to 64 KiB, then restart Vite.',
    );
  }
  if (!record(data))
    throw new DevAnalystError(
      'INVALID_CONFIG',
      'Export a configuration object from devanalyst.config.ts.',
    );
  if (![Object.prototype, null].includes(Object.getPrototypeOf(data)))
    throw new DevAnalystError(
      'INVALID_CONFIG',
      'Export a plain configuration object without a custom prototype.',
    );
  const { environments, ...base } = data;
  if (
    environments !== undefined &&
    (!record(environments) || Object.keys(environments).length > 32)
  )
    throw new DevAnalystError(
      'INVALID_CONFIG',
      'environments must map at most 32 Vite mode names to configuration objects.',
    );
  if (record(environments))
    for (const override of Object.values(environments))
      validateConfiguration(mergeConfiguration(mergeConfiguration(base, override), inline));
  const selected =
    record(environments) && Object.hasOwn(environments, mode) ? environments[mode] : {};
  return validateConfiguration(mergeConfiguration(mergeConfiguration(base, selected), inline));
}

/** Shared deterministic limits; explicit low-level analyzer limits take precedence. */
export function analysisLimits(config: DevAnalystConfig) {
  return { maxDepth: { shallow: 4, standard: 12, deep: 24 }[config.analysis.depth] };
}
/** Bounded glob matching for route exclusions: * within a segment, ** across segments. */
export function routeExcluded(
  config: DevAnalystConfig,
  route: { pathname: string; hashPath?: string | null | undefined },
): boolean {
  function matches(pattern: string, path: string): boolean {
    let previous = new Uint8Array(path.length + 1);
    previous[0] = 1;
    for (let index = 0; index < pattern.length; index++) {
      const token = pattern[index],
        next = new Uint8Array(path.length + 1);
      if (token === '*') {
        const recursive = pattern[index + 1] === '*';
        if (recursive) index++;
        next[0] = previous[0] ?? 0;
        for (let offset = 1; offset <= path.length; offset++)
          next[offset] =
            previous[offset] || ((recursive || path[offset - 1] !== '/') && next[offset - 1])
              ? 1
              : 0;
      } else
        for (let offset = 1; offset <= path.length; offset++)
          next[offset] = previous[offset - 1] && token === path[offset - 1] ? 1 : 0;
      previous = next;
    }
    return previous[path.length] === 1;
  }
  return config.routes.exclude.some(
    (pattern) =>
      matches(pattern, route.pathname) ||
      (route.hashPath != null && matches(pattern, route.hashPath)),
  );
}
