# Predictive page pre-analysis

React + Vite development pages automatically begin deterministic background analysis after the local bridge connects. Only viewport-visible elements with verified JSX origins enter the Node queue. Buttons and links receive priority over forms, menus/tabs and other visible components; hovering or selecting an uncached mapped element raises its priority. Shared component instances reuse the module analysis.

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { devanalyst } from '@devanalyst/vite-plugin';

const inspector = devanalyst({
  config: { source: { include: ['src/**'] } },
  preanalysis: {
    limits: { concurrency: 1, maxEntries: 64, maxBytes: 16 * 1024 * 1024 },
    // Optional deterministic resolver settings; never loads executable Vite config.
    analyzer: { aliases: { '@': 'src' } },
  },
});
export default defineConfig({ plugins: [react(), inspector] });
```

Set `preanalysis: { enabled: false }` to disable page preparation while retaining the inspector. AST work runs in a worker thread and respects the [static engine limits](static-analysis.md). Browser discovery yields between slices; neither route handlers nor Vite startup/HMR await analysis. In-memory work is per server. Phase 08 persists eligible results in SQLite when `config.cache.enabled` is true; see [persistent cache](persistent-cache.md).

`window.__DEVANALYST_BRIDGE__?.getSnapshot().pageAnalysis` exposes the current page ID, sanitized route, structural element index, six analysis states, separate AI states, cache/error labels and counts. The inspector status shows AST state and page progress. Node `inspector.api.getPageAnalysis(clientId)` also exposes AST-derived components and related files. Browser `devanalyst:bridge` events carry incremental snapshot updates. `completed` counts READY or FAILED sites, not successful Claude jobs; discovery can add more sites over time. `limited` indicates collection, admission, observer or result limits. A `READY` result with `PARTIAL_ANALYSIS` retains the engine's uncertainty.

Navigation uses actual pathname/hash-route identity, including dynamic path segments. Query strings, history state and opaque fragments are omitted. Components committed later by lazy loading are picked up by DOM observation. The component index describes lexical/static source relationships, not proven runtime call execution. Unsupported origins remain unknown; no selector or private React fallback is used.

Revisiting a page validates all dependency/configuration snapshot hashes before reusing results. Source edits mark affected entries STALE; root edits wait for current mapping, and dependency edits requeue the root. Obsolete routes cancel work unless another current page uses that module. Worker cancellation waits for termination; Claude cancellation preserves the provider's process cleanup policy. Failed unchanged work does not retry on every pointer event.

## Optional background Claude

By default, opening a page never invokes Claude. Automatic AI requires two explicit controls:

```ts
const inspector = devanalyst({
  config: {
    source: { include: ['src/**'] },
    ai: { enabled: true, permittedPaths: ['src/**'], concurrency: 1 },
  },
  preanalysis: { backgroundAI: true },
});
```

**Enabling background AI permits source snippets to be transmitted to the Claude provider.** Choose permitted paths carefully. Only source-backed uncertainty remaining after deterministic analysis is eligible; route values and DOM text are not transmitted. Existing [Claude controls and CLI compatibility](claude-code.md) apply, including exact source hashes, path/secret guards, runtime no-tools permissions, context/token/time limits and citation confidence. Provider failure reports `aiState: FAILED` while retaining the static result. This phase does not add a browser AI request endpoint or translation/follow-up UI.

## Standalone Node queue

`createPageOrchestrator` and `createWorkerAnalyzer` are public analyzer exports. Supply `analyze`, a guarded asynchronous `validate(sourceHashes)` function, optional `enrich(result, signal)` and `onProgress(clientId, snapshot)`. The Vite composition already supplies these safely. A custom Node composition must honor cancellation, validate its own trusted source origins and use the workspace access policy; browser source paths are not authorization.

Queue methods are `index`, `prioritize`, `remove`, `invalidate`, `getSnapshot`, `getResult`, `getExplanations`, `getStats` and `stop`. Results remain Node-side. `getResult`/`getExplanations` return cloned accepted results; callers must feed source-change invalidation and validate current hashes on reuse. `stop` cancels jobs, clears state and returns a promise that waits for resource cleanup. The worker API is an executor; use the orchestrator to bound concurrent calls.

Defaults: 128 sites/page, 64 entries, 32 pages, one AST worker, one AI invocation, 16 MiB retained result bytes, 2 MiB/static result and 256 KiB/AI result. The browser visits at most 3,000 nodes/32 roots per pass, up to 24 nodes or about 4 ms per slice, separated by 16 ms. Wire batches contain at most eight structural records and adapt to the configured message size. Tiny frame limits may omit oversized records and mark collection limited. V8 worker heap limits are not total RSS guarantees.

Phase 07 did not implement SQLite. Phase 08 adds [persistent cache layers](persistent-cache.md); full analysis result presentation, complete viewport/occlusion coverage and a whole-project cached-response benchmark remain pending. See [ADR 0009](adr/0009-predictive-page-preanalysis.md) and [validation](phase-07-validation.md).
