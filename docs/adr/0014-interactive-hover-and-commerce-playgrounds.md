# ADR 0014: Interactive hover previews and realistic commerce playgrounds

Status: accepted for the owner's follow-up request, 2026-11-16.

## Context

The owner reports that playgrounds are too simple and hover panels cannot be reached, scrolled or used because movement changes the inspected element. This explicitly extends ADR 0005's initial passive-tooltip behavior; it does not authorize another phase or new framework targets.

## Decisions

- Keep initial hover previews click-through and out of normal tab order. A bounded 180 ms target dwell plus a narrow geometry corridor preserves the current target while moving into its panel. Crossing a descendant must not be mistaken for leaving the document: capture-phase `pointerleave` is filtered to document/documentElement, with a short viewport-exit grace.
- Entering panel bounds deliberately activates its controls and changes tooltip semantics to a region, without moving focus or implicitly pinning. Hold the selected element while the pointer or focus remains inside, allow native scrolling/text selection, and contain wheel propagation. Escape/Close and explicit Pin remain available. Mouse Unpin returns to a click-through preview; keyboard pin toggling preserves focus. Expose additive `getSnapshot().interacting` state for diagnostics/tests.
- Limit panel height to the available side of its trigger. Streamed analysis may add internal scroll content but cannot grow the panel over a pending native click. Keep placement stable during panel interaction; shared source invalidation still demotes stale evidence.
- Hover, corridor entry, focus and scrolling never constitute explicit AI consent/dispatch. Only the existing explicit expanded selection/mode actions can use the configured AI/path consent. Keep route/source/privacy/editor guards and normal host interactions intact.
- Replace bare playground counters with commerce dashboards in all four active apps. Retain the small integration lab controls and framework route/boundary examples as regression anchors. Add filtering/sorting/pagination, keyed rows, UI role guards, conditional bulk approval, editable detail drawers, CSV export, real same-origin requests, 503 simulation and recovery, and responsive layout.
- All business data is synthetic. Each app's API owns a bounded process-local demo store, not a database or authentication system. The role picker illustrates UI conditions, not server authorization. Vite uses local dev/preview middleware; Next uses public App Router handlers; Nuxt uses a native server API. These are host application APIs, separate from DevAnalyst's bridge. They do not call external services or write records to disk.
- Keep application helpers local to their framework apps; add no dependencies, shared generic runtime package or new workspace target. Next application imports follow native extensionless TypeScript resolution required by its tested bundlers; ESM library imports retain `.js` and explicit public exports. DOM CSV construction lives in a plain service module so JSX files retain the existing fail-closed opaque-element-rewrite policy.

## Verification

Real browser tests must cover slow transfer across the gap, scrolling without host scroll, stable selection/focus, Escape restoration, explicit pin/unpin and native click preservation. Existing privacy, hover-no-inference, HMR, source mapping, teardown and production exclusion remain gates. Commerce journeys exercise actual APIs, payload/state guards, pending-only editing/approval, failure recovery, CSV and mobile width across the authorized frameworks. No confidence assertion is relaxed to accommodate a more complex source graph.

See [usage](../playgrounds.md) and [follow-up validation](../hover-playground-validation.md) for results and limitations.
