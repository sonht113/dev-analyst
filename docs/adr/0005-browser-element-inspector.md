# ADR 0005: Phase 03 Browser Element Inspector

Status: accepted for the owner's explicit Phase 03 browser-inspector request.

## Context and sequencing

The previous roadmap scheduled React mapping as Phase 03 and browser inspection as part of Phase 05. The owner now explicitly requests “Phase 03: Browser Element Inspector”, with selection, overlays, DOM metadata, privacy, accessibility and browser tests. This request changes delivery order, not the complete feature requirements. React instrumentation/mapping, source analysis, editor navigation and AI remain pending and require separate authorization. The reference to dynamic Vue rendering does not override the permanent React + Vite scope: this runtime uses native DOM APIs and the supported integration/testing remains React + Vite only.

## Decision

Extend the existing development-only browser runtime with a local element inspector. Vite serves exactly three allowlisted ESM assets through the existing trusted-request middleware: the runtime, browser interactions/UI and metadata extraction. They resolve through explicit inspector package exports. Requests cannot select arbitrary files. Theme is serialized from the already validated plugin configuration. Production builds still inject nothing.

The constitution proposes React/Tailwind for inspector UI. For this phase use native DOM and scoped CSS inside one Shadow DOM host. The Phase 02 runtime is served as static ESM assets with TypeScript project-reference builds, without a browser dependency bundler. Importing React/ReactDOM through that path would require new bundling/prebundling and host dependency resolution, and could couple the tool to the inspected application's React version. The small inspector has no component hierarchy that requires React. Native DOM keeps this runtime self-contained, browser-safe, separately stoppable, and independent of the application's renderer. This is a deliberate stack exception, not a framework adapter or a change to supported application frameworks.

Ordinary hover is passive with pointer-transparent tooltip/highlights. Alt hover expands local metadata. Alt+Click or explicit Inspect mode pins selection; Alt+right-click or Inspect mode opens the custom menu. Native right-click remains available outside those opt-in interactions. Capture handlers suppress activation only for explicit inspection; events inside our own Shadow DOM stop at that boundary. Keyboard inspection, menu navigation, focus restoration, pin/unpin, close and explicit clipboard copy are supported.

Hit testing uses composed event paths and open-shadow-root descent. Geometry uses client rectangles, updated on scroll/resize/mutation/selected-element resize and a 100 ms geometry-only interval while a selection exists. Same-origin iframe coordinates include frame borders and axis-aligned scaling, including nested frames. Delegated document listeners do not depend on React nodes surviving navigation or HMR. Frame/root discovery is debounced and bounded; following the CI first-click regression, observed parent documents also capture iframe load and invoke bounded discovery immediately, with the delegate removed during document teardown; teardown removes observers, listeners, timers, host and handles.

Metadata is a timestamped DOM observation with `sourceStatus: UNKNOWN`, `source: null`, `cache: none`. It never claims source behavior. Extraction is limited to 400 visited nodes, 2,000 visible-text characters, 32 Japanese-script fragments, eight label references, and allowlisted attributes capped at 256 characters each. Japanese detection includes Han characters and is a script heuristic, not language identification or translation. Accessible labels are explicit candidates with a named source, not a full browser accessible-name algorithm.

Never read form values or arbitrary attributes/HTML. Exclude input/textarea/select/option contents, editable/private subtrees, script/style/template content, hidden text, event attributes, URLs and data attributes. Controls expose structural type and safe visible associated-label text; their own descriptive attributes are omitted. `data-devanalyst-private` and `data-private` redact descendants across accessible shadow/frame ancestry. Only explicit Copy writes metadata to the local clipboard. No metadata is sent through the WebSocket, persisted, logged, or sent to AI.

## Limits and consequences

- Cross-origin/sandboxed frame internals and closed shadow roots remain opaque. The boundary element can be selected where its surface receives events.
- Discovery is capped at 3,000 elements/pass, 64 roots and 32 documents/frames; arbitrary newly attached shadow roots without a DOM mutation are discovered on a subsequent DOM discovery pass. Open shadow contents remain selectable through composed pointer events.
- Arbitrarily rotated/skewed iframe coordinate systems, browser top-layer content covering the overlay, pseudo-elements, canvas internals and non-DOM content have no complete geometry/selection guarantee. No host styles/prototypes are patched to bypass these boundaries.
- Visible application text can itself contain personal information. Metadata remains local, with explicit private-subtree controls and no value collection; future provider integration requires a separately enforced privacy/consent design.
- Native Shadow DOM UI provides keyboard/focus/live-status semantics and light/dark/system styling. Verification currently uses Chromium; manual screen-reader, other browser engines and hosted CI are not claimed.
- Source evidence, translation, editor actions and analysis progress must be connected in separately requested phases; no fake loading analysis or placeholder source locations are shown here.
