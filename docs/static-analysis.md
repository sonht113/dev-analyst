# Static analysis API

`@devanalyst/analyzer` is Node-only. Build the workspace first with `pnpm build:packages`. The engine reads authorized source snapshots and returns source facts; it never imports or executes application/configuration code.

Run this example from the repository root after installation/build:

```sh
node --input-type=module <<'JS'
import { createStaticAnalyzer } from '@devanalyst/analyzer';

const analyzer = createStaticAnalyzer({
  workspaceRoot: process.cwd(),
  source: { include: ['apps/playground-react/src/**'] },
});
const result = await analyzer.analyzeDetailed({
  requestId: 'readme-example',
  sources: [{ file: 'apps/playground-react/src/main.tsx', start: null, end: null }],
});
console.log({
  completion: result.completion,
  metrics: result.metrics,
  findings: result.findings.map(finding => ({
    kind: finding.detail.kind,
    confidence: finding.confidence,
    file: finding.evidence?.source.file,
    line: finding.evidence?.source.start?.line,
  })),
});
JS
```

The existing `analyze(request)` method returns the original `Finding[]` contract. `analyzeDetailed(request)` adds the dependency graph, diagnostics, source hashes, selected source subjects and measured metrics. A non-null source start selects the narrowest containing source subject, suitable for the Phase 04 mapping's source reference. Whole-file requests select a module subject. Before attaching analysis to a runtime selection, compare the mapping revision with the corresponding `result.sourceHashes` entry; a mismatch requires refreshed/unknown context. Module findings still cover the loaded source graph; inspect trace contexts/call edges to attribute a fact to a selected handler. An untraced API fact is source evidence, not evidence that the selected button calls it.

Every detailed finding has `execution: 'not-evaluated'`, a discriminated `detail.kind`, `conditions` and bounded `traces`. A verified API reference can have an inferred callback trace. Use both confidence levels. Unknown targets/destinations/endpoints remain null. No source finding should be presented as a witnessed runtime event.

Useful detail kinds are `component`, `prop`, `relationship`, `condition`, `visibility`, `disabled`, `handler`, `call`, `hook`, `state`, `navigation`, `api` and `side-effect`. Source expressions are retained; runtime state/props, API responses and effective CSS are not collected. Evidence snippets contain authorized source text and should remain local.

## Aliases and project scope

Explicit `aliases` map exact names/prefixes to workspace-relative targets. `compilerOptions.paths` supports TypeScript exact/wildcard mappings, with an optional workspace-relative `baseUrl`. Alternatively set `tsconfig: 'tsconfig.json'`, and explicitly include that JSON/JSONC file and any local extends files in `source.include`. Config-driven project discovery is disabled; requested roots and their literal imports define scope. Paths do not grant read permission or establish that a runtime bundler uses the same mapping.

For example, options for a caller's own project can include:

```ts
const options = {
  workspaceRoot: projectDirectory,
  source: { include: ['src/**', 'packages/ui/**', 'tsconfig.json', 'config/**'] },
  tsconfig: 'tsconfig.json',
  aliases: { '@ui': 'packages/ui' },
  limits: { maxFiles: 32, maxDepth: 8, timeoutMs: 2000 },
};
```

Do not pass an executable Vite configuration as a tsconfig. Named package config extensions and node_modules implementation reads are excluded. Local workspace sources need explicit permission. Parent-to-child callback candidates are available only if parent modules are among the loaded entry/import graph; a selected child file alone does not reveal every parent instance.

## Completion, limits and uncertainty

`complete` means processing finished within its supported source scope. `partial` includes explicit diagnostic codes such as `SOURCE_UNAVAILABLE`, `SOURCE_PARSE_ERROR`, `IMPORT_DEPTH_LIMIT`, `CALL_CYCLE`, `CONFIG_CYCLE`, `FILE_LIMIT`, `BYTE_LIMIT`, `AST_LIMIT`, `GRAPH_NODE_LIMIT`, `GRAPH_EDGE_LIMIT`, `FINDING_LIMIT`, `RESOLUTION_LIMIT` and `TIME_LIMIT`. `cancelled` identifies a signaled `AbortSignal`. Retain diagnostics and unknown findings in UI/API consumers.

Default work limits and their upper bounds are defined in the analyzer's validated options. Source reads are individually limited to 256 KiB and canonical workspace containment. The deadline is cooperative, not preemptive. Metrics include source/config/candidate snapshot reads and AST/graph work; they are measured per request, not a latency guarantee. A new request reloads snapshots and hashes; the standalone engine does not itself persist analysis. Phase 08 composes it with [SQLite cache](persistent-cache.md).

See [ADR 0007](adr/0007-static-analysis-engine.md) for confidence semantics, resolver boundaries, supported patterns and exclusions, and [Phase 05 validation](phase-05-validation.md) for executed evidence. Browser display of these analysis results, wire/RPC dispatch, AI explanations and editor navigation are not added by this engine API.

Phase 07 adds optional `dependencyHashes` to detailed results for cache validation. It fingerprints every authorized snapshot read by the resolver, including JSON configuration and malformed dependencies excluded from semantic findings. `sourceHashes` continues to identify parsed source evidence only. A hash does not make malformed/configuration text behavioral evidence. Page pre-analysis revalidates the complete dependency fingerprint before accepting or reusing results.

Phase 08 adds `missingDependencies` for authorized unresolved candidates and `sourceAliases` for canonical resolver relationships. A new file or symlink retarget can invalidate old resolution even when existing source hashes match. Cache consumers must retain and revalidate these observations. The public `@devanalyst/analyzer/workspace` export exposes guarded access without loading the TypeScript analysis engine.
