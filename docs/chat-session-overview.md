# DevAnalyst — Tổng hợp phiên làm việc

Tài liệu tổng hợp các yêu cầu, quyết định và kết quả đã được ghi nhận trong phiên chat đến khi hoàn tất Phase 02. Đây là bản bàn giao bối cảnh; trạng thái phát triển tiếp theo được theo dõi tại [progress.md](progress.md).

## 1. Định hướng và quy ước đã chốt

- Tên sản phẩm: **DevAnalyst**, mô tả: **AI-Powered Frontend Code Inspector**.
- Namespace package: `@devanalyst/*`; CLI: `devanalyst`; file cấu hình dự kiến: `devanalyst.config.ts`.
- Người dùng đã xác nhận giữ tên DevAnalyst theo constitution khi một số phase prompt sử dụng tên cũ.
- NPM scope vẫn là đề xuất, chưa xác minh quyền sở hữu; các package hiện để private.
- Chỉ triển khai phase được yêu cầu; không tự bắt đầu phase kế tiếp, tạo commit hoặc publish package.

[Project constitution](project-constitution.md) đặt các nguyên tắc xuyên suốt: deterministic analysis trước AI, giải thích dựa trên source evidence, phân loại `VERIFIED` / `INFERRED` / `UNKNOWN`, bảo vệ dữ liệu nhạy cảm, AI opt-in và chỉ hoạt động trong development. Không suy diễn kết quả AI thành hành vi đã được kiểm chứng.

## 2. Phạm vi framework hiện tại

**React + Vite + TypeScript là tổ hợp duy nhất đang được hỗ trợ.** Claude Code CLI vẫn là hướng tích hợp AI chính khi đến phase tương ứng.

Quy tắc scope bắt buộc đã được thêm vào [AGENTS.md](../AGENTS.md). README, architecture, implementation plan, progress và testing đã được cập nhật nhất quán với scope này. Các framework khác được đưa vào Future Roadmap, không có phase, dependency hay test target đang hoạt động.

Mã nguồn/configuration lịch sử của các framework ngoài scope được giữ lại, loại khỏi active workspace và các lệnh kiểm tra. Không xóa công việc đã có của người dùng. Việc thu hẹp framework không cắt giảm tính năng: toàn bộ 18 khả năng trong [implementation plan](implementation-plan.md) vẫn bắt buộc cho React + Vite.

## 3. Nền tảng monorepo được kế thừa và đồng bộ

Nền tảng Phase 01 hiện có gồm pnpm workspaces, TypeScript strict, ESM, package exports, declaration/source maps, shared contracts, Zod schemas, structured errors/logging, ESLint, Prettier, Vitest, Playwright và GitHub Actions.

Trong Phase 02, workspace, lockfile, scripts, TypeScript references, dependency-boundary checks, lint/test targets và CI đã được đồng bộ để chỉ chạy bảy package cùng một React playground:

```text
packages/
  core/          # Contracts, validation, configuration, errors, logging
  vite-plugin/   # Vite lifecycle và local bridge
  inspector/     # Browser route/connection runtime; UI chưa triển khai
  analyzer/      # Interfaces; AST analysis chưa triển khai
  ai/            # Interfaces; Claude execution chưa triển khai
  cache/         # Interfaces; persistent cache chưa triển khai
  cli/           # Help, version, dev, doctor
apps/
  playground-react/
```

Tổng cộng có chín workspace project đang hoạt động, tính cả root. Cấu trúc chi tiết và các thư mục lịch sử được liệt kê tại [repository-structure.md](repository-structure.md). Kết quả Phase 01 trước khi thay đổi scope được giữ trong [báo cáo lịch sử](phase-01-validation.md).

## 4. Phase 02 — Vite Integration and Local Bridge

### Tự động tích hợp qua Vite

