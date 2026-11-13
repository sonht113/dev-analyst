import type { ElementSourceMapping, SourceReference } from '@devanalyst/core';
import { resolveElementSource } from './mapping-runtime.js';
/** Local, bounded DOM observations. These are not source-code or behavior evidence. */
export interface ElementMetadata {
  readonly tag: string;
  readonly namespace: string | null;
  readonly attributes: Readonly<Record<string, string>>;
  readonly text: string;
  readonly japaneseText: readonly string[];
  readonly accessibleLabel: string;
  readonly labelSource: string;
  readonly childCount: number;
  readonly context: 'document' | 'shadow-root' | 'iframe';
  readonly truncated: boolean;
  readonly redacted: boolean;
  readonly observedAt: string;
  readonly sourceStatus: ElementSourceMapping['status'];
  readonly mapping: ElementSourceMapping;
  readonly source: SourceReference | null;
  readonly cache: 'none';
}

const excluded =
  'input,textarea,select,option,script,style,noscript,template,devanalyst-inspector,[data-devanalyst-overlay],[contenteditable]:not([contenteditable="false"]),[data-devanalyst-private],[data-private]';

function privateElement(element: Element): boolean {
  let current: Element | null = element;
  for (let depth = 0; current && depth < 128; depth += 1) {
    if (current.matches(excluded)) return true;
    const root = current.getRootNode();
    current =
      current.parentElement ??
      (root.nodeType === 11 && 'host' in root
        ? (root.host as Element)
        : root.nodeType === 9
          ? (current.ownerDocument.defaultView?.frameElement ?? null)
          : null);
  }
  // Fail closed for unusually deep trees.
  return current !== null;
}

function hidden(element: Element): boolean {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return (
    element.hasAttribute('hidden') ||
    element.getAttribute('aria-hidden') === 'true' ||
    style?.display === 'none' ||
    style?.visibility === 'hidden' ||
    style?.visibility === 'collapse' ||
    style?.opacity === '0'
  );
}

/** @internal Allowlisted attribute reads; redacted controls expose only structural type. */
export function readObservedAttributes(
  element: Pick<Element, 'getAttribute' | 'localName'>,
  redacted: boolean,
): Record<string, string> {
  const attributes: Record<string, string> = {};
  const allowed = [
    'id',
    'class',
    'role',
    'type',
    'aria-label',
    'aria-labelledby',
    'aria-describedby',
    'aria-expanded',
    'aria-pressed',
    'aria-disabled',
    'aria-checked',
    'alt',
    'title',
    'disabled',
    'tabindex',
  ];
  if (!redacted)
    for (const name of allowed) {
      const value = element.getAttribute(name);
      if (value !== null) attributes[name] = value.slice(0, 256);
    }
  // For controls collect only structural metadata, never labels/attributes that may contain values.
  if (redacted && /^(input|textarea|select)$/.test(element.localName)) {
    const type = element.getAttribute('type');
    if (type && /^[a-z-]{1,32}$/i.test(type)) attributes['type'] = type;
  }
  return attributes;
}

