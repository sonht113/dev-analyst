# Claude Code provider API

Build with `pnpm build:packages`, install a supported native Claude Code **2.1.323** executable, and authenticate it separately using Claude's own supported flow. This package retains the project's `@devanalyst/ai` name. It is Node-only, opt-in and development-only; no SDK entitlement is assumed from CLI login.

Source, selected Japanese UI text and questions submitted for an explanation may be transmitted to the Claude provider. Enable only permitted, non-sensitive source paths. Never pass password/form values, private UI contents or credentials. File exclusions and heuristic secret detection cannot identify every possible secret in an allowed source file.

Check the installation and local CLI auth status without inference:

```sh
node --input-type=module <<'JS'
import { createClaudeCodeProvider } from '@devanalyst/ai';
const provider = createClaudeCodeProvider({ workspaceRoot: process.cwd() });
console.log(await provider.checkReadiness());
JS
```

Auth status leaves `nonInteractive: 'unverified'`. An explicitly enabled readiness probe sends only a synthetic Japanese greeting, invokes the configured model, may incur provider charges, and validates its structured response:

```sh
node --input-type=module <<'JS'
import { createClaudeCodeProvider } from '@devanalyst/ai';
const provider = createClaudeCodeProvider({
  workspaceRoot: process.cwd(),
  ai: { enabled: true, permittedPaths: ['apps/playground-react/src/**'] },
  maxBudgetUsd: 0.15,
  retries: 0,
});
console.log(await provider.checkReadiness({ probe: true }));
JS
```

`ready` means that particular bounded request succeeded. Auth, model entitlement, network access and quota may change afterward. This integration does not log in automatically, change provider accounts, refresh projects with shell commands or fall back to an API SDK. The configured model defaults to `sonnet`; an unavailable model returns a failure.

Use deterministic findings as explanation context. The example below is a Node program for an explicitly permitted React workspace; it sends the selected source evidence when enabled:

```ts
import { createStaticAnalyzer } from '@devanalyst/analyzer';
import { createClaudeCodeProvider } from '@devanalyst/ai';

const workspaceRoot = process.cwd();
const source = { include: ['apps/playground-react/src/**'] };
const analysis = await createStaticAnalyzer({ workspaceRoot, source }).analyzeDetailed({
  requestId: 'selected-source',
  sources: [{ file: 'apps/playground-react/src/main.tsx', start: null, end: null }],
});
const provider = createClaudeCodeProvider({
  workspaceRoot,
  source,
  ai: { enabled: true, permittedPaths: source.include, concurrency: 1, timeoutMs: 60000 },
});
const controller = new AbortController();
const result = await provider.explainDetailed({
  requestId: 'explanation',
  evidence: analysis.findings,
  sourceHashes: analysis.sourceHashes,
  depth: 'standard',
  question: 'Giải thích điều kiện hiển thị và callback theo source; nêu rõ phần chưa biết.',
  // Supply uiText only for deliberately selected public labels, for example [{ id: 'save', text: '保存' }].
  signal: controller.signal,
});
console.log(result.findings, result.citations, result.usage);
// In a real UI, controller.abort() cancels obsolete requests.
```

Select relevant findings before calling rather than sending an entire graph. The default cap is 24 findings/eight source files; oversized contexts are rejected. Missing or changed source hashes, stale evidence and snippets that no longer match source also reject. Non-source UNKNOWN findings can be retained in your deterministic UI, but cannot be submitted as source evidence to this provider. UI-only translation is supported with `evidence: []`; it remains UNKNOWN when no source evidence exists. AI prose with actual source citations is capped at INFERRED; keep the original deterministic VERIFIED facts alongside it.

`explain(request)` provides the existing `Finding[]` interface; `explainDetailed(request)` additionally returns resolved citations and measured usage. The model supplies IDs only, and Node attaches actual source references. No generated source paths are trusted. The adapter investigates relationships within the supplied context; it has no autonomous repository-reading tools. It neither edits original text nor displays results in the inspector yet.

## Configuration and errors

Optional bounds include `maxQueue`, `retries`, `retryDelayMs`, `maxFindings`, `maxFiles`, `maxSourceBytes`, `maxContextBytes`, `maxInputTokens`, `maxOutputTokens`, `maxTotalTokens`, `maxBudgetUsd` and `maxOutputBytes`. Limits/deadlines cover queued work too. `depth` communicates requested explanation detail; all depths retain the same configured safety ceilings. `executable` is a trusted executable path/name, never a shell command string or additional arguments.

`CLI_NOT_INSTALLED`, `AI_CLI_INCOMPATIBLE`, `AI_AUTH_UNAVAILABLE`, `AI_QUOTA_EXHAUSTED`, `AI_RATE_LIMITED`, `AI_PROVIDER_UNAVAILABLE`, `AI_CLI_FAILED`, `AI_INVALID_OUTPUT`, `AI_PERMISSION_DENIED`, `AI_CONTEXT_REJECTED`, `AI_BUDGET_EXCEEDED`, `AI_QUEUE_FULL`, `AI_TIMEOUT`, `CANCELLED` and workspace/source-change errors distinguish failure classes. Never display/log raw child output or provider identity/credential metadata. Readiness returns a sanitized error object; explanation calls reject with a sanitized `DevAnalystError`.

Only recognized transient network/overload or rate errors retry; no permission bypass, editing tool or shell fallback exists. CLI internal/schema retries are disabled. Supplied input-token estimates exclude hidden CLI framing; provider usage is checked when reported. The CLI spend estimate is not a hard billing cap. A cancelled call may still have consumed provider tokens.

macOS/Linux native CLI 2.1.323 is the verified compatibility target. Other versions, Windows batch wrappers, custom gateways/third-party routing, managed policies that conflict with required flags and authenticated model availability outside the checked account are unsupported. Do not remove safety flags to make an incompatible environment work. See [ADR 0008](adr/0008-claude-code-provider.md) for the exact controls/trust boundary and [validation](phase-06-validation.md) for tests and actual local readiness.
