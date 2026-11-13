import type { InspectorItem, InspectorUpdate, RoutePayload } from '@devanalyst/core';
import type { ElementMetadata } from './metadata.js';
export interface InspectionLane {
  readonly state: InspectorUpdate['state'];
  readonly cache: InspectorUpdate['cache'];
  readonly completion: InspectorUpdate['completion'];
  readonly error: string | null;
  readonly limited: boolean;
  readonly items: readonly InspectorItem[];
}
export interface InspectionSnapshot {
  readonly requestId: string;
  readonly elementId: string;
  readonly revision: string;
  readonly version: number;
  readonly translation: InspectionLane;
  readonly analysis: InspectionLane;
  readonly ai: InspectionLane;
}
const states = ['NOT_ANALYZED', 'QUEUED', 'ANALYZING', 'READY', 'STALE', 'FAILED'];
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function source(value: unknown): boolean {
  if (
    !record(value) ||
    typeof value['file'] !== 'string' ||
    value['file'].length > 1024 ||
    value['file'].startsWith('/') ||
    /[\\:\0]/.test(value['file']) ||
    value['file'].split('/').includes('..')
  )
    return false;
  const position = (p: unknown) =>
    p === null ||
    (record(p) &&
      typeof p['line'] === 'number' &&
      Number.isInteger(p['line']) &&
      p['line'] > 0 &&
      typeof p['column'] === 'number' &&
      Number.isInteger(p['column']) &&
      p['column'] > 0);
  return position(value['start']) && position(value['end']);
}
export function isInspectorUpdate(value: unknown): value is InspectorUpdate {
  if (
    !record(value) ||
    typeof value['requestId'] !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(value['requestId']) ||
    typeof value['elementId'] !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value['elementId']) ||
    typeof value['revision'] !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value['revision']) ||
    !['translation', 'analysis', 'ai'].includes(String(value['lane'])) ||
    !states.includes(String(value['state'])) ||
    !['miss', 'fresh', 'stale'].includes(String(value['cache'])) ||
    !['complete', 'partial'].includes(String(value['completion'])) ||
    typeof value['reset'] !== 'boolean' ||
    typeof value['limited'] !== 'boolean' ||
    typeof value['observedAt'] !== 'string' ||
    !Number.isFinite(Date.parse(value['observedAt'])) ||
    !(
      value['error'] === null ||
      (typeof value['error'] === 'string' && /^[A-Z_]{1,64}$/.test(value['error']))
    ) ||
    !Array.isArray(value['items']) ||
    value['items'].length > 4
  )
    return false;
  return value['items'].every((item: unknown) => {
    if (
      !record(item) ||
      typeof item['id'] !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(item['id']) ||
      ![
        'translation',
        'purpose',
        'visibility',
        'disabled',
        'handler',
        'call',
        'api',
        'navigation',
        'state',
        'effect',
        'limitation',
      ].includes(String(item['group'])) ||
      typeof item['title'] !== 'string' ||
      item['title'].length > 160 ||
      typeof item['description'] !== 'string' ||
      item['description'].length > 2000 ||
      !['VERIFIED', 'INFERRED', 'UNKNOWN'].includes(String(item['confidence'])) ||
      !['miss', 'fresh', 'stale'].includes(String(item['cacheStatus'])) ||
      !Array.isArray(item['trace']) ||
      item['trace'].length > 8 ||
      !item['trace'].every(source) ||
      typeof item['analyzedAt'] !== 'string' ||
      !Number.isFinite(Date.parse(item['analyzedAt']))
    )
      return false;
    const evidence = item['evidence'];
    if (
      evidence !== null &&
      (!record(evidence) ||
        !source(evidence['source']) ||
        typeof evidence['code'] !== 'string' ||
        evidence['code'].length > 16384)
    )
      return false;
    return (
      item['confidence'] === 'UNKNOWN' || (evidence !== null && item['cacheStatus'] !== 'stale')
    );
  });
}
const empty = (): InspectionLane => ({
  state: 'NOT_ANALYZED',
  cache: 'miss',
  completion: 'complete',
  error: null,
  limited: false,
  items: [],
});
function stale(lane: InspectionLane): InspectionLane {
  return {
    ...lane,
    state: 'STALE',
    cache: 'stale',
    items: lane.items.map((item) => ({ ...item, confidence: 'UNKNOWN', cacheStatus: 'stale' })),
  };
}
export function createInspectionClient(options: {
  send: (type: 'inspector.request' | 'inspector.cancel', payload: unknown) => boolean;
  route: () => RoutePayload;
  pageId: () => string;
  changed: () => void;
}) {
  let current: InspectionSnapshot | null = null,
    signature = '',
    generation = 0,
    version = 0,
    stopped = false;
  let accepting = false;
  const cache = new Map<string, InspectionSnapshot>();
  function cancel(): void {
    if (current) options.send('inspector.cancel', { requestId: current.requestId });
    generation++;
    signature = '';
    current = null;
    accepting = false;
  }
  return {
    inspect(metadata: ElementMetadata, expanded: boolean): void {
      if (stopped || metadata.redacted || metadata.mapping.status !== 'VERIFIED') {
        if (current) cancel();
        return;
      }
      const mapping = metadata.mapping,
        original = (metadata.text || metadata.accessibleLabel).replace(/\s+/g, ' ').trim();
      const key = JSON.stringify([
        mapping.elementId,
        mapping.revision,
        mapping.runtimeId,
        original,
        expanded,
      ]);
      if (signature === key) return;
      cancel();
      signature = key;
      const epoch = generation;
      const previous = cache.get(key);
      current = {
        requestId: crypto.randomUUID(),
        elementId: mapping.elementId,
        revision: mapping.revision,
        version: ++version,
        translation: previous ? stale(previous.translation) : empty(),
        analysis: previous ? stale(previous.analysis) : empty(),
        ai: previous ? stale(previous.ai) : empty(),
      };
      const selection = current;
      accepting = true;
      options.changed();
      void (async () => {
        const textDigest =
          original.length > 0 && original.length <= 500
            ? [
                ...new Uint8Array(
                  await crypto.subtle.digest('SHA-256', new TextEncoder().encode(original)),
                ),
              ]
                .map((byte) => byte.toString(16).padStart(2, '0'))
                .join('')
            : null;
        if (stopped || generation !== epoch || current !== selection) return;
        const role = metadata.attributes['role'];
        const kind =
          role === 'tab'
            ? 'tab'
            : role === 'menu' || role === 'menuitem' || metadata.tag === 'menu'
              ? 'menu'
              : metadata.tag === 'button' || role === 'button'
                ? 'button'
                : metadata.tag === 'a' || role === 'link'
                  ? 'link'
                  : metadata.tag === 'form'
                    ? 'form'
                    : 'component';
        const sent = options.send('inspector.request', {
          requestId: selection.requestId,
          pageId: options.pageId(),
          element: {
            elementId: mapping.elementId,
            file: mapping.source.file,
            revision: mapping.revision,
            tag: metadata.tag.toLowerCase(),
            kind,
          },
          route: options.route(),
          textDigest,
          mode: expanded ? 'expanded' : 'compact',
        });
        if (!sent && current === selection) {
          current = {
            ...selection,
            analysis: { ...empty(), state: 'FAILED', error: 'BRIDGE_DISCONNECTED' },
            version: ++version,
          };
          options.changed();
        }
      })().catch(() => {
        if (current === selection) {
          current = {
            ...selection,
            analysis: { ...empty(), state: 'FAILED', error: 'INSPECTOR_UNAVAILABLE' },
            version: ++version,
          };
          options.changed();
        }
      });
    },
    accept(input: unknown): boolean {
      if (!isInspectorUpdate(input)) return false;
      if (
        !accepting ||
        !current ||
        input.requestId !== current.requestId ||
        input.elementId !== current.elementId ||
        input.revision !== current.revision
      )
        return true;
      const previous = current[input.lane];
      const combined = new Map((input.reset ? [] : previous.items).map((item) => [item.id, item]));
      for (const item of input.items)
        if (combined.size < 80 || combined.has(item.id)) combined.set(item.id, item);
      const lane: InspectionLane =
        input.state === 'STALE'
          ? stale(previous)
          : ['QUEUED', 'ANALYZING'].includes(input.state) &&
              input.items.length === 0 &&
              previous.items.length
            ? { ...stale(previous), state: input.state, error: input.error }
            : {
                state: input.state,
                cache: input.cache,
                completion: input.completion,
                error: input.error,
                limited: input.limited || combined.size >= 80,
                items: [...combined.values()],
              };
      current = { ...current, [input.lane]: lane, version: ++version };
      if (cache.size >= 16 && !cache.has(signature)) cache.delete(cache.keys().next().value ?? '');
      cache.set(signature, current);
      options.changed();
      return true;
    },
    invalidate(): void {
      cache.clear();
      signature = '';
      generation++;
      accepting = false;
      if (current) {
        current = {
          ...current,
          translation: stale(current.translation),
          analysis: stale(current.analysis),
          ai: stale(current.ai),
          version: ++version,
        };
        options.changed();
      }
    },
    getSnapshot: (): InspectionSnapshot | null => (current ? structuredClone(current) : null),
    cancel,
    stop(): void {
      cancel();
      stopped = true;
      cache.clear();
    },
  };
}