- Implement `devanalyst()` trong `@devanalyst/vite-plugin` và đăng ký trong React playground.
- Chỉ kích hoạt khi development serve, có kiểm tra production sau khi resolve config.
- Tự inject browser module và cung cấp bootstrap endpoint cùng origin với ứng dụng.
- Khởi động bridge bất đồng bộ sau khi Vite HTTP server bắt đầu listen; không đưa analysis vào đường xử lý startup hoặc HMR.
- Build production không inject runtime và không khởi động bridge.

### Local bridge và bảo vệ giao tiếp

- Bridge HTTP/WebSocket riêng, bind `127.0.0.1`; mặc định port `0` để hệ điều hành chọn port trống.
- Tạo credential ngẫu nhiên 256-bit cho mỗi server generation; xác thực qua WebSocket subprotocol.
- Kiểm tra loopback peer, Origin, Host, endpoint và token trước khi chấp nhận kết nối.
- Bootstrap sử dụng `no-store`; credential không nằm trong URL, HTML, runtime module, logs hay public snapshots.
- Validate message theo schema/version; giới hạn connection, frame size, message rate, send buffer và queue.
- Hỗ trợ port cố định, strict-port error và bounded fallback khi có xung đột; lỗi bridge không làm Vite dừng hoạt động.
- Không cung cấp RPC đọc file tùy ý hoặc chạy shell.

### Browser runtime và route tracking

- Theo dõi kết nối/ngắt kết nối và nhận xác nhận route từ bridge.
- Phát hiện route ban đầu, `pushState`, `replaceState`, `popstate`, `hashchange` trực tiếp trong browser; không lấy route từ terminal logs.
- Chỉ giữ pathname và hash-route path được hỗ trợ; bỏ query string, opaque fragments và history-state values.
- Giữ hành vi, giá trị trả về và lỗi native của History API; khôi phục các wrapper còn thuộc runtime khi stop.
- Reconnect có giới hạn, backoff/jitter và lấy bootstrap mới để nhận token/port mới.
- Xử lý page suspension/resumption và cung cấp diagnostics không chứa credential qua `window.__DEVANALYST_BRIDGE__`.

### Watcher, HMR và lifecycle

- Nhận sự kiện add/change/unlink từ Vite watcher, lọc source hợp lệ và gửi relative source notices theo queue có giới hạn.
- React Fast Refresh tiếp tục hoạt động và giữ state trong kiểm thử browser.
- Cleanup listener, timer, socket và port khi shutdown; hỗ trợ Vite restart cùng token rotation.
- Tách lifecycle theo từng server generation để xử lý trường hợp Vite cấu hình server mới trước khi đóng server cũ.
- Cô lập lỗi của observer đồng bộ và bất đồng bộ, không để callback làm hỏng protocol hoặc host app.

### Filesystem guards và CLI

- Thêm workspace access policy: include/exclude, mandatory sensitive-file exclusions, canonical containment, symlink checks, file identity/change checks và giới hạn dung lượng đọc.
- Có regression coverage cho canonical-path aliases và unlink khi parent directory đã bị xóa.
- CLI giữ help/version, bổ sung `dev` và `doctor` thông qua public Vite APIs, không shell interpolation hoặc sửa project source tự động.
- `dev` yêu cầu project đã cấu hình plugin, từ chối production và shutdown qua SIGINT/SIGTERM.
- `doctor` báo Vite/plugin configuration mà không khởi động bridge hay AI. Vite configuration là executable project code được tin cậy.

Chi tiết quyết định kiến trúc nằm trong [ADR 0004](adr/0004-vite-local-bridge.md) và [architecture.md](architecture.md).

## 5. Kết quả kiểm chứng đã chạy ở Phase 02

