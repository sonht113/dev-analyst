# ADR 0009: Progressive React page pre-analysis

- Status: Accepted for owner-authorized Phase 07
- Date: 2026-11-13

## Context

Phase 04 supplies committed JSX provenance, Phase 05 supplies deterministic source analysis, and Phase 06 supplies an opt-in Claude provider. Phase 07 composes these into automatic page pre-analysis for React + Vite. Synchronous AST execution in the Vite process would compete with compilation and HMR. DOM observations alone cannot authorize arbitrary source reads or prove application behavior.

## Decision

Use three focused layers within the existing packages:

1. Inspector collects viewport-visible structural metadata in timer slices (at most 24 nodes or approximately 4 ms per slice, separated by 16 ms). Each pass visits at most 3,000 nodes and 32 accessible document/shadow roots. A page indexes at most 128 unique JSX sites; repeated runtime instances share their template origin. Mutation, frame load, scroll, resize and source notifications schedule later passes. A pass is incremental; it is not a full visibility/occlusion oracle.
2. The authenticated bridge accepts bounded `page.index` batches and `page.priority` messages. Node checks every file/revision/site/tag against its own transform manifest before dispatch. No text, props, values, URLs, arbitrary source coordinates, question, file-read or AI RPC is accepted. Only the active pathname/hash-route is eligible. Route path parameters remain local route identity; query strings/history/opaque fragments are omitted. Parameters are not guessed or sent to AI.
3. Analyzer owns a bounded asynchronous module queue and worker entry point. Vite composes the queue, workspace policy, worker and optional Claude provider. AST work executes in disposable Node worker threads, never in browser handlers or Vite startup/HMR hooks. Worker input configuration and sources are validated, app/config code is never imported, and cancellation terminates the worker before its scheduler slot is released.

The page/component index comes from validated JSX origins plus AST component nodes and related-source hashes. Lazy modules are discovered after they commit visible DOM; literal source imports may also be reached by the closed static graph. Opaque or uninstrumented elements have no invented source. Dynamic pathname/hash routes use the same collection pipeline without a framework router adapter or inferred route-template parameter extraction.

Priority is selected, hovered, buttons/links, forms/menus/tabs, then other visible components, with FIFO ties. Hover messages are coalesced/throttled. Equivalent files/revisions share one AST job and one eligible AI job across pages and instances. A selected uncached source can replace lower-priority admitted work when the entry budget is full. A running job is retained while any page still uses it; obsolete last subscribers cancel their work. Queued priorities change immediately, but active useful AST work is not preempted on each hover.

Every site reports `NOT_ANALYZED`, `QUEUED`, `ANALYZING`, `READY`, `STALE` or `FAILED`, with independent AI state, cache label and safe error code. `READY` means a bounded deterministic result is available; `PARTIAL_ANALYSIS` discloses incomplete coverage. It does not mean all behavior is known or AI succeeded. Node snapshots expose component/source indexes; browser progress carries compact status only. The inspector shows AST status and page counts, while behavioral/translation/follow-up result presentation remains future work.

## Resource and cache policy

Default limits are one AST worker (maximum two), one AI job, 64 admitted entries (maximum 128), 32 pages (maximum 128), 16 MiB retained results (maximum 32 MiB), 128 sites per page and a 90-second job deadline. AST limits remain independently bounded by the Phase 05 policy. Each worker has a 256 MiB old-generation heap limit and an additional startup/execution deadline. This is a V8 heap bound, not a whole-process RSS or OS sandbox guarantee. Results over 2 MiB are rejected inside the worker before crossing to the parent. AI results are limited to 256 KiB. Entry capacity includes queued/running/cached work; overflow is reported as limited with omitted sites left `NOT_ANALYZED`.

Caches are per integration instance, in memory only. Workspace/analyzer/provider/model/language policy is fixed for that instance; source file/revision identifies a module entry. Reuse rechecks all dependency/configuration snapshot hashes (`dependencyHashes`, separately from parsed source evidence) through guarded workspace reads before reporting `READY`. Accepted results are checked again after analysis; edits cannot make an obsolete result current. Root edits require a fresh JSX revision; dependency edits requeue affected roots. Add/unlink/allowed JSON config changes conservatively invalidate resolution topology; edits also cancel in-flight work whose complete dependency set is not yet known. Unrelated completed modules remain reusable. Late watcher notifications for an already observed identical revision preserve current mapping/results. Shutdown waits for canceled workers/provider jobs to release resources. Unused entries are evicted by recency under entry/memory pressure. No SQLite, persistence, migrations or layered translation cache is introduced in Phase 07.

## AI consent and safety

Automatic provider transmission requires both `config.ai.enabled` with explicit `permittedPaths` and the new `preanalysis.backgroundAI: true` option. Both default to off. Only source-backed uncertainty remaining after AST can queue Claude. Hover/selection change priority; they cannot bypass consent or force provider invocation for fully verified facts. No route values or DOM text enter provider context. Phase 06 consent intersection, secret exclusions, exact hash/range checks, no-tools execution, structured citations and retry/token/time budgets remain enforced.

Source can be transmitted to the Claude provider when background AI is explicitly enabled. The installed CLI/admin trust boundary and local authentication limitations in ADR 0008 still apply. Provider failures keep deterministic results available and report AI failure separately. Obsolete AI cancellation may already have consumed provider tokens. An unchanged failed job is not retried on every hover.

## Consequences and verification

The worker lifecycle has startup overhead, accepted to isolate Vite from CPU-bound AST traversal and make cancellation real. Module-level analysis deliberately shares work across components in one file; this is a page preparation index, not a complete React runtime owner stack. Source config resolution must be explicitly provided through `preanalysis.analyzer`; Vite executable config is not evaluated by the analyzer. Closed roots, cross-origin frames, unsupported JSX mappings, arbitrary CSS animations/occlusion and nodes beyond discovery limits remain unknown or limited.

Queue tests cover ordering, cross-page deduplication, last-subscriber cancellation, rapid revisit, dependency invalidation, stale-result rejection, AI ordering/cancellation/consent absence, memory/deadline limits and capacity admission. Real worker integration verifies AST evidence, dependency/component indexing, cache reuse, edits and cancellation while the parent event loop continues. Real authenticated Vite tests reject forged sites/obsolete routes; Chromium covers automatic collection, private exclusion, interactive kinds, shared/lazy components, parameterized/hash navigation, selected uncached work, HMR/state preservation and frame timing observations. Production tests forbid new runtime/worker/queue markers. Measurements are observations, not product latency benchmarks.
