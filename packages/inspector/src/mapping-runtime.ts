import type {
  ElementSourceMapping,
  MappingSite,
  SourceModuleManifest,
  SourceReference,
} from '@devanalyst/core';

type MappingElement = Pick<Element, 'nodeType' | 'localName' | 'isConnected'>;
interface ModuleRecord {
  readonly manifest: SourceModuleManifest;
  active: boolean;
}
interface Binding {
  readonly module: ModuleRecord;
  readonly site: MappingSite;
  ambiguous: boolean;
}
export interface SourceModuleBinding {
  ref(index: number): (node: MappingElement | null) => void;
  invalidate(): void;
  invalidateSource(message: unknown): void;
}
const noop = (): void => undefined;
const unavailable: SourceModuleBinding = {
  ref: () => noop,
  invalidate: noop,
  invalidateSource: noop,
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function id(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
function source(value: unknown): value is SourceReference {
  if (
    !record(value) ||
    typeof value['file'] !== 'string' ||
    value['file'].length > 1024 ||
    !value['file'] ||
    /[\\:\0]/.test(value['file']) ||
    value['file'].startsWith('/') ||
    value['file'].split('/').includes('..')
  )
    return false;
  const start = value['start'],
    end = value['end'];
  const position = (point: unknown): point is { line: number; column: number } =>
    record(point) &&
    Number.isSafeInteger(point['line']) &&
    Number(point['line']) > 0 &&
    Number.isSafeInteger(point['column']) &&
    Number(point['column']) > 0;
  return (
    position(start) &&
    position(end) &&
    (end.line > start.line || (end.line === start.line && end.column >= start.column))
  );
}
function manifest(value: unknown): value is SourceModuleManifest {
  if (
    !record(value) ||
    value['version'] !== 1 ||
    !id(value['moduleId']) ||
    !id(value['revision']) ||
    !Array.isArray(value['sites']) ||
    value['sites'].length > 2048
  )
    return false;
  const seen = new Set<string>();
  return value['sites'].every((site: unknown) => {
    if (
      !record(site) ||
      !id(site['id']) ||
      seen.has(site['id']) ||
      typeof site['tag'] !== 'string' ||
      !/^[a-z][a-zA-Z0-9]*$/.test(site['tag']) ||
      !source(site['source'])
    )
      return false;
    seen.add(site['id']);
    const component = site['component'];
    return (
      component === null ||
      (record(component) &&
        id(component['id']) &&
        typeof component['name'] === 'string' &&
        component['name'].length > 0 &&
        component['name'].length <= 512 &&
        source(component['source']) &&
        component['source'].file === site['source'].file)
    );
  });
}

/** Public ref callbacks establish provenance; no attributes, selectors, values or Fiber access. */
export function createMappingRegistry() {
  const modules = new Map<string, ModuleRecord>();
  const nodes = new WeakMap<object, { readonly runtimeId: string; bindings: Binding[] }>();
  let totalSites = 0;
  function register(value: unknown): SourceModuleBinding {
    if (!manifest(value)) return unavailable;
    const previous = modules.get(value.moduleId);
    if (previous) previous.active = false;
    if (
      (!previous && modules.size >= 512) ||
      totalSites - (previous?.manifest.sites.length ?? 0) + value.sites.length > 10000
    )
      return unavailable;
    // Detach from caller-owned mutable objects before accepting evidence.
    const module: ModuleRecord = { manifest: structuredClone(value), active: true };
    if (previous) previous.active = false;
    totalSites += value.sites.length - (previous?.manifest.sites.length ?? 0);
    modules.set(value.moduleId, module);
    return {
      invalidate: () => {
        module.active = false;
      },
      invalidateSource(message: unknown) {
        if (
          record(message) &&
          message['moduleId'] === module.manifest.moduleId &&
          message['revision'] === module.manifest.revision
        )
          module.active = false;
      },
      ref(index: number) {
        const site = module.manifest.sites[index];
        if (!site) return noop;
        const binding: Binding = { module, site, ambiguous: false };
        let last: MappingElement | null = null;
        function remove(node: MappingElement): void {
          const entry = nodes.get(node);
          if (entry) entry.bindings = entry.bindings.filter((item) => item !== binding);
        }
        return (node: MappingElement | null): void => {
          if (node === null) {
            if (last) remove(last);
            last = null;
            return;
          }
          if (typeof node !== 'object' || node.nodeType !== 1 || typeof node.localName !== 'string')
            return;
          // One React element/ref reused at multiple live positions is ambiguous. Never invent an instance.
          if (last && last !== node && last.isConnected) binding.ambiguous = true;
          else if (last && last !== node) remove(last);
          last = node;
          let entry = nodes.get(node);
          if (!entry) {
            entry = { runtimeId: crypto.randomUUID(), bindings: [] };
            nodes.set(node, entry);
          }
          if (!entry.bindings.includes(binding)) {
            if (entry.bindings.length >= 4) {
              for (const old of entry.bindings) old.ambiguous = true;
              return;
            }
            entry.bindings.push(binding);
          }
        };
      },
    } satisfies SourceModuleBinding;
  }
  function resolve(element: MappingElement): ElementSourceMapping {
    const observedAt = new Date().toISOString();
    const node = nodes.get(element);
    const unknown = (
      reason: Extract<ElementSourceMapping, { status: 'UNKNOWN' }>['reason'],
    ): ElementSourceMapping => ({
      status: 'UNKNOWN',
      reason,
      source: null,
      component: null,
      runtimeId: node?.runtimeId ?? null,
      observedAt,
      cache: 'none',
    });
    if (!element.isConnected) return unknown('DETACHED_ELEMENT');
    if (!node?.bindings.length) return unknown('NOT_INSTRUMENTED');
    const current = node.bindings.filter(
      (binding) =>
        binding.module.active && modules.get(binding.module.manifest.moduleId) === binding.module,
    );
    if (!current.length) return unknown('STALE_SOURCE');
    const binding = current[0];
    if (!binding || current.length !== 1 || binding.ambiguous) return unknown('AMBIGUOUS_BINDING');
    if (binding.site.tag.toLowerCase() !== element.localName.toLowerCase())
      return unknown('TAG_MISMATCH');
    return {
      status: 'VERIFIED',
      source: structuredClone(binding.site.source),
      component: structuredClone(binding.site.component),
      elementId: binding.site.id,
      runtimeId: node.runtimeId,
      revision: binding.module.manifest.revision,
      strategy: 'compile-time-ref-v1',
      observedAt,
      cache: 'none',
    };
  }
  return { register, resolve };
}

type Registry = ReturnType<typeof createMappingRegistry>;
let localRegistry: Registry | undefined;
const sharedKey = Symbol.for('devanalyst.mapping.registry.v1');
function registry(): Registry {
  if (typeof window === 'undefined') return (localRegistry ??= createMappingRegistry());
  // Accessible same-origin iframe realms share a registry; opaque origins keep their own.
  let scope: Window = window;
  try {
    if (window.top?.location.origin === window.location.origin) scope = window.top;
  } catch {
    /* Opaque frame boundary. */
  }
  const shared = scope as Window & { [sharedKey]?: Registry };
  return (shared[sharedKey] ??= createMappingRegistry());
}
export function registerSourceModule(value: unknown): SourceModuleBinding {
  return registry().register(value);
}
export function resolveElementSource(element: Element): ElementSourceMapping {
  return registry().resolve(element);
}
