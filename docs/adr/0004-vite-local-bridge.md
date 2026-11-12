# ADR 0004: Development-only Vite integration and authenticated local bridge

Status: accepted for the explicitly requested Phase 02. Retains the React + Vite scope in ADR 0003 and operationally excludes preserved historical artifacts from active tooling. No historical application/package source is deleted.

## Decision

Use `@devanalyst/vite-plugin` to compose a standalone loopback HTTP/WebSocket bridge with `ws`, and serve the browser module from the explicit browser-safe `@devanalyst/inspector/runtime` export. `picomatch` implements configured source path glob matching. The CLI uses Vite's public APIs and the configured project plugin; no shell commands or automatic source rewrites are needed.

Apply the plugin only to development serve, with final resolved production checks as defense in depth. Register middleware, watcher handling, and asynchronous startup from `configureServer`; do not return analysis work from that hook. Wait for that host HTTP server's listening event before binding the bridge. Production builds and preview never start the bridge or inject runtime code.

Default the bridge to `127.0.0.1:0`; reject non-loopback configuration. Allow bounded preferred-port fallback or actionable strict-port failure while the host app remains usable. Bound clients, frames, message rates, buffers, pending source events, reconnect attempts, and shutdown waits.

Generate a 256-bit credential for every server generation. Return it only through a guarded same-origin, no-store bootstrap endpoint; never put it in HTML, module source, URLs, logs, snapshots, or persistent storage. Require a loopback network peer, an allowed loopback Vite Origin, the bridge Host/path, and constant-time credential verification before WebSocket upgrade. Send the credential in a dedicated subprotocol offer, and negotiate only the public protocol name. Disable compression, validate all incoming frames with Zod, and expose no arbitrary file/shell RPCs.

The browser observes History API calls and browser navigation events directly. Preserve native behavior, never collect history state/query strings/opaque fragments, and keep route snapshots in memory only. Use bounded retry/backoff, refetch bootstrap on reconnect for token/port rotation, handle page suspension/resumption, and restore owned methods/listeners on stop. Route metadata is browser-reported context, not source-behavior evidence.

Node source reads use configured includes, mandatory exclusions, workspace containment, canonical targets, no-follow opening, file identity/change checks, and bounded buffers. Watcher notices contain relative authorized source paths only. These checks do not constitute an OS sandbox for AI, which is not invoked in this phase.

## Lifecycle consequences

Vite 8 can configure a replacement server before invoking the old server's `closeServer` hook. Keep integration state per server generation, close the correct oldest generation on restart, close all remaining generations on final shutdown, and attach HTTP close cleanup to its own context. Restart tests reuse the same plugin instance, verify credential rotation, reject old credentials, and reconnect real browser/Node clients.

Use public Vite hooks/events only. The package peer range is Vite `^8.3.5`, the tested baseline. Maintain browser/Node separation: the served runtime has only type imports and standard Web APIs; the plugin reads its own shipped module asset, not project code for injection. Preserve host source maps and native HMR.

Workspace globs, root scripts, TypeScript references, lint/tests, package checks, CI, and the regenerated lockfile now select only seven active libraries and the React fixture. Historical code/tests remain on disk and are not newly configured, installed, or executed.

## Trust boundary and limits

The current transport supports standalone local HTTP Vite servers. HTTPS and middleware mode fail closed with actionable unsupported-feature diagnostics. Browser access through remote/LAN hostnames is not supported. Project CSP must authorize the runtime/bootstrap and chosen loopback WebSocket endpoint.

Project Vite configuration is trusted executable project code, loaded on explicit dev/doctor commands. The source-access policy does not sandbox arbitrary Vite plugins. AI read-only enforcement, analysis, UI, cache persistence, and editor opening are separate future implementation work.

## Verification

Require real Vite/WS/React/browser/subprocess tests, production artifact checks, strict type/lint checks, independent builds, and package exports. See [testing](../testing.md) and the [Phase 02 results](../phase-02-validation.md); do not treat configured hosted CI as an executed run.

## References

- [Vite Plugin API and lifecycle hooks](https://vite.dev/guide/api-plugin)
- [Vite JavaScript API](https://vite.dev/guide/api-javascript)
- [ws authentication and server API](https://github.com/websockets/ws)

## Future Roadmap

No additional framework adapter or shared bridge package is introduced. Future framework work remains outside scope and requires an explicit owner decision.