/** Never reads form values, arbitrary attributes, URLs, React internals, or HTML. */
export function extractElementMetadata(element: Element): ElementMetadata {
  const redacted = privateElement(element);
  const attributes = readObservedAttributes(element, redacted);
  let visited = 0;
  let truncated = false;
  const japaneseText: string[] = [];
  function visibleText(start: Element): string {
    const fragments: string[] = [];
    let length = 0;
    const stack: Node[] = [start];
    while (stack.length) {
      if (++visited > 400 || length >= 2000) {
        truncated = true;
        break;
      }
      const node = stack.pop();
      if (!node) break;
      if (node.nodeType === 3) {
        const parent = node.parentElement;
        if (!parent || privateElement(parent)) continue;
        const range = node.ownerDocument?.createRange();
        range?.selectNodeContents(node);
        if (!range?.getClientRects().length) continue;
        const raw = node.textContent ?? '';
        const remainingText = Math.max(0, 2000 - length);
        // Bound normalization even if one text node contains megabytes of whitespace/text.
        const normalizationLimit = remainingText * 4 + 256;
        if (raw.length > normalizationLimit) truncated = true;
        const value = raw
          .slice(0, normalizationLimit)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, remainingText);
        if (raw.length > remainingText && value.length === remainingText) truncated = true;
        if (value) {
          fragments.push(value);
          length += value.length + 1;
          if (
            /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(value) &&
            japaneseText.length < 32
          )
            japaneseText.push(value);
        }
      } else if (node.nodeType === 1) {
        const child = node as Element;
        if (privateElement(child) || hidden(child)) continue;
        // Reserve visits for descendants; a wide sibling list must not exhaust
        // the entire budget before any of its visible text can be read.
        const remaining = Math.max(0, Math.floor((400 - visited - stack.length) / 2));
        const children: Node[] = [];
        if (child.localName === 'slot' && 'assignedNodes' in child) {
          const assigned = (child as HTMLSlotElement).assignedNodes({ flatten: true });
          children.push(...assigned.slice(0, remaining));
          if (assigned.length > remaining) truncated = true;
          if (!assigned.length)
            for (let node = child.firstChild; node; node = node.nextSibling) {
              if (children.length >= remaining) {
                truncated = true;
                break;
              }
              children.push(node);
            }
        } else {
          const container = child.shadowRoot ?? child;
          for (let node = container.firstChild; node; node = node.nextSibling) {
            if (children.length >= remaining) {
              truncated = true;
              break;
            }
            children.push(node);
          }
        }
        stack.push(...children.reverse());
      }
    }
    return fragments.join(' ').slice(0, 2000);
  }
  const text = redacted ? '' : visibleText(element);
  let accessibleLabel = '';
  let labelSource = 'unavailable';
  if (!redacted) {
    const root = element.getRootNode();
    const references = (attributes['aria-labelledby'] ?? '').split(/\s+/).slice(0, 8);
    if ('getElementById' in root) {
      accessibleLabel = references
        .map((id) => {
          const label = (root as Document | ShadowRoot).getElementById(id);
          return label && !privateElement(label) ? visibleText(label) : '';
        })
        .filter(Boolean)
        .join(' ')
        .slice(0, 512);
      if (accessibleLabel) labelSource = 'aria-labelledby (visible text)';
    }
    if (!accessibleLabel)
      for (const name of ['aria-label', 'alt', 'title']) {
        const value = attributes[name];
        if (value) {
          accessibleLabel = value;
          labelSource = name;
          break;
        }
      }
    if (!accessibleLabel && text) {
      accessibleLabel = text.slice(0, 512);
      labelSource = 'visible text (candidate)';
    }
  }
  if (
    !accessibleLabel &&
    /^(input|textarea|select)$/.test(element.localName) &&
    'labels' in element
  ) {
    // Native associated label text is safe to inspect; its embedded controls are skipped.
    const labels = (element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).labels;
    accessibleLabel = Array.from(
      { length: Math.min(labels?.length ?? 0, 8) },
      (_, index) => labels?.[index],
    )
      .filter((label): label is HTMLLabelElement => label !== undefined)
      .map((label) => visibleText(label))
      .filter(Boolean)
      .join(' ')
      .slice(0, 512);
    if (accessibleLabel) labelSource = 'associated label (visible text)';
  }
  const mapping = resolveElementSource(element);
  return {
    tag: element.localName,
    namespace: element.namespaceURI,
    attributes,
    text,
    japaneseText,
    accessibleLabel,
    labelSource,
    childCount: element.childElementCount,
    context:
      element.ownerDocument.defaultView !== window
        ? 'iframe'
        : element.getRootNode().nodeType === 11
          ? 'shadow-root'
          : 'document',
    truncated,
    redacted,
    observedAt: new Date().toISOString(),
    sourceStatus: mapping.status,
    source: mapping.source,
    mapping,
    cache: 'none',
  };
}
