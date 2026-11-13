# DevAnalyst — Bàn giao conversation và trạng thái hiện tại

Cập nhật ngày 2026-11-13, sau khi triển khai Phase 03–06 và xử lý các lỗi/cảnh báo TypeScript được người dùng phản ánh. Tài liệu này thay thế bản overview chỉ đến Phase 02; bằng chứng lịch sử được giữ trong [Phase 02 validation](phase-02-validation.md). Trạng thái sản phẩm chi tiết nằm tại [progress](progress.md), còn phạm vi bắt buộc nằm tại [implementation plan](implementation-plan.md).

## 1. Git và phạm vi bàn giao

- Repository: `sonht113/dev-analyst`; branch làm việc: `master`, remote `origin`.
- Baseline trước conversation triển khai này: `aab9354` — foundation và Vite bridge Phase 01–02.
- Code Phase 03–06 đã commit và push: [`59caac4f372960f3fac70143faf5af0df003b5f2`](https://github.com/sonht113/dev-analyst/commit/59caac4f372960f3fac70143faf5af0df003b5f2), `feat: implement inspector, source analysis and Claude CLI integration`.
- Commit code gồm 77 file, bao gồm implementation, fixtures, tests, ADR, validation reports và sửa cấu hình TypeScript/editor. Các phase dùng chung contracts/exports/config nên được bàn giao trong một commit tổng hợp.
- Tài liệu overview này được cập nhật bằng commit docs tiếp theo. Xem `git log -2 --oneline` để lấy cả code commit và handoff commit; không dùng lời mô tả “uncommitted” trong các validation report cũ làm trạng thái Git hiện tại.
- Người dùng đã cho phép commit và push trong yêu cầu cuối của conversation. Việc này không cho phép publish package, force-push, rewrite history, sửa external service hoặc tự triển khai phase mới.

## 2. Quyết định và yêu cầu của người dùng

Thứ tự yêu cầu đã thực hiện:

1. Đọc overview Phase 02 rồi triển khai **Phase 03: Browser Element Inspector**.
2. Kiểm tra/sửa TypeScript hoặc import errors/warnings trong các file thay đổi; người dùng yêu cầu tiếp tục xử lý.
3. Triển khai **Phase 04: Reliable DOM-to-Source Mapping**.
4. Triển khai **Phase 05: Static Code Analysis Engine**.
5. Triển khai **Phase 06: Claude Code CLI AI Integration**.
6. Commit, push và viết overview để agent khác review, nhận bối cảnh làm việc tiếp.

Quy ước xuyên suốt:

- Tên đã chốt là **DevAnalyst**, namespace **`@devanalyst/*`**, CLI `devanalyst`. Một số prompt dùng tên cũ DevLens/`@devlens/*`; implementation giữ identity được xác nhận, không tạo package song song.
- **Chỉ hỗ trợ React + Vite + TypeScript.** Không triển khai Vue/Next/Nuxt/framework khác dù prompt/roadmap lịch sử có đề cập. Không mở rộng, cài dependencies hoặc chạy test cho framework ngoài scope; không xóa code lịch sử.
- Chỉ làm phase/task được yêu cầu. Không tự bắt đầu Phase 07, thêm browser AI/source RPC, tích hợp editor hay persistent cache từ một yêu cầu review/handoff.
- Không sửa text gốc của ứng dụng; giữ normal interactions, React behavior và source maps. Không thu thập password/form/private runtime values.
- Deterministic AST trước AI; source reference phải có bằng chứng. `VERIFIED` là bằng chứng source, không chứng minh runtime execution; giữ `INFERRED` và `UNKNOWN` rõ ràng.
- AI opt-in, có permitted paths, disclose provider transmission, runtime permissions và resource bounds. Không coi đăng nhập Claude CLI là bằng chứng có quyền với mọi API/SDK/model.

Trước khi chỉnh sửa, đọc [AGENTS.md](../AGENTS.md), [constitution](project-constitution.md), [architecture](architecture.md), [implementation plan](implementation-plan.md), [progress](progress.md), [testing](testing.md). Nếu có `.codegraph/` ở root thì dùng CodeGraph trước khi tìm/đọc code; lúc bàn giao repo chưa có index này. Không tạo index thay người dùng.

## 3. Nền tảng đang hoạt động

Bảy package: `core`, `vite-plugin`, `inspector`, `analyzer`, `ai`, `cache`, `cli`. Chỉ một app active: `apps/playground-react`. Tính cả root có chín workspace project.

Node.js yêu cầu `^22.22.3 || ^24.15.0`; local đã kiểm chứng bằng Node 22.23.2, pnpm 10.33.0. TypeScript 6.0.3, Vite 8.3.5, React 19.3.1. Packages ESM-only, private; cross-package imports dùng public exports và `workspace:*`, relative TypeScript imports dùng `.js`, project references theo dependencies. `core`/`inspector` phải browser-safe.

Phase 02 kế thừa gồm Vite development-only injection, authenticated loopback WebSocket bridge, sanitized route tracking, source notices, reconnect/lifecycle/restart, guarded source reads và CLI dev/doctor. Bridge xác minh Origin/Host/token, không có tùy ý file-read/shell RPC. Hiện hỗ trợ standalone HTTP Vite trên loopback; HTTPS và middleware mode chưa hỗ trợ. Xem [ADR 0004](adr/0004-vite-local-bridge.md).

## 4. Phase 03 — Browser Element Inspector

Implementation chính:

- [browser.ts](../packages/inspector/src/browser.ts): selection/overlay, delegated hover và Alt interactions, right-click menu, pin/unpin/close/copy, keyboard/focus, geometry, lifecycle/cleanup và trạng thái lỗi/kết nối.
- [metadata.ts](../packages/inspector/src/metadata.ts): bounded visible/Japanese text, allowlisted attributes và DOM/accessibility metadata; privacy exclusions.
- [inspector.spec.ts](../tests/e2e/inspector.spec.ts): real React/Vite browser interactions, privacy, geometry, frames/shadow roots, accessibility/focus, SPA/HMR và recovery.

UI nằm trong Shadow DOM. Hover coalesce bằng animation frames; normal hover thụ động, các hành động inspection có activation rõ ràng. Supported DOM gồm SVG, links/buttons/forms/nested/dynamic React content, accessible open shadow roots và same-origin frames. Không sửa source text, không gọi AI từ browser, không lấy input values hay private/editable content.

Giới hạn: cross-origin frames/closed roots opaque; geometry iframe phức tạp và accessible-name calculation không được mô tả là hoàn chỉnh. Japanese extraction là heuristic, có thể nhận cả Han text. Clipboard có error/manual recovery. DOM metadata không tự tạo source certainty.

Đọc [ADR 0005](adr/0005-browser-element-inspector.md) và [validation Phase 03](phase-03-validation.md).

## 5. Phase 04 — DOM-to-JSX source mapping

Implementation chính:

- [instrumentation.ts](../packages/analyzer/src/instrumentation.ts): TypeScript AST + MagicString cho original `.tsx`/`.jsx`, metadata/IDs và source maps.
- [mapping.ts](../packages/vite-plugin/src/mapping.ts): development-only Vite instrumentation/runtime integration và guarded source handling.
- [mapping-runtime.ts](../packages/inspector/src/mapping-runtime.ts): public React ref callbacks, WeakMap trên committed DOM nodes, runtime IDs, stale/ambiguous outcomes.
- [mapping.ts contract](../packages/core/src/mapping.ts), [mapping integration](../tests/active/integration/mapping.test.ts), [mapping E2E](../tests/e2e/mapping.spec.ts), fixtures trong `tests/fixtures/react-mapping/`.

Mapping gắn DOM node với JSX template origin, file/line/column và lexical component. Không dựa vào CSS selectors, ancestor guesses hoặc private Fiber. Reusable/list instances dùng runtime identity riêng; source site có thể giống nhau. HMR/SPA cập nhật/invalidate evidence, kể cả source đang syntax error trong khi DOM cũ vẫn còn. Tests so sánh behavior/ref lifecycle/DOM với baseline không instrumentation.

Envelope được hỗ trợ có chủ ý: safe intrinsic JSX. Existing refs, spreads, custom elements, opaque factories/transformations, copied DOM và upstream-modified sources có thể trả UNKNOWN. Lexical component không phải complete React owner stack. Không tuyên bố map được mọi React program; phải đọc điều kiện ID stability và semantic limitations trước khi mở rộng.

Đọc [ADR 0006](adr/0006-react-source-mapping.md) và [validation Phase 04](phase-04-validation.md).

## 6. Phase 05 — Static Code Analysis Engine

Public API: `createStaticAnalyzer(options)` từ `@devanalyst/analyzer`, với `analyzeDetailed(request)` và adapter `analyze(request): Finding[]`.

Các file cần review:

- [engine.ts](../packages/analyzer/src/engine.ts): orchestration/result/selected subjects.
- [project.ts](../packages/analyzer/src/project.ts): authorized snapshots, JSON/JSONC config, aliases/TypeScript paths, closed module resolver/compiler host.
- [semantic.ts](../packages/analyzer/src/semantic.ts), [extract.ts](../packages/analyzer/src/extract.ts), [syntax.ts](../packages/analyzer/src/syntax.ts): symbols, components/props, guards, handlers/calls/hooks/state/effects, API/navigation classification và bounded tracing.
- [analysis-options.ts](../packages/analyzer/src/analysis-options.ts), [workspace.ts](../packages/analyzer/src/workspace.ts), [analysis contract](../packages/core/src/analysis.ts).

TS/JS/TSX/JSX được phân tích mà không import/evaluate app/config code. Closed graph hỗ trợ local imports/re-exports/barrels, aliases/path maps, canonical cycle prevention và budget/cancel diagnostics. Phát hiện source patterns cho React Router, fetch, Axios/service wrappers, callbacks và state/hooks/effects. Endpoints/destinations động không được đoán. Plain render-method classes, custom hooks, candidate dispatch/prop callbacks và map-returning components có confidence thận trọng.

Workspace policy đã chuyển từ Vite sang analyzer để tránh dependency cycle; file Vite cũ là compatibility re-export. Giữ containment, mandatory exclusions, symlink/inode/change checks và 256 KiB/file. AI cũng dùng public policy này.

Mọi detailed finding có `execution: not-evaluated`, evidence/timestamp/cache state và trace confidence riêng. Module containment không phải invocation. `complete` nghĩa pipeline hoàn tất trong scope được hỗ trợ, không có nghĩa mọi behavior đã biết. Không có full interpreter/dataflow/CSS cascade, external implementation traversal hoặc atomic repository snapshot. So mapping revision với `sourceHashes` trước khi gắn analysis vào runtime selection.

Đọc [API guide](static-analysis.md), [ADR 0007](adr/0007-static-analysis-engine.md), [unit tests](../packages/analyzer/src/engine.test.ts), [integration](../tests/active/integration/analysis.test.ts) và [validation Phase 05](phase-05-validation.md).

## 7. Phase 06 — Claude Code CLI provider

Public API: `createClaudeCodeProvider(options)` từ `@devanalyst/ai`; `checkReadiness()`, `checkReadiness({probe:true})`, `explain()` và `explainDetailed()`.

Các file cần review:

- [claude.ts](../packages/ai/src/claude.ts): provider lifecycle/readiness, context invocation, retry và result conversion.
- [process.ts](../packages/ai/src/process.ts): executable identity, environment, queue/global concurrency, deadline/cancel, POSIX process-group cleanup.
- [context.ts](../packages/ai/src/context.ts): consent intersection, snapshot/hash/range checks, whitelisted AST relationships/guards, secret heuristics và budgets.
- [protocol.ts](../packages/ai/src/protocol.ts), [contracts.ts](../packages/ai/src/contracts.ts), [options.ts](../packages/ai/src/options.ts): fixed CLI arguments, stream guards, strict output schema và bounded configuration.
- [AI unit tests](../packages/ai/src/claude.test.ts), [public integration](../tests/active/integration/ai.test.ts), mock executable data `tests/fixtures/claude-cli.mjs.txt` và helper `tests/active/helpers/claude-fixture.ts`.

Thiết kế quan trọng:

- Opt-in và explicit permitted paths; không tự bật khi import/factory construction; từ chối production.
- Spawn bằng argument arrays, `shell:false`, source context qua stdin, isolated temporary cwd, fixed system-only child PATH và environment allowlist. Không đưa workspace vào cwd/add-dir hoặc cho tùy ý CLI arguments.
- Safe/restricted mode, empty tool set, dontAsk, strict empty MCP, tắt skills/customizations/hooks/session persistence; validate stream metadata. Chỉ chấp nhận schema-return `StructuredOutput` và ba built-in plugins đã nhận diện; có tool/plugin/hook capability ngoài policy thì hủy/reject.
- CLI hiện chỉ allow đúng **2.1.323**, native POSIX; release khác fail closed chờ kiểm chứng. Windows wrappers, custom gateways và third-party routing chưa hỗ trợ.
- Context từ deterministic findings + matching source hashes, giới hạn files/snippets/bytes/tokens, kiểm tra lại source trước khi nhận kết quả. Secret/path detection là heuristic; caller vẫn phải chọn dữ liệu an toàn. Không gửi form/password/private runtime values.
- Model trả evidence IDs, Node gắn lại evidence thật; không tin file/line do model tự viết. AI prose tối đa INFERRED, không ghi đè deterministic VERIFIED facts. Thiếu source thì UNKNOWN, kể cả UI-only translation.
- Queue/concurrency, timeout, cancel, output/usage budgets và transient-only retries có giới hạn. Không retry auth/quota/invalid-output/permission/stale-context failures. Không log raw source/provider diagnostics/credentials.

**Giới hạn runtime:** đây là CLI capability/permission controls, không phải OS sandbox chống executable/admin policy độc hại. Installed CLI, recognized built-ins và host administrator là trust boundary. Secret heuristics không bảo đảm nhận diện mọi bí mật; token/spend caps không bảo đảm hóa đơn chính xác; cancellation có thể đã tiêu tốn provider tokens. CLI/provider có retention policies riêng. Đọc đầy đủ ADR trước khi sửa flags hoặc tăng khả năng đọc/chạy công cụ.

**Kết quả CLI thật tại thời điểm bàn giao:** native 2.1.323 được phát hiện. Cả sandbox và lần kiểm tra ngoài sandbox được cho phép đều trả `AI_AUTH_UNAVAILABLE`, `authenticated:false`. Một invocation tổng hợp, không dùng source dự án, xác minh init/structured auth-error path. Chưa có successful live authenticated inference, chưa xác minh chất lượng dịch/business reasoning từ model thật. Mocked structured success không được gọi là live success. Không tự đăng nhập, đổi credentials hoặc suy ra SDK entitlement.

Đọc [usage/compatibility](claude-code.md), [ADR 0008](adr/0008-claude-code-provider.md) và [validation Phase 06](phase-06-validation.md).

## 8. TypeScript/editor fixes

Root `tsconfig.json` extends `tsconfig.tools.json`, references trực tiếp cả bảy package; root typecheck kiểm tra cùng project để unit/integration/E2E files không rơi vào inferred editor project thiếu Node types. Các library production configs tiếp tục loại tests và dùng explicit exports/references.

TypeScript server semantic/suggestion diagnostics đã được chạy thêm ngoài CLI typecheck. Các deprecated APIs của TS 6 được sửa: ImportClause dùng `phaseModifier`; đọc legacy `baseUrl` qua typed compatibility view để hỗ trợ project cũ. AI deadline signal có explicit `AbortSignal` type để declaration emit hợp lệ. Không dùng suppression để che các diagnostics này.

Temporary script kiểm tra tsserver trong phiên nằm ngoài repository và không phải prerequisite cho agent mới. Nếu cần tái hiện editor warnings, dùng workspace TypeScript 6.0.3, kiểm tra project ownership của file và cả semantic/suggestion diagnostics, không chỉ `tsc` exit status.

## 9. Kiểm chứng đã chạy

Local: macOS/Darwin 24.1.0 arm64, Node 22.23.2, pnpm 10.33.0, Vite 8.3.5, React 19.3.1, Playwright Chromium.

| Kiểm tra                    | Kết quả cuối đã thực hiện                                                               |
| --------------------------- | --------------------------------------------------------------------------------------- |
| Offline/frozen pnpm install | Đạt, chín workspace project                                                             |
| `pnpm lint`                 | Đạt ESLint zero warnings, formatting, dependency boundaries/cycles                      |
| `pnpm typecheck`            | Đạt packages, root tools/tests và React app                                             |
| TypeScript server           | Không có semantic/suggestion diagnostics trong changed TypeScript files được kiểm tra   |
| `pnpm test:smoke`           | **245 unit/integration tests trong 20 file + 26 Chromium E2E tests đạt**                |
| `pnpm test:independent`     | Cả bảy package build độc lập sau khi xóa prerequisite outputs                           |
| `pnpm build`                | Đạt packages và real React production build                                             |
| `pnpm test:packages`        | Đạt exports, private import rejection, declarations/maps, local packaging và CLI checks |
| Native Claude diagnostics   | Detection/capability/auth-error path đạt; successful live inference chưa kiểm chứng     |

53 AI unit cases và một public-package AI integration được thêm ở Phase 06. Browser mapping E2E còn có luồng selected DOM → JSX reference → Node static analyzer, giữ nguyên React state. Production tests kiểm tra thêm inspector/mapping/analyzer/AI markers không rò vào host bundle.

Kết quả trên là các lượt triển khai trước commit; tác vụ commit/handoff không tuyên bố chạy lại toàn bộ runtime suites. Những lỗi trong quá trình phát triển và cách sửa được ghi trong validation reports. Các report Phase 03–05 mô tả trạng thái tại lúc phase đó hoàn tất, nên các mục “pending” lịch sử không thay thế status hiện tại.

Bảng trên ghi lại các kiểm tra local ban đầu; không tự chứng minh Linux/Node 24, browser engines khác hoặc authenticated model quality. Sau push, cả hai commit đã có CI failures và được xử lý trong [CI watcher follow-up](ci-watcher-validation.md); kiểm tra Actions của commit sửa để biết kết quả hosted hiện tại. Các timing trong report là observation local riêng lẻ, không phải benchmark hay target đã đạt. Generated `dist`, `test-results` và metrics tạm không được commit.

### CI follow-up sau khi người dùng báo cả hai commit lỗi

Lỗi E2E HMR đã được tái hiện 3/3 lần bằng native watcher backend trên macOS: test ghi correction khoảng 5 ms sau bản lỗi, trong cửa sổ coalescing 50 ms và trước response compile lỗi. Fixture nay dùng native backend, tách các lần save và chờ HTTP 500 thật; giữ nguyên stale/VERIFIED assertions, bổ sung state/no-reload assertions. Targeted case đạt 10/10 lần. Test bridge chờ file xuất hiện trong public getWatched trước khi sửa. Không đổi production watcher hay thêm retries/skip. Commit aa76d23 đã sửa watcher: Node 24 sau đó pass toàn bộ CI; Node 22 phát hiện thêm race iframe load trước discovery trễ 200 ms. Regression first-click mới tái hiện lỗi 3/3 lần; runtime được sửa bằng parent-document load capture, hai ca iframe sau đó đạt 20/20 lượt lặp; full local check đạt 245 unit/integration + 27 E2E tests. Xem [báo cáo](ci-watcher-validation.md) và Actions của HEAD để biết kết quả hosted mới; không dùng local pass làm bằng chứng cả matrix đã xanh.

## 10. Cách chạy và lưu ý cho agent tiếp theo

```sh
pnpm install --frozen-lockfile
pnpm build:packages
pnpm lint
pnpm typecheck
pnpm test:smoke
pnpm test:independent
pnpm build
pnpm test:packages
```

- Không chạy `test:independent` đồng thời với build, watcher hoặc tests đang dùng dist: lệnh này xóa generated outputs rồi build lại.
- Lint nên chạy sau transient fixture suites; đã gặp race khi ESLint đang walk thư mục fixture vừa bị test cleanup.
- Integration/E2E cần bind loopback và launch browser/subprocess; nếu sandbox chặn, dùng approval flow phù hợp và ghi rõ lỗi môi trường, không giảm assertions.
- Chỉ dùng targets active. Không sửa lockfile/dist thủ công. Không đặt bridge credentials vào URL/log/network trace. Tests dùng owned temporary fixtures, không thay app source của người dùng.
- `pnpm dev` chạy React playground; CLI dev/doctor đã có. Cấu hình hiện truyền rõ qua Vite plugin, chưa có automatic `devanalyst.config.ts` loader hoàn chỉnh.

## 11. Review ưu tiên và công việc còn lại

Các điểm nên review trước khi mở rộng:

1. Mapping có giữ đúng semantics/ref lifecycle/source maps, invalidation khi HMR lỗi, list identities và UNKNOWN boundaries không; không mở safe envelope bằng selector/Fiber guesses.
2. Static graph/call traces/guards có giữ confidence đúng, tránh false VERIFIED từ mutable/dynamic/external patterns, và resource/canonical-path checks còn đủ không.
3. AI consent intersection, exact hash/range provenance, source-change handling, output citations, secret heuristics, queue/deadline/process-group cleanup và runtime tool policy có đúng trust boundary đã mô tả không.
4. TypeScript editor projects, public exports, runtime dependencies và project references có nhất quán khi build độc lập không.
5. Tests có thực sự kiểm chứng source/host preservation và failure paths, hay còn gap cần báo cáo; phân biệt mocked CLI protocol với authenticated model behavior.

Chưa triển khai đầy đủ: browser composition/RPC cho static/AI result display, translation/follow-up UI journeys, editor navigation VS Code/Cursor, background/pre-analysis scheduling, SQLite/persistent cache/invalidation, full configuration utilities, performance/release matrix. HTTPS/middleware support và các React/browser/OS versions ngoài envelope vẫn là giới hạn. Toàn bộ F01–F18/Definition of Done còn bắt buộc; không coi API foundations hoặc số tests đạt là product completion.

Prompt gợi ý để chuyển cho agent review:

> Đọc AGENTS.md và docs/chat-session-overview.md, sau đó review thay đổi từ aab9354 đến HEAD (code chính 59caac4 và CI watcher follow-up) cho Phase 03–06. Đối chiếu constitution, ADR 0005–0008 và validation reports; ưu tiên correctness, source evidence/confidence, React semantics, privacy/read-only enforcement, cancellation/resource bounds, TypeScript/imports và realistic test coverage. Báo cáo vấn đề theo mức độ cùng file/line và cách tái hiện, phân biệt vấn đề đã chứng minh với rủi ro/chỗ chưa kiểm chứng. Không coi mock CLI success là live inference success. Không tự bắt đầu Phase 07, thêm browser AI/source RPC, mở rộng framework, publish hoặc push thay đổi mới khi chưa có yêu cầu tiếp theo.