| Kiểm tra                                   | Kết quả đã ghi nhận                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile --offline` | Đạt, chín workspace project đang hoạt động                                                 |
| `pnpm lint`                                | Đạt ESLint, formatting, dependency boundaries; không có circular package dependencies      |
| `pnpm typecheck`                           | Đạt cho active packages, tools/tests và React app                                          |
| `pnpm test:smoke`                          | 102 unit/integration tests trong 12 file và 6 Chromium E2E tests đều đạt                   |
| `pnpm build`                               | Đạt cho bảy package và React production build                                              |
| `pnpm test:independent`                    | Cả bảy package build độc lập từ generated outputs đã được xóa                              |
| `pnpm test:packages`                       | Đạt public exports, private path rejection, declarations/maps, local archive và CLI checks |

Các kiểm thử dùng Vite/WebSocket thật, consumer `npm run dev`, CLI subprocess và React browser fixture. Đã kiểm chứng route đổi không reload, Fast Refresh giữ state, reconnect/stop, page lifecycle, Vite restart, token rotation, port release, invalid messages và production exclusion. Test phục hồi bootstrap chủ động tạo hai HTTP failure; các luồng thành công dùng implementation thật.

So sánh SHA-256 xác nhận 24 file source/configuration lịch sử và hai test file lịch sử được giữ nguyên. Dependency/importer của framework ngoài scope không còn trong active lockfile.

Môi trường kiểm chứng: Node.js 22.23.2, pnpm 10.33.0, Vite 8.3.5, macOS/Darwin 24.1.0 arm64, Chromium qua Playwright. Hosted CI và Node.js 24 mới được cấu hình, chưa được chạy trong môi trường local. Một lần gọi smoke qua redirect bị hạn chế bind port; lần chạy trực tiếp được cho phép đã đạt đầy đủ, không giảm assertions.

Đây là kết quả của lần triển khai Phase 02 đã hoàn tất; tác vụ viết bản tổng hợp này chỉ thay đổi tài liệu và không chạy lại runtime suites. Xem [phase-02-validation.md](phase-02-validation.md) để đọc bằng chứng và giới hạn chi tiết.

## 6. Cách sử dụng hiện tại

Khởi động React playground cùng DevAnalyst:

```sh
pnpm install --frozen-lockfile
npm run dev
```

Sau khi build, chạy CLI trực tiếp trong repository:

```sh
node packages/cli/dist/bin.js --help
node packages/cli/dist/bin.js doctor apps/playground-react
node packages/cli/dist/bin.js dev apps/playground-react --port 5173 --strict-port
```

Xem [README](../README.md) để cấu hình plugin, port, diagnostics và các lệnh verification. Không chạy `test:independent` đồng thời với build/watch vì lệnh này xóa generated library outputs.

## 7. Giới hạn và công việc còn lại

Transport hiện hỗ trợ standalone HTTP Vite trên loopback. HTTPS và middleware mode trả `UNSUPPORTED_FEATURE`, giữ host app hoạt động. CSP của project cần cho phép runtime/bootstrap và loopback WebSocket port đã chọn. Chưa tự load `devanalyst.config.ts`; cấu hình hiện được truyền rõ ràng qua Vite plugin.

Những phần sau vẫn chưa được triển khai đầy đủ:

- DOM-to-JSX mapping, React component identification và source instrumentation.
- Props/conditions, handler/callback, hooks/state, API và source-backed routing analysis.
- Hover, Alt+Hover, Alt+Click, custom right-click, floating evidence UI, themes và accessibility.
- Claude Code CLI execution, runtime read-only enforcement, Nhật–Việt translation và AI follow-up.
- Automatic page pre-analysis, scheduling, SQLite cache và targeted invalidation.
- VS Code/Cursor source navigation, configuration utilities hoàn chỉnh, performance benchmarks và release preparation.

Filesystem guards hiện tại không phải sandbox cho AI subprocess. Route metadata không chứng minh hành vi source code. Các kiểm thử infrastructure đã đạt không có nghĩa toàn bộ sản phẩm đã hoàn tất. Các phase tiếp theo trong implementation plan vẫn cần yêu cầu riêng từ chủ dự án; không có phase mới, commit hoặc publication được tự động thực hiện.
