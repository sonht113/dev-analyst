import { performance } from 'node:perf_hooks';
import { instrumentReactSource, type MappingDiagnostic } from '@devanalyst/analyzer';
import type { WorkspaceAccess } from './workspace.js';

export interface SourceMappingDiagnostic {
  readonly file: string;
  readonly status: 'instrumented' | 'unavailable';
  readonly reason:
    | 'MAPPED'
    | 'UNSUPPORTED'
    | 'SOURCE_READ_FAILED'
    | 'TRANSFORMED_INPUT'
    | 'TRANSFORM_FAILED'
    | 'REGISTRY_LIMIT';
  readonly sites: number;
  readonly skipped: readonly MappingDiagnostic[];
  readonly durationMs: number;
}
export function createSourceMapping(
  access: Promise<WorkspaceAccess>,
  runtimeUrl: string,
  onInvalidate: (change: { readonly moduleId: string; readonly revision: string }) => void = () =>
    undefined,
) {
  const diagnostics = new Map<string, SourceMappingDiagnostic>();
  let stopped = false;
  const revisions = new Map<string, { moduleId: string; revision: string }>();
  function invalidate(file: string): void {
    const current = revisions.get(file);
    if (current && !stopped) onInvalidate({ ...current });
  }
  function save(value: SourceMappingDiagnostic): void {
    if (diagnostics.size >= 512 && !diagnostics.has(value.file))
      diagnostics.delete(diagnostics.keys().next().value ?? '');
    diagnostics.set(value.file, value);
  }
  return {
    invalidate,
    diagnostics: (): readonly SourceMappingDiagnostic[] =>
      structuredClone([...diagnostics.values()]),
    stop: () => {
      stopped = true;
      diagnostics.clear();
      revisions.clear();
    },
    async transform(code: string, id: string) {
      if (stopped || !/\.[jt]sx$/.test(id) || id.includes('\0') || id.includes('?')) return null;
      const workspace = await access;
      const file = await workspace.sourcePath(id);
      if (!file || stopped) return null;
      const started = performance.now();
      const fail = (reason: SourceMappingDiagnostic['reason']) => {
        invalidate(file);
        save({
          file,
          status: 'unavailable',
          reason,
          sites: 0,
          skipped: [],
          durationMs: performance.now() - started,
        });
        return null;
      };
      let original: string;
      try {
        original = await workspace.readSource(file);
      } catch {
        return fail('SOURCE_READ_FAILED');
      }
      if (original !== code) return fail('TRANSFORMED_INPUT');
      if (!revisions.has(file) && revisions.size >= 512) return fail('REGISTRY_LIMIT');
      try {
        const result = instrumentReactSource(code, file, runtimeUrl);
        if (stopped) return null;
        const previous = revisions.get(file);
        if (previous && previous.revision !== result.manifest.revision) invalidate(file);
        revisions.set(file, {
          moduleId: result.manifest.moduleId,
          revision: result.manifest.revision,
        });
        save({
          file,
          status: result.manifest.sites.length ? 'instrumented' : 'unavailable',
          reason: result.manifest.sites.length ? 'MAPPED' : 'UNSUPPORTED',
          sites: result.manifest.sites.length,
          skipped: result.diagnostics,
          durationMs: performance.now() - started,
        });
        return result.map ? { code: result.code, map: result.map } : null;
      } catch {
        return fail('TRANSFORM_FAILED');
      }
    },
  };
}
