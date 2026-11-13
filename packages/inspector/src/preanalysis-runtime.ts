import type { PageElement, PageItemStatus, PageProgress, RoutePayload } from '@devanalyst/core';
import { resolveElementSource } from './mapping-runtime.js';

export interface BrowserPageAnalysis {
  readonly requestId: string;
  readonly route: RoutePayload;
  readonly items: readonly (PageElement & PageItemStatus)[];
  readonly total: number;
  readonly completed: number;
  readonly scanned: number;
  readonly unknown: number;
  readonly limited: boolean;
}
const excluded =
  'input,textarea,select,option,script,style,noscript,template,devanalyst-inspector,[data-devanalyst-overlay],[contenteditable]:not([contenteditable="false"]),[data-devanalyst-private],[data-private]';
/** Incremental, viewport-only structural collection. Never reads text/HTML/form values/URLs. */
export function startPagePreanalysis(options: {
  readonly send: (type: 'page.index' | 'page.priority', payload: unknown) => boolean;
  readonly maxMessageBytes: number;
  readonly changed: () => void;
}) {
  let stopped = false,
    paused = true,
    scanGeneration = 0;
  let page: BrowserPageAnalysis | null = null;
  const items = new Map<string, PageElement & PageItemStatus>();
  const pending = new Map<string, PageElement>();
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let running = false;
  const observers = new Map<Document | ShadowRoot, MutationObserver>();
  let lastPriority = '',
    lastPriorityAt = 0;

  function structural(element: Element): PageElement | null {
    if (element.matches(excluded)) return null;
    let parent: Element | null = element;
    for (let depth = 0; parent && depth < 128; depth++) {
      if (
        parent.matches(excluded) ||
        parent.hasAttribute('hidden') ||
        parent.getAttribute('aria-hidden') === 'true'
      )
        return null;
      const root = parent.getRootNode();
      parent =
        parent.parentElement ??
        (root.nodeType === 11 && 'host' in root ? (root.host as Element) : null);
    }
    if (parent) return null;
    const rect = element.getBoundingClientRect();
    const view = element.ownerDocument.defaultView;
    if (
      !view ||
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.bottom < 0 ||
      rect.right < 0 ||
      rect.top > view.innerHeight ||
      rect.left > view.innerWidth
    )
      return null;
    const style = view.getComputedStyle(element);
    if (style.visibility !== 'visible' || style.display === 'none' || style.opacity === '0')
      return null;
    const mapping = resolveElementSource(element);
    if (mapping.status !== 'VERIFIED') {
      if (page) page = { ...page, unknown: page.unknown + 1 };
      return null;
    }
    const role = element.getAttribute('role');
    const kind: PageElement['kind'] =
      role === 'tab'
        ? 'tab'
        : role === 'menu' || role === 'menuitem' || element.localName === 'menu'
          ? 'menu'
          : element.localName === 'button' || role === 'button'
            ? 'button'
            : element.localName === 'a' || role === 'link'
              ? 'link'
              : element.localName === 'form'
                ? 'form'
                : 'component';
    return {
      elementId: mapping.elementId,
      file: mapping.source.file,
      revision: mapping.revision,
      tag: element.localName.toLowerCase(),
      kind,
    };
  }
  function add(element: PageElement, priority = false): void {
    if (!page) return;
    const previous = items.get(element.elementId);
    if (previous?.revision === element.revision && previous.kind === element.kind) return;
    if (!previous && items.size >= 128) {
      page = { ...page, limited: true };
      if (!priority) return;
      const victim =
        [...items.values()].find((item) => item.kind === 'component') ??
        items.values().next().value;
      if (!victim) return;
      items.delete(victim.elementId);
      pending.delete(victim.elementId);
    }
    items.set(element.elementId, {
      ...element,
      state: 'NOT_ANALYZED',
      aiState: 'NOT_ANALYZED',
      cache: 'miss',
      error: null,
    });
    pending.set(element.elementId, element);
    queueFlush();
  }
  function queueFlush(): void {
    if (!stopped && !paused) flushTimer ??= setTimeout(flush, 200);
  }
  function flush(): void {
    flushTimer = undefined;
    if (!page || stopped || paused) return;
    const batch = [...pending.values()].slice(0, 8);
    const payload = {
      requestId: page.requestId,
      route: page.route,
      elements: batch,
      limited: page.limited,
    };
    while (
      batch.length &&
      new TextEncoder().encode(JSON.stringify(payload)).length + 200 > options.maxMessageBytes
    )
      batch.pop();
    if (!batch.length && pending.size) {
      // An individual structural record/route can exceed a deliberately tiny transport limit.
      const oversized = pending.keys().next().value;
      if (oversized) {
        pending.delete(oversized);
        items.delete(oversized);
      }
      page = { ...page, limited: true };
      options.changed();
    } else if (options.send('page.index', payload)) {
      for (const element of batch) pending.delete(element.elementId);
    }
    if (pending.size) queueFlush();
  }
  function observe(root: Document | ShadowRoot): void {
    if (observers.has(root) || observers.size >= 32) return;
    const observer = new MutationObserver(() => schedule());
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['hidden', 'style', 'class', 'role', 'aria-hidden'],
    });
    observers.set(root, observer);
  }
  function scan(): void {
    scanTimer = undefined;
    if (stopped || paused || !page) return;
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    dirty = false;
    const generation = scanGeneration;
    page = { ...page, scanned: 0, unknown: 0 };
    const roots: (Document | ShadowRoot)[] = [document];
    const seen = new Set<Document | ShadowRoot>();
    let walker: TreeWalker | undefined;
    let visited = 0;
    function slice(): void {
      if (stopped || paused || generation !== scanGeneration || !page) {
        running = false;
        return;
      }
      scanTimer = undefined;
      const started = performance.now();
      let count = 0;
      try {
        while (count++ < 24 && performance.now() - started < 4 && visited < 3000) {
          if (!walker) {
            const root = roots.shift();
            if (!root) break;
            if (seen.has(root)) continue;
            seen.add(root);
            observe(root);
            walker =
              root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
                acceptNode: (node) =>
                  (node as Element).matches(excluded)
                    ? NodeFilter.FILTER_REJECT
                    : NodeFilter.FILTER_ACCEPT,
              }) ??
              document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
                acceptNode: (node) =>
                  (node as Element).matches(excluded)
                    ? NodeFilter.FILTER_REJECT
                    : NodeFilter.FILTER_ACCEPT,
              });
          }
          const node = walker.nextNode() as Element | null;
          if (!node) {
            walker = undefined;
            continue;
          }
          visited++;
          if (seen.size + roots.length < 32) {
            if (node.shadowRoot) roots.push(node.shadowRoot);
            if (node.localName === 'iframe') {
              try {
                const doc = (node as HTMLIFrameElement).contentDocument;
                if (doc) roots.push(doc);
              } catch {
                /* Opaque frame. */
              }
            }
          }
          const element = structural(node);
          if (element) add(element);
        }
        page = { ...page, scanned: visited, limited: page.limited || visited >= 3000 };
        if ((walker || roots.length) && visited < 3000) {
          scanTimer = setTimeout(slice, 16);
          return;
        }
      } catch {
        page = { ...page, limited: true };
      }
      running = false;
      options.changed();
      queueFlush(); // Empty pages still report a completed collection pass.
      if (dirty) schedule();
    }
    scanTimer = setTimeout(slice, 16);
  }
  function schedule(): void {
    if (stopped || paused) return;
    if (running) {
      dirty = true;
      return;
    }
    scanTimer ??= setTimeout(scan, 150);
  }
  function pause(): void {
    paused = true;
    scanGeneration++;
    running = false;
    clearTimeout(scanTimer);
    clearTimeout(flushTimer);
    scanTimer = undefined;
    flushTimer = undefined;
    for (const observer of observers.values()) observer.disconnect();
    observers.clear();
  }
  const scroll = () => schedule();
  const load = () => schedule();
  window.addEventListener('scroll', scroll, { passive: true, capture: true });
  window.addEventListener('resize', scroll, { passive: true });
  document.addEventListener('load', load, true);
  return {
    reset(route: RoutePayload): void {
      const same =
        page && page.route.pathname === route.pathname && page.route.hashPath === route.hashPath;
      if (!paused && same) return;
      pause();
      paused = false;
      stopped = false;
      items.clear();
      pending.clear();
      lastPriority = '';
      lastPriorityAt = 0;
      page = {
        requestId: crypto.randomUUID(),
        route: { ...route },
        items: [],
        total: 0,
        completed: 0,
        scanned: 0,
        unknown: 0,
        limited: false,
      };
      queueFlush();
      schedule();
    },
    refresh: schedule,
    prioritize(element: Element, priority: 'hovered' | 'selected'): void {
      if (!page || paused || stopped) return;
      const metadata = structural(element);
      if (!metadata) return;
      const key = `${metadata.elementId}:${priority}`;
      if (
        lastPriority === key ||
        (priority === 'hovered' && performance.now() - lastPriorityAt < 100)
      )
        return;
      lastPriority = key;
      lastPriorityAt = performance.now();
      add(metadata, true);
      const sent = options.send('page.priority', {
        requestId: page.requestId,
        element: metadata,
        priority,
      });
      if (!sent) {
        lastPriority = '';
        page = { ...page, limited: true };
        options.changed();
      }
    },
    progress(value: PageProgress): void {
      if (!page || value.requestId !== page.requestId) return;
      for (const item of value.items) {
        const previous = items.get(item.elementId);
        if (previous?.revision === item.revision)
          items.set(item.elementId, { ...previous, ...item });
      }
      page = {
        ...page,
        total: value.total,
        completed: value.completed,
        limited: page.limited || value.limited,
      };
      options.changed();
    },
    getSnapshot: (): BrowserPageAnalysis | null =>
      page ? structuredClone({ ...page, items: [...items.values()] }) : null,
    pause,
    stop(): void {
      stopped = true;
      pause();
      items.clear();
      pending.clear();
      page = null;
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', scroll);
      document.removeEventListener('load', load, true);
    },
  };
}
