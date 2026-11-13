import type { InspectorItem, SourceReference } from '@devanalyst/core';
import type { ElementMetadata } from './metadata.js';
import type { InspectionSnapshot, InspectionLane } from './inspection-client.js';
import { glossaryTranslation } from './glossary.js';
import { label, type DisplayLanguage, type Label } from './inspection-strings.js';
export function createInspectionPanel(
  parent: HTMLElement,
  originalNode: HTMLElement,
  options: {
    language: DisplayLanguage;
    theme: 'system' | 'light' | 'dark';
    mode: () => void;
    preferences: (language: DisplayLanguage, theme: 'system' | 'light' | 'dark') => void;
    copy: (text: string) => void;
  },
) {
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, container: Node = parent) => {
    const node = document.createElement(tag);
    container.appendChild(node);
    return node;
  };
  let language = options.language,
    theme = options.theme,
    metadata: ElementMetadata | null = null,
    snapshot: InspectionSnapshot | null = null,
    expanded = false,
    stamp = '';
  const controls = make('div');
  controls.className = 'inspection-controls';
  const mode = make('button', controls);
  mode.type = 'button';
  mode.addEventListener('click', options.mode);
  const languageSelect = make('select', controls);
  for (const [value, text] of [
    ['en', 'English'],
    ['vi', 'Tiếng Việt'],
    ['ja', '日本語'],
  ]) {
    const option = make('option', languageSelect);
    option.value = value ?? '';
    option.textContent = text ?? '';
  }
  languageSelect.value = language;
  const themeSelect = make('select', controls);
  for (const value of ['system', 'light', 'dark']) {
    const option = make('option', themeSelect);
    option.value = value;
  }
  themeSelect.value = theme;
  languageSelect.addEventListener('change', () => {
    const value = languageSelect.value;
    if (value === 'en' || value === 'vi' || value === 'ja') {
      language = value;
      options.preferences(language, theme);
      refresh();
    }
  });
  themeSelect.addEventListener('change', () => {
    const value = themeSelect.value;
    if (value === 'system' || value === 'light' || value === 'dark') {
      theme = value;
      options.preferences(language, theme);
      refresh();
    }
  });
  const originalSection = make('section');
  originalSection.className = 'translation-card';
  const originalHeading = make('h3', originalSection);
  originalSection.append(originalNode);
  originalNode.setAttribute('lang', 'ja');
  const translationSection = make('section');
  translationSection.className = 'translation-card vietnamese';
  const translationHeading = make('h3', translationSection),
    translation = make('p', translationSection);
  translation.setAttribute('lang', 'vi');
  translation.dataset['testid'] = 'translation-text';
  const translationStatus = make('p', translationSection);
  translationStatus.className = 'cache-chip';
  translationStatus.dataset['testid'] = 'translation-status';
  const copyRow = make('div');
  copyRow.className = 'inspection-copy';
  const buttons = new Map<Label, HTMLButtonElement>();
  for (const key of ['copyOriginal', 'copyTranslation', 'copyAnalysis'] as const) {
    const button = make('button', copyRow);
    button.type = 'button';
    button.addEventListener('click', () =>
      options.copy(
        key === 'copyOriginal'
          ? (originalNode.textContent ?? '')
          : key === 'copyTranslation'
            ? translatedText()
            : analysisText(),
      ),
    );
    buttons.set(key, button);
  }
  const analysisStatus = make('p');
  analysisStatus.className = 'cache-chip';
  analysisStatus.dataset['testid'] = 'analysis-status';
  const deep = make('div');
  deep.className = 'analysis-content';
  const explanation = make('p', deep);
  explanation.className = 'source-notice';
  const observed = make('p', deep);
  observed.className = 'source-notice';
  const filters = make('div', deep);
  filters.className = 'inspection-filters';
  const search = make('input', filters);
  search.type = 'search';
  search.maxLength = 128;
  const confidence = make('select', filters);
  for (const value of ['all', 'VERIFIED', 'INFERRED', 'UNKNOWN']) {
    const option = make('option', confidence);
    option.value = value;
  }
  const cards = make('div', deep);
  cards.className = 'finding-sections';
  const empty = make('p', deep);
  empty.className = 'empty-evidence';
  search.addEventListener('input', renderItems);
  confidence.addEventListener('change', renderItems);
  const metadataDetails = make('details', deep);
  metadataDetails.className = 'advanced-metadata';
  const metadataSummary = make('summary', metadataDetails),
    metadataText = make('pre', metadataDetails);
  function set(node: HTMLElement, value: string): void {
    if (node.textContent !== value) node.textContent = value;
  }
  function translatedText(): string {
    return snapshot?.translation.state === 'READY'
      ? snapshot.translation.items
          .filter((item) => item.group === 'translation')
          .map((item) => item.description)
          .join('\n')
      : snapshot?.translation.state === 'STALE' && snapshot.translation.items.length
        ? snapshot.translation.items.map((item) => item.description).join('\n')
        : (glossaryTranslation(originalNode.textContent ?? '') ?? '');
  }
  function analysisText(): string {
    return JSON.stringify(
      {
        source: metadata?.mapping.source ?? null,
        component: metadata?.mapping.component?.name ?? null,
        execution: 'not-evaluated',
        analysis: snapshot?.analysis ?? null,
        ai: snapshot?.ai ?? null,
      },
      null,
      2,
    );
  }
  function status(lane: InspectionLane | undefined): string {
    if (!lane) return label(language, 'waiting');
    if (lane.error === 'NO_STATIC_TEXT') return label(language, 'noStaticText');
    if (lane.error === 'PRIVATE_CONTEXT') return label(language, 'private');
    if (lane.error === 'AI_DISABLED') return label(language, 'aiDisabled');
    if (lane.state === 'STALE') return label(language, 'stale');
    if (['QUEUED', 'ANALYZING'].includes(lane.state))
      return (
        (lane.cache === 'stale' ? label(language, 'stale') + ' · ' : '') +
        label(language, 'loading')
      );
    if (lane.state === 'FAILED')
      return `${label(language, 'unavailable')} · ${lane.error ?? 'UNKNOWN'}`;
    if (lane.state === 'NOT_ANALYZED')
      return lane.error === 'EXPAND_TO_TRANSLATE'
        ? label(language, 'noTranslation')
        : label(language, 'waiting');
    return `${label(language, lane.cache === 'fresh' ? 'fresh' : lane.cache === 'stale' ? 'stale' : 'miss')}${lane.completion === 'partial' ? ' · ' + label(language, 'partial') : ''}${lane.limited ? ' · ' + label(language, 'more') : ''}`;
  }
  function evidence(
    container: HTMLElement,
    reference: SourceReference,
    code: string,
    id: string,
  ): void {
    const link = make('a', container);
    link.href = '#devanalyst-evidence-' + id;
    link.className = 'source-link';
    link.dataset['evidenceId'] = id;
    const position = reference.start
      ? `${reference.start.line}:${reference.start.column}`
      : 'UNKNOWN';
    link.textContent = `${reference.file}:${position}`;
    link.title = label(language, 'evidence');
    link.setAttribute('aria-expanded', 'false');
    const pre = make('pre', container);
    pre.id = 'devanalyst-evidence-' + id;
    pre.className = 'source-code';
    pre.tabIndex = 0;
    pre.hidden = true;
    pre.textContent = code || label(language, 'none');
    link.setAttribute('aria-controls', pre.id);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      pre.hidden = !pre.hidden;
      link.setAttribute('aria-expanded', String(!pre.hidden));
    });
  }
  function renderItems(): void {
    const opened = new Set(
      [...cards.querySelectorAll<HTMLAnchorElement>('a[aria-expanded="true"]')].map(
        (node) => node.dataset['evidenceId'],
      ),
    );
    const focused =
      parent.getRootNode() instanceof ShadowRoot
        ? (parent.getRootNode() as ShadowRoot).activeElement
        : null;
    const focusedId =
      focused instanceof HTMLElement && cards.contains(focused)
        ? focused.dataset['evidenceId']
        : undefined;
    cards.replaceChildren();
    const items = [...(snapshot?.ai.items ?? []), ...(snapshot?.analysis.items ?? [])];
    const groups: InspectorItem['group'][] = [
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
    ];
    for (const group of groups) {
      const section = make('section', cards);
      section.className = 'finding-group';
      section.dataset['group'] = group;
      const heading = make('h3', section);
      heading.textContent = label(language, group);
      const selected = items.filter(
        (item) =>
          item.group === group &&
          (confidence.value === 'all' || item.confidence === confidence.value) &&
          (!['handler', 'call'].includes(group) ||
            !search.value ||
            `${item.title} ${item.description} ${item.evidence?.source.file ?? ''} ${item.trace.map((source) => source.file).join(' ')}`
              .toLocaleLowerCase()
              .includes(search.value.toLocaleLowerCase())),
      );
      if (!selected.length) {
        const missing = make('p', section);
        missing.className = 'empty-evidence';
        missing.textContent = `UNKNOWN · ${label(language, 'none')}`;
        continue;
      }
      for (const item of selected) {
        const article = make('article', section);
        article.className = 'finding';
        const title = make('strong', article);
        title.textContent = item.title;
        const badge = make('span', article);
        badge.className = 'confidence ' + item.confidence.toLowerCase();
        badge.textContent = item.confidence;
        const body = make('p', article);
        body.textContent = item.description;
        if (item.evidence) evidence(article, item.evidence.source, item.evidence.code, item.id);
        if (item.trace.length) {
          const path = make('ol', article);
          path.className = 'call-trace';
          for (const [sourceIndex, source] of item.trace.entries()) {
            const li = make('li', path);
            evidence(
              li,
              source,
              item.evidence?.source.file === source.file &&
                item.evidence.source.start?.line === source.start?.line &&
                item.evidence.source.start?.column === source.start?.column &&
                item.evidence.source.end?.line === source.end?.line &&
                item.evidence.source.end?.column === source.end?.column
                ? item.evidence.code
                : '',
              item.id + '-' + sourceIndex,
            );
          }
        }
        const time = make('small', article);
        time.className = 'finding-time';
        time.textContent = `${item.cacheStatus} · ${new Date(item.analyzedAt).toLocaleTimeString(language)} · ${label(language, 'terms')}`;
      }
    }
    for (const link of cards.querySelectorAll<HTMLAnchorElement>('a[data-evidence-id]'))
      if (opened.has(link.dataset['evidenceId'] ?? '')) {
        link.setAttribute('aria-expanded', 'true');
        const code = link.nextElementSibling;
        if (code instanceof HTMLElement) code.hidden = false;
      }
    if (focusedId)
      cards
        .querySelector<HTMLAnchorElement>(`a[data-evidence-id="${CSS.escape(focusedId)}"]`)
        ?.focus({ preventScroll: true });
    empty.hidden = items.length > 0;
    empty.textContent =
      metadata?.mapping.status === 'VERIFIED'
        ? label(language, 'waiting')
        : label(language, 'noSource');
  }
  function refresh(): void {
    parent.lang = language;
    set(mode, label(language, expanded ? 'compact' : 'expanded'));
    mode.setAttribute('aria-expanded', String(expanded));
    languageSelect.setAttribute('aria-label', label(language, 'language'));
    themeSelect.setAttribute('aria-label', label(language, 'theme'));
    for (const option of themeSelect.options)
      option.textContent = label(
        language,
        option.value === 'dark' ? 'dark' : option.value === 'light' ? 'light' : 'system',
      );
    for (const option of confidence.options)
      option.textContent = option.value === 'all' ? label(language, 'all') : option.value;
    confidence.setAttribute('aria-label', label(language, 'all'));
    search.placeholder = label(language, 'filter');
    search.setAttribute('aria-label', label(language, 'filter'));
    set(originalHeading, label(language, 'original'));
    set(translationHeading, label(language, 'translation'));
    const translated = translatedText();
    set(
      translation,
      translated || label(language, metadata?.redacted ? 'private' : 'noTranslation'),
    );
    set(
      translationStatus,
      translated && (!snapshot || !snapshot.translation.items.length)
        ? `UNKNOWN · ${label(language, 'glossary')}`
        : `${snapshot?.translation.items[0]?.confidence ?? 'UNKNOWN'} · ${status(snapshot?.translation)}`,
    );
    for (const [key, button] of buttons) {
      set(button, label(language, key));
      button.disabled =
        key === 'copyOriginal'
          ? !(metadata?.text || metadata?.accessibleLabel) || !!metadata?.redacted
          : key === 'copyTranslation'
            ? !translated
            : !snapshot?.analysis.items.length && !snapshot?.ai.items.length;
    }
    set(
      analysisStatus,
      `${status(snapshot?.analysis)} · ${label(language, 'ai')}: ${status(snapshot?.ai)}`,
    );
    set(explanation, label(language, 'sourceOnly'));
    set(observed, label(language, 'observedDisabled'));
    observed.hidden =
      !metadata ||
      (!('disabled' in metadata.attributes) && metadata.attributes['aria-disabled'] !== 'true');
    set(metadataSummary, label(language, 'metadata'));
    set(metadataText, metadata ? JSON.stringify(metadata, null, 2) : '');
    deep.hidden = !expanded;
    controls.inert = false;
    renderItems();
  }
  return {
    update(
      next: ElementMetadata | null,
      nextSnapshot: InspectionSnapshot | null,
      isExpanded: boolean,
      interactive: boolean,
    ): void {
      metadata = next;
      snapshot = nextSnapshot;
      expanded = isExpanded;
      const key = [
        metadata?.mapping.status,
        metadata?.mapping.status === 'VERIFIED' ? metadata.mapping.revision : '',
        metadata?.text,
        metadata?.attributes['disabled'],
        metadata?.attributes['aria-disabled'],
        snapshot?.version,
        expanded,
        interactive,
        language,
        theme,
      ].join('|');
      controls.inert = !interactive;
      copyRow.inert = !interactive;
      deep.inert = !interactive;
      if (key === stamp) return;
      stamp = key;
      refresh();
      controls.inert = !interactive;
    },
    getLanguage: () => language,
  };
}
