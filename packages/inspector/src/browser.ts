import { createInspectionPanel } from './inspection-panel.js';
import type { InspectionSnapshot } from './inspection-client.js';
import { label, type DisplayLanguage } from './inspection-strings.js';
import { resolveElementSource } from './mapping-runtime.js';
import { extractElementMetadata, type ElementMetadata } from './metadata.js';

export interface ElementInspectorOptions {
  readonly theme?: 'system' | 'light' | 'dark';
  readonly language?: DisplayLanguage;
  readonly onInspection?: (metadata: ElementMetadata, expanded: boolean) => void;
  readonly getInspection?: () => InspectionSnapshot | null;
  readonly onClose?: () => void;
  readonly onPriority?: (element: Element, priority: 'hovered' | 'selected') => void;
}
export interface ElementInspectorHandle {
  stop(): void;
  setInspecting(enabled: boolean): void;
  getSnapshot(): {
    readonly inspecting: boolean;
    readonly pinned: boolean;
    readonly metadata: ElementMetadata | null;
    readonly error: string | null;
    readonly inspection: InspectionSnapshot | null;
  };
}
declare global {
  interface Window {
    __DEVANALYST_INSPECTOR__?: ElementInspectorHandle;
  }
}

/** Development-only DOM inspector; delegates source analysis through explicit callbacks. */
export function startElementInspector(
  options: ElementInspectorOptions = {},
): ElementInspectorHandle {
  window.__DEVANALYST_INSPECTOR__?.stop();
  const host = document.createElement('devanalyst-inspector');
  host.setAttribute('data-devanalyst-overlay', '');
  // Host inline styles prevent common page CSS from moving/capturing the overlay.
  host.style.cssText =
    'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;display:block!important;transform:none!important;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host{color-scheme:light dark;font:13px/1.45 system-ui,sans-serif;color:#172033}
    *{box-sizing:border-box} [hidden]{display:none!important}
    button{font:inherit;cursor:pointer;border:1px solid #6d7890;border-radius:5px;padding:5px 9px;background:var(--bg);color:var(--fg)}
    button:focus-visible{outline:3px solid #db8a00;outline-offset:2px} button[aria-pressed=true]{background:#174ab5;color:white}
    #surface{--bg:#fff;--fg:#172033;font:13px/1.45 system-ui,sans-serif;color:var(--fg)} #surface[data-theme=dark]{--bg:#192335;--fg:#f2f5ff}
    @media(prefers-color-scheme:dark){#surface[data-theme=system]{--bg:#192335;--fg:#f2f5ff}}
    #launch{position:fixed;bottom:12px;right:12px;pointer-events:auto;background:var(--bg);color:var(--fg)}
    #panel,#menu{position:fixed;pointer-events:auto;background:var(--bg);color:var(--fg);border:1px solid #72809a;border-radius:8px;padding:12px;box-shadow:0 5px 24px #0004;max-height: min(65vh,560px);overflow:auto;width:340px;max-width:calc(100vw - 16px)}
    #panel.expanded{width:520px;max-height:min(78vh,760px)}
    #panel{border-radius:12px;scrollbar-width:thin;overscroll-behavior:contain}
    #panel h3{font-size:12px;letter-spacing:.02em;margin:0 0 8px;color:var(--fg)}
    #panel p{margin:6px 0;overflow-wrap:anywhere;white-space:pre-wrap} #panel select,#panel input{font:inherit;background:var(--bg);color:var(--fg);border:1px solid #72809a;border-radius:5px;padding:6px;min-width:0}
    #panel a{color:#2563eb;overflow-wrap:anywhere;cursor:pointer} #surface[data-theme=dark] #panel a{color:#9fbeff}
    .inspection-controls,.inspection-copy,.inspection-filters{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.inspection-filters input{flex:1;width:100%}
    .translation-card,.finding-group{border-top:1px solid #8190a555;padding:12px 0 4px}.vietnamese{border-left:3px solid #14b8a6;padding-left:10px}
    .confidence{display:inline-block;border:1px solid currentColor;border-radius:20px;padding:1px 6px;margin:4px;font-size:10px;font-weight:650}.verified{color:#047857}.inferred{color:#a16207}.unknown{color:#64748b}
    .finding{padding:8px;border:1px solid #8190a555;border-radius:7px;margin:8px 0;overflow-wrap:anywhere}.finding-time,.cache-chip,.source-notice,.empty-evidence{font-size:11px;opacity:.85}
    .source-code{font:11px/1.6 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#8190a515;padding:8px;max-height:180px;overflow:auto;border-radius:5px}.call-trace{padding-left:22px;margin:6px 0}.call-trace li{padding:3px 0}
    .advanced-metadata summary{cursor:pointer;padding:8px 0}.advanced-metadata pre{max-height:180px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}
    @media(max-width:480px){#panel,#panel.expanded{width:calc(100vw - 16px);max-height:72vh}.inspection-controls select{max-width:45%}}
    #panel.passive select,#panel.passive input,#panel.passive a{display:none}
    #panel.passive{pointer-events:none} #panel.passive button{display:none}
    #menu{width:210px;display:grid;gap:6px} #heading{font-weight:700;margin:0 0 6px} #details{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0;max-height:280px;overflow:auto}
    #actions{display:flex;gap:6px;flex-wrap:wrap} #status,#hint{font-size:12px} .box{position:fixed;border:2px solid #2563eb;background:#2563eb18;pointer-events:none}
    #surface[data-theme=dark] .verified{color:#6ee7b7} #surface[data-theme=dark] .inferred{color:#fde68a} #surface[data-theme=dark] .unknown{color:#cbd5e1}
    @media(prefers-color-scheme:dark){#surface[data-theme=system] .verified{color:#6ee7b7} #surface[data-theme=system] .inferred{color:#fde68a} #surface[data-theme=system] .unknown{color:#cbd5e1}}
  `;
  shadow.append(style);
  const surface = document.createElement('div');
  surface.id = 'surface';
  surface.dataset['theme'] = options.theme ?? 'system';
  shadow.append(surface);
  function make<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    id: string,
    parent: Node = surface,
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.id = id;
    parent.appendChild(node);
    return node;
  }
  const boxes = make('div', 'boxes');
  boxes.setAttribute('aria-hidden', 'true');
  const launch = make('button', 'launch');
  launch.textContent = 'DevAnalyst · Inspect';
  launch.setAttribute('aria-pressed', 'false');
  launch.setAttribute('aria-keyshortcuts', 'Alt+Shift+I');
  const panel = make('section', 'panel');
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Element inspector');
  const heading = make('h2', 'heading', panel);
  const status = make('div', 'status', panel);
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const details = make('pre', 'details', panel);
  details.tabIndex = 0;
  const hint = make('div', 'hint', panel);
  hint.textContent = 'DOM observation · Source UNKNOWN · No cache';
  const actions = make('div', 'actions', panel);
  function button(label: string, parent: Node, action: () => void): HTMLButtonElement {
    const node = make('button', '', parent);
    node.textContent = label;
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }
  const pin = button('Pin', actions, () => {
    pinned = !pinned;
    render();
  });
  pin.setAttribute('aria-pressed', 'false');
  const copyAction = button('Copy', actions, () => {
    void copy();
  });
  const closeAction = button('Close', actions, () => {
    setInspecting(false);
    restoreFocus();
  });
  const menu = make('div', 'menu');
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'DevAnalyst inspection');
  const inspectAction = button('Inspect element', menu, () => {
    menu.hidden = true;
    pinned = true;
    detailed = true;
    refreshMetadata();
    render();
    pin.focus();
  });
  inspectAction.setAttribute('role', 'menuitem');
  const copyDOMAction = button('Copy DOM metadata', menu, () => {
    menu.hidden = true;
    void copy();
  });
  copyDOMAction.setAttribute('role', 'menuitem');
  const closeMenuAction = button('Close menu', menu, () => {
    menu.hidden = true;
    restoreFocus();
  });
  closeMenuAction.setAttribute('role', 'menuitem');
  document.documentElement.append(host);

  let disposed = false;
  let inspecting = false;
  let pinned = false;
  let detailed = false;
  let explicitlySelected = false;
  let pointerSelection = false;
  let selected: Element | null = null;
  let candidate: Element | null = null;
  let metadata: ElementMetadata | null = null;
  let error: string | null = null;
  let notice = '';
  let previousFocus: Element | null = null;
  let frame = 0;
  let extractTimer: ReturnType<typeof setTimeout> | undefined;
  let discoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let lastPoint: { x: number; y: number; doc: Document } | null = null;
  const cleanups: (() => void)[] = [];
  const documents = new Map<Document, () => void>();
  const roots = new Map<Node, MutationObserver>();
  const frames = new Map<HTMLIFrameElement, () => void>();
  const observer = new ResizeObserver(() => schedule());
  let displayLanguage = options.language ?? 'en';
  let displayTheme = options.theme ?? 'system';
  try {
    const stored: unknown = JSON.parse(localStorage.getItem('devanalyst.display.v1') ?? 'null');
    if (
      stored &&
      typeof stored === 'object' &&
      'language' in stored &&
      ['en', 'vi', 'ja'].includes(String(stored.language))
    ) {
      if (stored.language === 'en' || stored.language === 'vi' || stored.language === 'ja')
        displayLanguage = stored.language;
    }
    if (
      stored &&
      typeof stored === 'object' &&
      'theme' in stored &&
      (stored.theme === 'system' || stored.theme === 'light' || stored.theme === 'dark')
    )
      displayTheme = stored.theme;
  } catch {
    notice = 'Display preferences use session memory.';
  }
  surface.dataset['theme'] = displayTheme;
  const content = createInspectionPanel(panel, details, {
    language: displayLanguage,
    theme: displayTheme,
    mode: () => {
      detailed = !detailed;
      pinned = true;
      explicitlySelected = detailed;
      render();
    },
    preferences: (language, theme) => {
      displayLanguage = language;
      displayTheme = theme;
      surface.dataset['theme'] = theme;
      schedule();
      try {
        localStorage.setItem('devanalyst.display.v1', JSON.stringify({ language, theme }));
      } catch {
        notice = 'Display preferences use session memory.';
      }
    },
    copy: (value) => {
      void copyValue(value);
    },
  });

  function chrome(): void {
    text(launch, label(displayLanguage, inspecting ? 'inspecting' : 'inspect'));
    text(pin, label(displayLanguage, pinned ? 'unpin' : 'pin'));
    text(copyAction, label(displayLanguage, 'copyMetadata'));
    text(closeAction, label(displayLanguage, 'close'));
    text(inspectAction, label(displayLanguage, 'inspectElement'));
    text(copyDOMAction, label(displayLanguage, 'copyDOM'));
    text(closeMenuAction, label(displayLanguage, 'closeMenu'));
    panel.setAttribute('aria-label', label(displayLanguage, 'inspector'));
  }
  chrome();
  function restoreFocus(): void {
    if (
      previousFocus?.isConnected &&
      'focus' in previousFocus &&
      typeof previousFocus.focus === 'function'
    )
      previousFocus.focus({ preventScroll: true });
    previousFocus = null;
  }
  function close(): void {
    options.onClose?.();
    explicitlySelected = false;
    pointerSelection = false;
    selected = null;
    candidate = null;
    lastPoint = null;
    metadata = null;
    pinned = false;
    detailed = false;
    error = null;
    notice = '';
    clearTimeout(extractTimer);
    extractTimer = undefined;
    observer.disconnect();
    menu.hidden = true;
    panel.hidden = true;
    boxes.replaceChildren();
  }
  function setInspecting(enabled: boolean): void {
    if (disposed) return;
    inspecting = enabled;
    launch.setAttribute('aria-pressed', String(enabled));
    chrome();
    if (!enabled) close();
  }
  launch.addEventListener('click', () => setInspecting(!inspecting));
  function owned(event: Event): boolean {
    return event.composedPath().includes(host);
  }
  function target(event: Event): Element | null {
    const node = event.composedPath().find((node) => 'nodeType' in node && node.nodeType === 1);
    // Elements inside same-origin iframe belong to another realm.
    return node && 'nodeType' in node && node.nodeType === 1 ? (node as Element) : null;
  }
  function hit(doc: Document, x: number, y: number): Element | null {
    let element = doc.elementFromPoint(x, y);
    for (let depth = 0; element?.shadowRoot && depth < 16; depth += 1) {
      const next = element.shadowRoot.elementFromPoint(x, y);
      if (!next || next === element) break;
      element = next;
    }
    return element === host || host.contains(element) ? null : element;
  }
  function select(
    element: Element | null,
    full: boolean,
    priority: 'hovered' | 'selected' = 'selected',
  ): void {
    if (!element || element === host || disposed) return;
    try {
      options.onPriority?.(element, priority);
    } catch {
      error = 'Page analysis priority unavailable.';
    }
    if (priority === 'selected') explicitlySelected = true;
    else if (element !== selected) explicitlySelected = false;
    if (element === selected && full === detailed) return;
    selected = element;
    detailed = full;
    metadata = null;
    notice = '';
    error = null;
    observer.disconnect();
    observer.observe(element);
    // Throttle extraction separately from hit testing/geometry. Never walk DOM per pointer event.
    clearTimeout(extractTimer);
    extractTimer = setTimeout(
      () => {
        extractTimer = undefined;
        refreshMetadata();
      },
      full ? 0 : 100,
    );
    render();
  }
  function refreshMetadata(): void {
    if (!selected?.isConnected || disposed) return;
    try {
      metadata = extractElementMetadata(selected);
      error = null;
    } catch {
      metadata = null;
      error = 'DOM metadata unavailable. Select the element again.';
    }
    render();
  }
  function bridgeStatus(): string {
    const snapshot = window.__DEVANALYST_BRIDGE__?.getSnapshot();
    if (snapshot?.lastError && snapshot.status === 'connected')
      return 'Connected · Bridge error · Local runtime values remain private';
    if (snapshot?.status === 'connecting') return 'Connecting · DOM inspection remains local';
    if (snapshot?.status !== 'connected') return 'Disconnected · DOM inspection remains local';
    return 'Connected · Source-backed inspection';
  }
  function rects(element: Element): { x: number; y: number; width: number; height: number }[] {
    const fragments = element.getClientRects();
    return Array.from({ length: Math.min(fragments.length, 32) }, (_, index) => fragments[index])
      .filter((rect): rect is DOMRect => rect !== undefined)
      .map((rect) => {
        let x = rect.left;
        let y = rect.top;
        let width = rect.width;
        let height = rect.height;
        let current = element.ownerDocument;
        for (let depth = 0; current !== document && depth < 16; depth += 1) {
          const container = current.defaultView?.frameElement;
          if (!container) break;
          const bounds = container.getBoundingClientRect();
          const sx = bounds.width / ((container as HTMLElement).offsetWidth || bounds.width || 1);
          const sy =
            bounds.height / ((container as HTMLElement).offsetHeight || bounds.height || 1);
          x = bounds.left + (container.clientLeft + x) * sx;
          y = bounds.top + (container.clientTop + y) * sy;
          width *= sx;
          height *= sy;
          current = container.ownerDocument;
        }
        return { x, y, width, height };
      });
  }
  function position(node: HTMLElement, x: number, y: number): void {
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    node.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
    node.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
  }
  function text(node: HTMLElement, value: string): void {
    if (node.textContent !== value) node.textContent = value;
  }
  function render(): void {
    if (!selected) return;
    chrome();
    if (!selected.isConnected) {
      close();
      return;
    }
    panel.hidden = false;
    panel.classList.toggle('passive', !detailed && !pinned);
    panel.setAttribute('role', detailed || pinned ? 'region' : 'tooltip');
    details.tabIndex = detailed || pinned ? 0 : -1;
    text(
      heading,
      `<${selected.localName}>${pinned ? ' · ' + label(displayLanguage, 'pinned') : ''}`,
    );
    const mapping = resolveElementSource(selected);
    text(
      hint,
      mapping.status === 'VERIFIED'
        ? `${mapping.component?.name ?? 'Component unavailable'} · ${mapping.source.file}:${mapping.source.start?.line}:${mapping.source.start?.column} · VERIFIED JSX origin`
        : `Source UNKNOWN · ${mapping.reason} · No cache`,
    );
    if (
      metadata &&
      (metadata.mapping.status !== mapping.status ||
        (metadata.mapping.status === 'VERIFIED' &&
          mapping.status === 'VERIFIED' &&
          metadata.mapping.revision !== mapping.revision))
    ) {
      metadata = { ...metadata, mapping, source: mapping.source, sourceStatus: mapping.status };
    }
    const analysis = window.__DEVANALYST_BRIDGE__?.getSnapshot().pageAnalysis;
    const item =
      mapping.status === 'VERIFIED'
        ? analysis?.items.find(
            (entry) => entry.elementId === mapping.elementId && entry.revision === mapping.revision,
          )
        : null;
    const progress = analysis
      ? ` · Page ${analysis.completed}/${analysis.total}${analysis.limited ? ' · Limited' : ''}`
      : '';
    text(
      status,
      error ??
        (notice ||
          `${metadata ? '' : 'Reading DOM… · '}${bridgeStatus()}${item ? ` · AST ${item.state} · ${item.cache}` : ''}${progress}`),
    );
    pin.setAttribute('aria-pressed', String(pinned));
    text(
      details,
      metadata
        ? metadata.redacted
          ? label(displayLanguage, 'private')
          : metadata.text || metadata.accessibleLabel || label(displayLanguage, 'noText')
        : label(displayLanguage, 'loading'),
    );
    details.lang = metadata?.japaneseText.length ? 'ja' : 'und';
    if (metadata) options.onInspection?.(metadata, explicitlySelected && detailed);
    content.update(metadata, options.getInspection?.() ?? null, detailed, detailed || pinned);
    panel.classList.toggle('expanded', detailed);
    const bounds = rects(selected);
    boxes.replaceChildren(
      ...bounds.map((rect) => {
        const box = document.createElement('div');
        box.className = 'box';
        box.style.cssText = `left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px`;
        return box;
      }),
    );
    const first = bounds[0];
    if (first) position(panel, first.x, first.y + first.height + 8);
  }
  async function copyValue(value: string): Promise<void> {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      notice = label(displayLanguage, 'copied');
    } catch {
      error = label(displayLanguage, 'copyFailed');
    }
    if (!disposed) render();
  }
  async function copy(): Promise<void> {
    refreshMetadata();
    if (!metadata) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(metadata, null, 2));
      notice = 'DOM metadata copied';
    } catch {
      error = 'Copy unavailable. Select and copy the metadata text manually.';
    }
    if (!disposed) render();
  }
  function schedule(): void {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      try {
        if (!pinned && menu.hidden && lastPoint)
          candidate = hit(lastPoint.doc, lastPoint.x, lastPoint.y);
        if (!pinned && menu.hidden && candidate) select(candidate, detailed, 'hovered');
        render();
      } catch {
        error = 'Element geometry unavailable. Select the element again.';
        if (!panel.hidden) status.textContent = error;
      }
    });
  }
  function pointer(event: PointerEvent): void {
    if (owned(event) || pinned || !menu.hidden) return;
    const element = target(event);
    if (!element) return;
    lastPoint = { x: event.clientX, y: event.clientY, doc: element.ownerDocument };
    candidate = element;
    // Alt hover expands metadata while ordinary hover remains passive.
    detailed = inspecting || event.altKey;
    schedule();
  }
  function pointerDown(event: PointerEvent): void {
    pointerSelection = false;
    if (owned(event) || (!inspecting && !event.altKey) || event.button !== 0) return;
    const element = target(event);
    if (!element) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pointerSelection = true;
    previousFocus = element.ownerDocument.activeElement;
    pinned = true;
    select(element, true);
    pin.focus({ preventScroll: true });
  }
  function click(event: MouseEvent): void {
    // Opening the panel can move the mouse-up hit target. Consume the click
    // paired with our pointer-down instead of selecting its common ancestor.
    if (pointerSelection) {
      pointerSelection = false;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (owned(event)) return;
    if (!inspecting && !event.altKey) {
      if (!pinned) close();
      return;
    }
    const element = target(event);
    if (!element) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!pinned) previousFocus = element.ownerDocument.activeElement;
    pinned = true;
    select(element, true);
    pin.focus({ preventScroll: true });
  }
  function context(event: MouseEvent): void {
    if (owned(event) || (!inspecting && !event.altKey)) return;
    const element = target(event);
    if (!element) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    previousFocus = element.ownerDocument.activeElement;
    pinned = true;
    select(element, true);
    menu.hidden = false;
    const bounds = rects(element)[0];
    position(menu, bounds?.x ?? 8, bounds?.y ?? 8);
    menu.querySelector('button')?.focus();
  }
  function key(event: KeyboardEvent): void {
    const isOwned = owned(event);
    const element = target(event);
    const editing = element?.matches(
      'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
    );
    if (event.key === 'Escape' && (inspecting || pinned || !panel.hidden || !menu.hidden)) {
      if (inspecting || pinned || !menu.hidden) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      setInspecting(false);
      if (isOwned) restoreFocus();
      else previousFocus = null;
      return;
    }
    if (event.altKey && event.shiftKey && event.code === 'KeyI' && !editing) {
      event.preventDefault();
      setInspecting(!inspecting);
      return;
    }
    if (inspecting && !editing && event.key === 'Enter' && element && !isOwned) {
      event.preventDefault();
      event.stopImmediatePropagation();
      previousFocus = element;
      pinned = true;
      select(element, true);
      pin.focus();
      return;
    }
    if (isOwned && event.altKey && event.code === 'KeyP') {
      event.preventDefault();
      pinned = !pinned;
      render();
    }
    if (isOwned && event.altKey && event.code === 'KeyC') {
      event.preventDefault();
      void copy();
    }
    if (
      !menu.hidden &&
      isOwned &&
      ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)
    ) {
      event.preventDefault();
      const items = [...menu.querySelectorAll('button')];
      const active = shadow.activeElement;
      const index = items.findIndex((item) => item === active);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : (index + (event.key === 'ArrowUp' || event.shiftKey ? -1 : 1) + items.length) %
              items.length;
      items[next]?.focus();
    }
  }
  function listen(
    node: EventTarget,
    type: string,
    callback: EventListener,
    capture = true,
  ): () => void {
    node.addEventListener(type, callback, capture);
    return () => node.removeEventListener(type, callback, capture);
  }
  function observeRoot(root: Document | ShadowRoot): void {
    if (roots.has(root) || roots.size >= 64) return;
    const mutation = new MutationObserver((records) => {
      if (records.every((record) => record.target === host || host.contains(record.target))) return;
      schedule();
      if (
        selected &&
        records.some((record) => {
          let node: Node | null = record.target;
          for (let depth = 0; node && depth < 128; depth += 1) {
            if (node === selected) return true;
            const root = node.getRootNode();
            node =
              node.parentNode ??
              (root.nodeType === 11 && 'host' in root ? (root.host as Node) : null);
          }
          return (
            record.type === 'attributes' &&
            record.target.nodeType === 1 &&
            (record.target as Element).contains(selected)
          );
        })
      ) {
        extractTimer ??= setTimeout(() => {
          extractTimer = undefined;
          refreshMetadata();
        }, 120);
      }
      if (records.some((record) => record.type === 'childList'))
        discoveryTimer ??= setTimeout(() => {
          discoveryTimer = undefined;
          discover();
        }, 200);
    });
    mutation.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    roots.set(root, mutation);
  }
  function attach(doc: Document): void {
    if (documents.has(doc) || documents.size >= 32) return;
    const stops = [
      listen(doc, 'pointermove', pointer as EventListener),
      listen(doc, 'pointerdown', pointerDown as EventListener),
      listen(doc, 'click', click as EventListener),
      listen(doc, 'contextmenu', context as EventListener),
      listen(doc, 'keydown', key as EventListener),
      // A frame can finish loading before debounced subtree discovery runs.
      // Capture load in its parent document so the first child interaction is observed.
      listen(doc, 'load', (event) => {
        if (target(event)?.localName === 'iframe') discover();
      }),
      listen(doc, 'scroll', schedule),
      listen(doc.defaultView ?? doc, 'resize', schedule),
      listen(doc, 'pointerleave', (() => {
        if (!pinned && !detailed) {
          lastPoint = null;
          close();
        }
      }) as EventListener),
    ];
    documents.set(doc, () => stops.forEach((stop) => stop()));
    observeRoot(doc);
  }
  function discover(): void {
    if (disposed) return;
    for (const [doc, release] of documents)
      if (
        doc !== document &&
        (!doc.defaultView?.frameElement?.isConnected ||
          (doc.defaultView.frameElement as HTMLIFrameElement).contentDocument !== doc)
      ) {
        release();
        documents.delete(doc);
        roots.get(doc)?.disconnect();
        roots.delete(doc);
      }
    for (const [iframe, release] of frames)
      if (!iframe.isConnected) {
        release();
        frames.delete(iframe);
      }
    for (const [root, mutation] of roots)
      if (root.nodeType === 11 && 'host' in root && !(root.host as Element).isConnected) {
        mutation.disconnect();
        roots.delete(root);
      }
    const queue: (Document | ShadowRoot)[] = [document];
    let budget = 3000;
    for (let index = 0; index < queue.length && index < 64 && budget > 0; index += 1) {
      const root = queue[index];
      if (!root) continue;
      observeRoot(root);
      const walker = document.createTreeWalker(root, 1);
      for (let node = walker.nextNode(); node && budget-- > 0; node = walker.nextNode()) {
        const element = node as Element;
        if (element === host) continue;
        if (element.shadowRoot && queue.length < 64) queue.push(element.shadowRoot);
        if (element.localName !== 'iframe') continue;
        const iframe = element as HTMLIFrameElement;
        if (!frames.has(iframe) && frames.size < 32)
          frames.set(iframe, listen(iframe, 'load', discover));
        try {
          const doc = iframe.contentDocument;
          if (doc && queue.length < 64) {
            attach(doc);
            queue.push(doc);
          }
        } catch {
          /* Cross-origin/sandbox boundaries are intentionally opaque. Select the frame itself. */
        }
      }
    }
  }
  for (const type of [
    'click',
    'dblclick',
    'contextmenu',
    'pointerdown',
    'pointerup',
    'keydown',
    'keyup',
    'input',
    'change',
    'focusin',
    'focusout',
    'wheel',
  ]) {
    cleanups.push(listen(shadow, type, (event) => event.stopPropagation(), false));
  }
  cleanups.push(listen(window, 'devanalyst:bridge', schedule));
  cleanups.push(listen(window, 'devanalyst:inspection', schedule));
  cleanups.push(listen(window, 'pagehide', () => close()));
  // A low-frequency geometry check covers CSS animation/transforms without scanning the DOM.
  const geometryTimer = setInterval(() => {
    if (selected && !document.hidden) schedule();
  }, 100);
  const handle: ElementInspectorHandle = {
    setInspecting,
    getSnapshot: () => {
      const mapping = selected && metadata ? resolveElementSource(selected) : null;
      return {
        inspecting,
        pinned,
        inspection: options.getInspection?.() ?? null,
        metadata:
          metadata && mapping
            ? structuredClone({
                ...metadata,
                mapping,
                source: mapping.source,
                sourceStatus: mapping.status,
              })
            : null,
        error,
      };
    },
    stop: () => {
      if (disposed) return;
      disposed = true;
      close();
      cancelAnimationFrame(frame);
      clearInterval(geometryTimer);
      clearTimeout(discoveryTimer);
      documents.forEach((release) => release());
      frames.forEach((release) => release());
      roots.forEach((mutation) => mutation.disconnect());
      cleanups.forEach((release) => release());
      documents.clear();
      frames.clear();
      roots.clear();
      previousFocus = null;
      host.remove();
      if (window.__DEVANALYST_INSPECTOR__ === handle) delete window.__DEVANALYST_INSPECTOR__;
    },
  };
  attach(document);
  discover();
  window.__DEVANALYST_INSPECTOR__ = handle;
  return handle;
}
