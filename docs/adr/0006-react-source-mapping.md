# ADR 0006: Phase 04 — Reliable DOM-to-Source Mapping

Status: accepted for the owner's explicit Phase 04 mapping request. This delivers mapping ahead of the roadmap's deterministic handler/state/API analysis; those features remain pending.

## Research and alternatives

The strategy uses the documented [Vite transform ordering and source-map contract](https://vite.dev/guide/api-plugin), [TypeScript AST traversal](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API), public [React callback refs](https://react.dev/reference/react-dom/components/common#ref-callback), [StrictMode ref lifecycle](https://react.dev/reference/react/StrictMode), [Vite HMR disposal/custom events](https://vite.dev/guide/api-hmr), and [MagicString source-map generation](https://github.com/Rich-Harris/magic-string). Versions are pinned through pnpm; TypeScript and MagicString run only in Node. Trace-mapping is a test dependency for checking original positions after the actual Vite JSX pipeline.

| Strategy                                                          | Decision                                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| CSS selector/location heuristics                                  | Rejected: selectors do not establish JSX origin or distinguish reusable instances                                   |
| Private Fiber/debug fields                                        | Rejected: no stable public ownership/location contract; not required by this implementation                         |
| Source attributes on DOM elements                                 | Rejected as proof: attributes can be copied, overridden by spreads, and change application DOM/CSS observations     |
| Wrapping components, composing application refs, cloning elements | Rejected: can change component identity, keys, memoization, ref cleanup and observable behavior                     |
| Compile-time ref on safe intrinsic JSX plus WeakMap provenance    | Chosen: establishes a connection to the actual committed node through React's public API; unknown cases fail closed |

## Compiler and runtime

`@devanalyst/analyzer` parses authorized original `.tsx`/`.jsx` modules and inserts a private import, module manifest, HMR bookkeeping and a ref factory call on supported intrinsic JSX opening tags. It edits original bytes with high-resolution source maps, preserves directive prologues and avoids colliding with existing identifiers. It never rewrites functions, hooks, keys, children, application refs or event expressions, evaluates user source, wraps components or edits files on disk.

The Vite plugin performs this work in its development client transform with `enforce: pre` and hook `order: pre`, before JSX lowering. It uses the existing canonical-path/inode/size/exclusion policy to read the file. If incoming transform code differs from authorized disk source, it returns unchanged code with `TRANSFORMED_INPUT`; it never claims original positions for upstream generated JSX. SSR, build/production, disabled integrations, virtual/query modules and sources outside configured workspace includes are excluded. Local package sources require an explicitly encompassing `workspaceRoot` and include patterns; no permissions are widened automatically.

Only the exact namespaced `mapping-runtime.js` URL is resolved and served through the existing trusted middleware. Instrumented application modules depend on that development asset; project CSP must permit it along with the normal Vite runtime. Its dependency-free browser code validates a bounded manifest and associates committed DOM nodes with compile-time sites in WeakMaps. Same-origin frame realms share a registry; no input/prop/key values, React private internals or source text are collected. The registry lives for the page lifetime (including after overlay stop), so starting inspection again can resolve existing mounted nodes; HMR dispose/prune invalidates retired records. WeakMaps release unreachable node identities, and current manifests are bounded.

The callback factory produces one callback per JSX evaluation. It returns void, removes its own registration on null and does not touch application refs. StrictMode extra setup/cleanup and ref changes are supported. A ref object reused at multiple simultaneous DOM positions, multiple active registrations on one node, tag mismatch, detached nodes, absent registration and stale manifests resolve to `UNKNOWN` with a specific reason. Copying DOM attributes or cloning DOM nodes never copies a mapping. There is no ancestor or selector fallback.

## Evidence and identifiers

- `VERIFIED` establishes **instrumented JSX origin**: the currently active compiler manifest registered this actual DOM node. It does not establish business behavior, handler execution, a runtime owner stack, or source mapping for arbitrary transformations.
- Source ranges are one-based line/UTF-16 column coordinates in the original authorized workspace-relative file, covering the JSX element. End positions are exclusive. Source maps use their standard zero-based columns.
- Component identity is the nearest recognized lexical named function/class or memo/forwardRef variable, with its declaration range. Anonymous default exports use the declaration label `default`. Module-level JSX constants have `component: null`. This is lexical evidence, not an assertion that private React runtime ownership was inspected.
- Module ID: SHA-256 of workspace-relative file. Revision: SHA-256 of original contents. Component ID: SHA-256 of file, qualified lexical label and occurrence. Element ID: SHA-256 of file, lexical owner, intrinsic tag and occurrence in that scope.
- IDs are deterministic across whitespace, line shifts and text-only edits that preserve those structural occurrences. Moving/renaming a file/component, changing tag/structure or reordering same-tag sites may change IDs. IDs are workspace-local, not universal cross-repository identifiers; component names remain labels rather than runtime instance IDs.
- Each DOM object receives a random page-lifetime runtime ID. Keyed list reorder/ref replacement retains that ID while the same DOM object survives; remount/reload creates a new one. No React key, business identifier or input value is read.
- Results carry timestamp and `cache: none`. Unknown results contain no claimed source/component. Source fields in inspector metadata and the hint reflect current evidence.

A permitted source watcher event invalidates only the known module ID/revision through a lightweight custom Vite message; it performs no AST work in watcher/HMR handling. Revision matching prevents a delayed old invalidation from clearing a new registration. This also marks old visible DOM as unknown when a source edit cannot compile and Fast Refresh leaves the old UI in place. There is a bounded notification/render delay; a filesystem change cannot be observed before the watcher reports it. Fixing the file and committing a new ref restores current evidence.

## Supported cases and limits

Verified fixtures cover nested/reusable components, a package outside the Vite app root but inside the authorized workspace, fragments, conditional JSX, keyed lists/reorder, SVG, memo, class render methods, render props, lazy/Suspense, portals, SPA transitions and HMR. A separate uninstrumented Vite baseline checks DOM output, state updates and native application-ref lifecycle.

The compiler skips intrinsic JSX with existing `ref` or spread props and custom elements. It conservatively skips whole modules mentioning `createElement`/`cloneElement`, non-React JSX pragmas, malformed input and work-limit violations. It does not replace/compose native refs to force coverage. An unmapped child of `dangerouslySetInnerHTML`, imperative DOM, external dependencies, dynamically computed component tags or opaque wrappers has no guessed fallback. The file diagnostics distinguish why a safe mapping was unavailable.

Adding a ref is observable to application code that explicitly introspects/transforms React element objects. Opaque cross-module element cloning/ref forwarding and arbitrary custom JSX factories are outside the proven semantics envelope; this implementation does not claim universal equivalence for those programs. The scanner is deliberately conservative, not whole-program alias/dataflow analysis. Developers should exclude such modules through source configuration. `VERIFIED` describes the registered template's origin; it is not proof of every derivation or transformation applied to that template. No coverage claim is made for React Compiler rewrites that alter input before this transform; mismatched input is skipped.

Bounds: 256 KiB source reads/analysis, 2,048 sites and 100 skip diagnostics/module (overflow skips the module), 512 tracked modules, 10,000 browser sites, four bounded competing bindings/node, and 512 diagnostic records. Diagnostics contain relative paths, counts, codes, supported source references and measured transform duration; no source text or arbitrary exception messages. Invalid manifests are ignored. Registry exhaustion yields unknown mappings rather than false certainty.

Other browsers, React versions beyond the pinned React 19 fixture, hydration/SSR, exotic renderer behavior and complete runtime component trees are not verified. Existing frame/shadow/geometry restrictions from ADR 0005 still apply. AI, editor opening, business analysis and persistent caching are outside this phase.
