# Translation and AI inspector

The floating inspector is shared across the [tested framework integrations](frameworks.md) and injected only during development. For React + Vite, register `devanalyst()` alongside the React Vite plugin.

- Hover for the original visible text, a fast glossary/cached Vietnamese translation when available, component/source origin and compact status. Move into the panel to scroll/select text and use controls without changing the target. Initial previews are click-through; entering the panel, focusing and scrolling do not start Claude inference.
- Alt+Click (Option+Click on macOS), or activate inspection with Alt+Shift+I and press Enter on the focused element, for pinned detailed analysis. The host handler does not run during this explicit inspection.
- Use Expand analysis / Compact view, Pin / Unpin and Escape / Close. Escape restores the previous focus when closing from inspector controls. Ordinary controls, navigation, forms and right-click work normally outside explicit inspection.
- Expanded inspection leads with Japanese → Vietnamese translation and an **Element flow** summary: rendering conditions, displayed value sources, and events/outcomes (disabled conditions, handlers, navigation, API requests and state updates). Missing evidence remains UNKNOWN. Handler guards accompany their action outcomes rather than becoming rendering conditions.
- Open **Source evidence and details** for the full findings, source call paths, search/confidence filters and DOM metadata. Empty technical categories are omitted. Click a file/range to reveal its attached source excerpt; use the separate guarded editor action to [open VS Code or Cursor](configuration.md). The host URL remains unchanged.
- Copy original, translation and analysis independently. The legacy Copy / Alt+C action copies bounded local DOM metadata. Clipboard denial is reported and text remains selectable.
- Choose English, Tiếng Việt or 日本語 chrome and a system/light/dark theme. Only these two preferences are stored in local storage. Provider explanations are currently Vietnamese and labeled accordingly.

## Enable optional AI

```ts
devanalyst({
  config: {
    inspector: { theme: 'system', language: 'vi' },
    ai: { enabled: true, permittedPaths: ['src/**'] },
  },
});
```

AI is disabled by default. With this explicit configuration, expanded inspection may transmit permitted source evidence and a matching **static source literal** to Claude Code. It uses the [existing fixed read-only provider policy](claude-code.md); installation, supported native CLI version, authentication and entitlement are still required. Optional automatic background AI has the separate `preanalysis.backgroundAI` switch; it is not required for a selected inspection.

The browser sends source IDs/revisions and a normalized text digest, never raw DOM text or form values. Node only translates bounded public JSX literals/labels whose text matches that digest and whose source hash is current. Dynamic expressions, private/editable content, form controls, custom children or unsupported source mappings do not become provider text. A local glossary candidate can still appear immediately with UNKNOWN/source-unverified status. Missing translation is displayed explicitly. The inspector never changes the Japanese text in the application.

## Progressive results and cache meaning

Translation runs independently of business analysis: glossary/persistent translation can appear while AST or deeper AI is still queued. The analysis lane runs deterministic source analysis first. The optional AI lane explains selected evidence without claiming observed execution. Each lane reports NOT_ANALYZED, QUEUED, ANALYZING, READY, STALE or FAILED, alongside completion/resource limits and cache state.

VERIFIED indicates evidenced source syntax/reference. INFERRED includes translation candidates and model explanations; UNKNOWN includes unresolved behavior or obsolete evidence. Static guards do not establish current runtime truth, and a source API reference does not prove a request occurred. Current DOM disabled observations are labeled separately.

Displayed value sources cover direct JSX child expressions/display attributes and Vue interpolations/display bindings. Up to four lexical variable/parameter declarations are shown where resolved (Vue uses the unshadowed root binding). They describe declarations such as `useState(0)`, props or `ref(0)`, not current runtime values or complete API-to-state dataflow. Native anchor destinations are included; dynamic destinations retain their expression and uncertainty. An absence of rendering findings does not prove unconditional visibility. Each summary entry retains expandable evidence, timestamp and cache state. The compact summary shows up to three conditions/values and six action findings; additional findings remain in source details. See [ADR 0015](adr/0015-element-flow-summary.md).

Cached · current source means guarded hashes/dependencies validated reuse. Freshly analyzed means a new result. Stale · revalidating retains historical content with UNKNOWN confidence; stale results are never silently promoted. HMR, route changes, disconnection and replacement selection cancel/downgrade obsolete work; late old messages are ignored. Failure of Claude leaves deterministic facts and the host application usable. Source changes may require selecting an element again if React replaced its DOM node.

SQLite separates translation from selected code explanations and survives dev server restart. See [persistent cache controls and recovery](persistent-cache.md). Node plugin `api.clearCache()` clears persistent records and invalidates inspector memory. The UI offers no filesystem/cache-administration RPC. Inline evidence is source-only; conversational follow-ups remain later work.

Bounds include 32 active selections, one AST worker for the fallback selected queue, one active inference per independent provider lane, 80 displayed findings per lane, four items per transport chunk, 16 browser/session result entries and explicit source/graph/time/transport budgets. The inherited page queue retains its configured limits. Content is rendered as text inside Shadow DOM. These bounds are not a claim that every project meets a latency target; see [measured validation](phase-09-validation.md) and [ADR 0011](adr/0011-translation-and-inspector-ui.md).

## Interactive hover preview

The owner-requested follow-up in [ADR 0014](adr/0014-interactive-hover-and-commerce-playgrounds.md) lets the pointer enter a hover panel, scroll/select text and use controls while retaining its current source element. A short handoff/retarget grace preserves the path; pointer/focus inside holds the preview. This does not pin implicitly or enable AI dispatch. Initial previews retain click-through/non-tab semantics; deliberate panel entry enables a region with controls. Height is constrained to available trigger-side space to prevent async results covering native clicks. Use Pin for a persistent selection, mouse Unpin to follow hover, and Escape/Close to dismiss. See [usage and realistic workflows](playgrounds.md). Earlier passive-tooltip descriptions record the original phase behavior.
