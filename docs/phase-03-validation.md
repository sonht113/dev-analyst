# Phase 03 — Browser Element Inspector validation

The owner explicitly requested Browser Element Inspector as Phase 03, ahead of the roadmap's React mapping step. [ADR 0005](adr/0005-browser-element-inspector.md) records this order and the native DOM/Shadow DOM UI decision. Only React + Vite integration is supported. The phase implements browser selection and local metadata; source mapping, analysis, translation, editor navigation, AI and caching remain pending.

## Implemented and checked

- Passive hover and Alt hover, Alt+Click and explicit Inspect mode, opt-in context actions, disabled controls and deepest nested/SVG selection.
- Shadow DOM isolation, client-rectangle highlight, viewport-clamped panel, pin/unpin, close, explicit copy/manual-copy error, keyboard/menu/focus semantics, light/dark/system CSS.
- Visible text, Japanese-script fragments, allowlisted attributes, associated/ARIA label candidates and DOM context. Observations include timestamp, source status UNKNOWN and no cache. Original application text is untouched.
- No value reads, arbitrary HTML/data/event/URL collection, editable/private/hidden text, WebSocket metadata transmission or browser AI calls. Unit tests verify prohibited attributes are never requested.
- Open shadow roots, same-origin nested frames with frame borders; opaque boundaries remain opaque. Scroll/resize/layout-change refresh, mutation/resize observers, bounded discovery and complete stop cleanup.
- Real React dynamic content and Fast Refresh retain host behavior; SPA navigation, disconnect/reconnect and host CSS/event isolation work in Chromium.

## Executed checks

Local environment: 2026-11-12, Node.js 22.23.2, pnpm 10.33.0, Vite 8.3.5, Darwin 24.1.0 arm64, Playwright Chromium.

| Check                                            | Result                                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                      | Passed ESLint, dependency boundaries, circular-dependency check and Prettier                         |
| `pnpm typecheck`                                 | Passed all seven active packages, tooling/tests and React app                                        |
| `pnpm test:smoke`                                | Passed 105 unit/integration tests in 13 files and 16 Chromium E2E tests (10 inspector + 6 bridge)    |
| `pnpm build`                                     | Passed seven active packages and React production build                                              |
| `pnpm test:independent`                          | All seven packages build with prerequisite outputs removed                                           |
| `pnpm test:packages`                             | Passed ESM imports, private-path rejection, declarations/maps, local package archives and CLI checks |
| Local documentation links and `git diff --check` | Passed for changed documents/patch                                                                   |

The smoke suite exercises real Vite/WebSocket/CLI and production builds. New module assets share the bootstrap/runtime Origin/Host protections, reject query/path expansion and contain no credentials. Production checks explicitly exclude the inspector handle/host/overlay/extraction markers. Browser socket captures confirm inspection sends only the existing route protocol; DOM metadata is absent.

A synthetic burst of **1,000 pointer events** on a visible button caused **2 selected-element geometry reads**, with **3.8 ms dispatch time** in the final local run. A separate 2,000-node selection and a 300,000-character single text node verify truncation/bounds. The measurement is a local event-dispatch/coalescing observation, excludes asynchronous metadata extraction, and is not an application latency benchmark or the future cached-analysis target. Its JSON artifact and a visually inspected panel screenshot are under ignored `test-results/`.

Earlier development failures were corrected without weakening feature assertions. Chained sandbox test invocations were denied loopback binding (`EPERM`), including CLI setup timeouts; authorized direct commands ran the real suites successfully. Hosted CI was not run. No historical framework source/configuration or lockfile was changed, no dependency was added, and no commit/publication was created.

## Limits and remaining work

The supported target remains standalone loopback HTTP Vite 8.3.5+. CSP must allow the served scripts, Shadow DOM styles and bridge connection. Cross-origin/sandboxed frames, closed roots, pseudo-elements, canvas internals, rotated/skewed iframe coordinate transforms and browser top-layer occlusion do not have complete inspection guarantees. Discovery caps (3,000 elements/pass, 64 roots, 32 documents/frames) intentionally bound work; open roots attached without a DOM mutation may need a later discovery pass for observation. Visible text extraction caps at 400 nodes/2,000 characters, attributes at 256 characters and Japanese fragments at 32. Truncation is explicit.

Accessible labels are observed candidates, not the complete platform accessible-name algorithm; Han detection is not Japanese language identification. Visible UI text may contain personal information: metadata remains local, private-subtree controls are available and Copy is explicit. No general runtime secrecy guarantee is inferred from filtering input values. Other browser engines, manual screen readers, hosted CI and Node.js 24 have not been run locally. This phase does not establish product completeness or release readiness.
