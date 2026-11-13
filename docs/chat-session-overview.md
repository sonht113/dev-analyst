# DevAnalyst — Overview conversation và bàn giao Phase 07–09

Cập nhật ngày 2026-11-13. Conversation này tiếp nối nền tảng Phase 01–06 và các sửa lỗi CI/watcher/iframe. Owner lần lượt yêu cầu triển khai Phase 07, Phase 08, Phase 09, sau đó cho phép commit, push và cập nhật overview. Trạng thái sản phẩm chi tiết nằm tại [progress](progress.md); phạm vi bắt buộc nằm tại [implementation plan](implementation-plan.md).

## 1. Git và phạm vi bàn giao

- Repository: `sonht113/dev-analyst`; branch `master`, remote `origin`.
- Baseline trước Phase 07–09: `541eddbc05e1e6b08023a50d120ce4aa03f27b38` — sửa việc gắn listener ngay khi iframe tải xong. Các commit trước gồm `aa76d23` (đồng bộ native watcher fixtures), `f84d6da` (overview cũ), `59caac4` (Phase 03–06).
- Code Phase 07–09 đã commit và push: [`5cc33d328d09bc9eb700f1326861881b38ecaaaf`](https://github.com/sonht113/dev-analyst/commit/5cc33d328d09bc9eb700f1326861881b38ecaaaf), `feat: add predictive analysis, persistent cache and inspector UI`.
- Commit code gồm 76 file, 8.573 dòng thêm và 84 dòng bỏ, bao gồm implementation, tests, contracts/exports/configuration, ADR và validation reports. Các phase dùng chung hạ tầng nên được bàn giao trong một commit tổng hợp.
- Overview này được cập nhật bằng commit docs ngay sau commit code. Dùng `git log -2 --oneline` để lấy cả hai. Những câu “uncommitted” hoặc “chưa được phép commit/push” trong validation reports mô tả thời điểm triển khai từng phase, không phải trạng thái bàn giao sau yêu cầu cuối.
- Không publish package, tạo PR, force-push, rewrite history hoặc thay đổi external services. Yêu cầu commit/push này không tự cho phép triển khai phase kế tiếp.

## 2. Quyết định xuyên suốt

- Giữ tên **DevAnalyst**, namespace **`@devanalyst/*`**, CLI `devanalyst`. Prompt có dùng tên lịch sử DevLens/`@devlens/cache`; không tạo identity/package song song.
- **Chỉ React + Vite + TypeScript.** Bảy package active: `core`, `vite-plugin`, `inspector`, `analyzer`, `ai`, `cache`, `cli`; app duy nhất `apps/playground-react`. Các framework cũ được giữ nguyên ngoài active workspace/build/test/CI.
- TypeScript strict, pnpm workspaces, ESM-only, public package exports, relative imports có `.js`, internal dependencies dùng `workspace:*` và đồng bộ project references. `core`/`inspector` phải browser-safe.
- Deterministic AST trước AI. VERIFIED xác minh bằng chứng/quan hệ nguồn, không chứng minh thực thi. Model prose tối đa INFERRED; thiếu bằng chứng hoặc nguồn cũ phải UNKNOWN.
- AI opt-in với `enabled` và `permittedPaths`; giữ runtime no-tools permissions, guarded paths/hashes, context/resource limits và process cleanup từ Phase 06. Không coi mock success hay auth status là live inference success.
- Không đổi text gốc hoặc normal host interactions; giữ React semantics/source maps. Không truyền raw DOM text, form/password values, history state hoặc dữ liệu runtime riêng tư sang Node/provider.

Đọc [AGENTS.md](../AGENTS.md), [constitution](project-constitution.md), [architecture](architecture.md), [implementation plan](implementation-plan.md), [progress](progress.md), [testing](testing.md) trước khi làm tiếp. Repository không có `.codegraph/` tại lúc bàn giao; không tự tạo index. Nếu sau này có index thì dùng CodeGraph trước khi tìm/đọc code.

## 3. Phase 07 — Predictive Page Pre-analysis

- Browser tự thu thập cấu trúc phần tử nhìn thấy sau khi bridge kết nối; route pathname/hash-route tạo page generation. Giữ dynamic path segments, bỏ query/history state/opaque fragments.
- Chỉ JSX origins được Node transform registry xác nhận mới vào queue. Protocol gửi structural metadata/source identity, không gửi DOM text, arbitrary coordinates hoặc values.
- Queue bất đồng bộ ưu tiên selected, hovered và button/link/form/menu/tab; deduplicate module dùng chung giữa instance/page, hủy khi subscriber cuối rời đi, nâng ưu tiên phần tử chưa có cache khi queue đầy.
- AST chạy trong cancellable worker threads, giải phóng worker trước khi nhả slot; bounded concurrency/queue/memory/depth/time. Startup, render và HMR không chờ behavior analysis.
- Index page/module/component/related files; sáu trạng thái NOT_ANALYZED, QUEUED, ANALYZING, READY, STALE, FAILED cùng AI state/cache/error/progress riêng. Guarded dependency/config/missing-file/alias proofs bảo vệ reuse.
- Automatic background Claude mặc định tắt; cần cả AI/path consent và `preanalysis.backgroundAI: true`. Chỉ source-backed uncertainty mới đủ điều kiện; provider failure giữ kết quả deterministic.

Mã chính: `packages/analyzer/src/preanalysis.ts`, `worker.ts`, `analysis-worker.ts`, `packages/inspector/src/preanalysis-runtime.ts`, core contracts và Vite composition. Xem [usage](preanalysis.md), [ADR 0009](adr/0009-predictive-page-preanalysis.md), [validation](phase-07-validation.md).

## 4. Phase 08 — Persistent Analysis Cache

- SQLite trong worker riêng của `@devanalyst/cache`; page/component/element scopes, analysis và translation namespaces tách biệt. Default `.cache/devanalyst/analysis.sqlite`.
- Cache identity gồm project/policy/subject/revision, route/runtime fingerprints khi liên quan, provider/model/schema/language. Lưu source/config hashes, missing resolver candidates và canonical aliases để kiểm tra sau restart/offline changes.
- Watcher invalidation theo dependency, bảo thủ với topology changes; stale history luôn UNKNOWN và không được API current-result trả như bằng chứng mới. Cache hit hợp lệ tránh AST/Claude invocation mới.
- Generation-checked writes, transactional migrations, bounded requests/locks/entries/bytes/TTL, stale-first LRU eviction. Corrupt/future/unsafe DB giữ nguyên file và dùng memory fallback với diagnostic.
- Node plugin API có `inspectCache()`/`clearCache()`; không có browser cache/filesystem administration RPC. Chặn HTTP cache paths và cache đặt trong Vite public/build output; loại private/secret/runtime fields khỏi persistence.
- Cache workers dùng public analyzer workspace-only export để tránh khởi tạo TypeScript compiler không cần thiết. Analyzer nhận persistence hooks, không phụ thuộc ngược cache.

Mã chính: `packages/cache/src/{contracts,database,key,payload,persistent,privacy,worker}.ts`, `packages/vite-plugin/src/cache.ts`. Xem [usage/recovery](persistent-cache.md), [ADR 0010](adr/0010-persistent-analysis-cache.md), [validation](phase-08-validation.md).

## 5. Phase 09 — Translation and AI Inspector UI

- Tiếp tục native Shadow DOM UI theo ngoại lệ đã được chấp nhận ở ADR 0005; không chuyển framework/bundler. Hover gọn, pointer-transparent; Alt+Click/keyboard inspection mở chi tiết được ghim.
- Original Japanese, Vietnamese translation, component/source origin, purpose, visibility/disabled guards, handlers/call paths, API/navigation/state/effects, confidence và clickable source excerpts. Evidence links không đổi URL host hoặc mở editor.
- Translation, deterministic analysis và AI explanation là ba lane độc lập, stream kết quả theo bounded chunks. Glossary/cache dịch xuất hiện ngay khi có thể; không chờ business analysis. Hover không khởi tạo inference mới.
- Browser chỉ gửi source IDs/revision/route/mode và normalized text digest. Node-only JSX literal descriptors xác nhận static text khớp digest; dynamic/custom/private/editable/control content không thành provider text.
- Explicit expanded selection được phép gọi Claude khi AI/path consent hợp lệ, không cần bật automatic background AI. Translation và explanation có provider lane độc lập; giữ no-tools/context/hash/deadline controls.
- Client cache hữu hạn, stale demotion và late-response rejection; translation/selected explanation có SQLite identity riêng và được tái sử dụng qua Vite restart. Cache clear cũng invalidates Node inspector memory.
- Compact/expanded, independent copies, call search/confidence filtering, loading/partial/stale/failure/cache indicators, English/Vietnamese/Japanese chrome, system/light/dark themes, mobile positioning và keyboard/focus/text-selection behavior. Local storage chỉ chứa language/theme preferences.

Mã chính: inspector `inspection-client.ts`, `inspection-panel.ts`, `inspection-strings.ts`, `glossary.ts`; Vite `inspection.ts`/`inspection-view.ts`; analyzer `jsx-text.ts`; core inspector contracts và bridge composition. Xem [usage/consent](inspector-ui.md), [ADR 0011](adr/0011-translation-and-inspector-ui.md), [validation](phase-09-validation.md).

## 6. Các lỗi đáng chú ý đã xử lý

- Panel mở lớn làm mouse-up đổi target, click kế tiếp chọn nhầm ancestor: consume click đi cùng inspection pointer-down. Hồi quy SVG/frame/lazy/metadata giữ đúng target.
- Wide sibling lists dùng hết extraction budget trước khi đọc text: dành budget cho descendants; fixture 2.000 siblings vẫn có Japanese text và giữ user selection qua geometry updates.
- Old response có thể khôi phục confidence sau invalidation: chặn request cũ trước khi gửi request mới. Mapping disposal gửi data-free invalidation ngay trong HMR turn, trước paint, không chờ deferred watcher notice.
- Route thay đổi nhưng DOM node vẫn tồn tại: client invalidates/reissues và reuse source-only cache hợp lệ; source/AI cũ không bị giữ như current vô thời hạn.
- Persisted AI báo READY trước khi static hash validation hoàn tất: chỉ publish readiness sau validation. Deferred-validation regression tái hiện và chặn race một cách xác định; không nới cache-hit/provider-count assertions.
- Call paths từng lấy global trace đầu tiên: chuyển sang bounded BFS bắt đầu tại phần tử được chọn, loại sibling handlers và propagate confidence của edge.
- Invalid analyzer/provider configuration không được làm Vite fail startup: giữ host/bridge, safe diagnostic và ba FAILED lanes. Provider failure không xóa deterministic facts.
- Fixture tạo file rồi gửi request trước watcher notice: đồng bộ với sự kiện thật. Không dùng retries hoặc xóa failing assertions để làm aggregate xanh.

## 7. Kiểm chứng đã chạy

Local: Darwin arm64, Node 22.23.2, pnpm 10.33.0, TypeScript 6.0.3, Vite 8.3.5, React 19.3.1, Playwright Chromium. Node policy vẫn là `^22.22.3 || ^24.15.0`.

| Kiểm tra                         | Kết quả đã thực hiện                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm lint`                      | ESLint zero warnings, browser/package boundaries, cycle checks và formatting đạt           |
| `pnpm typecheck`                 | Bảy packages, root tools/tests và React fixture đạt                                        |
| `pnpm test:smoke`                | **307 unit/integration tests trong 28 file + 39 Chromium E2E tests đạt**                   |
| HMR regression `--repeat-each=5` | 5/5 lượt liên tiếp đạt; aggregate cuối cũng đạt                                            |
| `pnpm test:independent`          | Cả bảy package build độc lập từ prerequisite outputs đã xóa                                |
| `pnpm build`                     | Libraries và real React production build đạt; outputs được phục hồi sau independent checks |
| `pnpm test:packages`             | Public exports/private-path rejection, declarations/maps, local packaging và CLI smoke đạt |
| Analyzer queue regression        | 18/18 cases đạt sau test typing cleanup cuối                                               |
| Docs/whitespace                  | Formatting, local document links và `git diff --check` đạt                                 |

Phase 07 từng đạt 266/30; Phase 08 đạt 290/31. Phase 09 bổ sung 17 unit/integration cases và tám browser cases. Các con số trong report cũ là snapshot lịch sử. Các checks trên đã chạy ở lượt implementation; lượt commit/overview không tuyên bố chạy lại toàn bộ runtime suites.

Primary integrations dùng AST workers, guarded sources, SQLite, React/Vite và Chromium thật. Claude được thay bằng owned subprocess fixture mô phỏng CLI protocol, controlled delays và malformed output; **chưa xác minh live authenticated inference hoặc translation quality**. Production tests kiểm tra cả bridge/inspector/mapping/AST/AI/queue/cache/UI markers không rò vào host bundle.

UI failure fixture cuối quan sát 30 animation frames: max 16,80 ms, mean 16,19 ms. Hover burst 1.000 events: 3,30 ms, hai geometry reads. Đây là single local observations, không phải benchmark distribution hay bằng chứng toàn bộ project đạt latency SLA. Light/dark mobile screenshots đã được xem trực tiếp; light capture hiển thị lịch sử UNKNOWN/stale khi revalidate. Artifacts nằm trong ignored `test-results/`; log aggregate local ở `/private/tmp/devanalyst-phase09-smoke.log`, không phải prerequisite cho agent khác.

## 8. Cách chạy và giới hạn

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

- Không chạy `test:independent` đồng thời với builds/watchers/tests dùng dist: lệnh xóa generated outputs. Chạy lint/format sau transient fixture suites để tránh đọc fixture đang được tạo/xóa.
- Loopback/browser/subprocess suites có thể cần ngoài sandbox. Báo lỗi môi trường đúng thực tế; không hạ assertions hoặc đổi sang mock tính năng chính.
- `pnpm dev` chạy React playground; sửa served DevAnalyst runtime thì rebuild packages và restart Vite. Không chỉnh generated outputs/lockfile bằng tay; dependency resolution qua pnpm.
- Standalone local HTTP Vite 8.3.5+ là envelope hiện tại; HTTPS/middleware mode chưa hỗ trợ. Source mapping giữ safe JSX envelope, không dùng private React internals/selector guesses.
- Sau Vite restart, trang cũ có thể cần reload để tạo origin manifests mới trước khi cache được chấp nhận. Lazy modules được index sau commit.
- Dynamic/private runtime text không gửi lên AI; không khớp static source thì translation có thể unavailable/UNKNOWN. Locale preference đổi chrome, không giả vờ dịch Vietnamese provider prose sang ngôn ngữ khác.
- SQLite logical byte budget không đồng nhất physical disk/RSS. Corrupt/incompatible DB dùng bounded fallback và giữ disk file; xem recovery guide. Experimental SQLite warning của Node 22 không bị suppress.
- Source guards và no-tools execution có trusted CLI/admin boundary đã nêu trong ADR 0008; không tuyên bố OS sandbox hoặc bảo mật tuyệt đối. Other browser/OS/Node matrix và authenticated model quality chưa được thiết lập bởi local pass.

## 9. Phần việc còn lại và review tiếp theo

Chưa hoàn tất product: conversational follow-up journeys, VS Code/Cursor editor navigation, automatic configuration-file loader và operational utilities đầy đủ, wider performance/accessibility/failure matrix, authenticated model validation và release preparation. Mọi F01–F18/Definition of Done cho React + Vite vẫn bắt buộc. Không tự bắt đầu phase mới, mở rộng framework, publish hoặc push thay đổi mới từ một yêu cầu review.

Prompt gợi ý cho agent review:

> Đọc AGENTS.md và docs/chat-session-overview.md, sau đó review diff từ 541eddb đến 5cc33d3 cho Phase 07–09, cùng commit handoff kế tiếp. Đối chiếu constitution, ADR 0009–0011 và validation reports. Ưu tiên queue priority/dedup/cancellation/resource bounds; SQLite migration/concurrency/invalidation/privacy; source-scoped traces và confidence; independent translation/AI consent; stale/late-response/HMR/route behavior; host interaction/accessibility/production exclusion; public exports/project references và realistic integration coverage. Phân biệt vấn đề đã tái hiện với rủi ro, static evidence với runtime execution, mock CLI success với live authenticated success. Không tự triển khai phase tiếp theo hoặc thay đổi external services.
