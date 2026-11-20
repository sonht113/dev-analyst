# DevAnalyst

**AI-Powered Frontend Code Inspector** — kiểm tra phần tử trên trình duyệt, tìm đúng vị trí trong source, xem điều kiện hiển thị, handler, quan hệ gọi hàm, API và navigation có bằng chứng nguồn. Inspector hỗ trợ giao diện tiếng Việt/Anh/Nhật, dịch nhãn tiếng Nhật sang tiếng Việt, mở VS Code/Cursor và phân tích Claude Code khi người dùng chủ động bật.

DevAnalyst hiện có tích hợp **React + Vite, Vue 3 + Vite, Next.js + React và Nuxt 4** trong [phạm vi đã kiểm thử](docs/frameworks.md). Bản beta dùng scope npm **`@sonht113/*`**, license **MIT**; tên sản phẩm, binary `devanalyst` và file cấu hình vẫn giữ nguyên. Xem [trạng thái phát hành](docs/releasing.md) để xác nhận version/tag có trên registry.

Bản beta **`0.1.0-beta.1` đã được phát hành trên npm** theo license MIT; đủ 11 package và tag `beta` đã được xác minh bằng cài đặt độc lập từ registry. Xem [quy trình và trạng thái phát hành](docs/releasing.md), bao gồm trạng thái tag `latest` của lần phát hành đầu.

## Mục lục

- [1. Yêu cầu môi trường](#1-yêu-cầu-môi-trường)
- [2. Cài đặt repository](#2-cài-đặt-repository)
- [3. Chạy playground và kiểm tra kết nối](#3-chạy-playground-và-kiểm-tra-kết-nối)
- [4. Thao tác với inspector](#4-thao-tác-với-inspector)
- [5. Thêm DevAnalyst vào ứng dụng](#5-thêm-devanalyst-vào-ứng-dụng)
- [6. Cấu hình devanalyst.config.ts](#6-cấu-hình-devanalystconfigts)
- [7. Setup VS Code hoặc Cursor](#7-setup-vs-code-hoặc-cursor)
- [8. Bật Claude Code khi cần](#8-bật-claude-code-khi-cần)
- [9. CLI, diagnostics và cache](#9-cli-diagnostics-và-cache)
- [10. Kiểm thử trình duyệt và Playwright MCP](#10-kiểm-thử-trình-duyệt-và-playwright-mcp)
- [11. Build production](#11-build-production)
- [12. Xử lý lỗi thường gặp](#12-xử-lý-lỗi-thường-gặp)
- [13. Cấu trúc và tài liệu](#13-cấu-trúc-và-tài-liệu)

## 1. Yêu cầu môi trường

| Thành phần  | Yêu cầu                                                     |
| ----------- | ----------------------------------------------------------- |
| Node.js     | `^22.22.3` hoặc `^24.15.0`; `.nvmrc` pin **22.23.2**        |
| pnpm        | **10.33.0**, đúng với `packageManager` trong `package.json` |
| Git         | Có quyền truy cập repository                                |
| Trình duyệt | Chromium là trình duyệt dùng trong kiểm thử hiện tại        |
| Mạng        | Cần khi tải dependencies, browser hoặc gọi Claude           |
| Editor      | VS Code/Cursor chỉ cần nếu muốn dùng nút mở source          |
| Claude Code | Không bắt buộc để dùng mapping và phân tích deterministic   |

Phiên kiểm thử Phase 11 chạy trên **macOS arm64, Node 22.23.2**. Native compiler IPC của Next hướng tới macOS/Linux; Linux CI, Windows và Node 24 chưa được xác minh trong phiên này. Xem [validation](docs/phase-11-validation.md) trước khi suy rộng phạm vi hỗ trợ.

Các server phát triển dùng **HTTP loopback**: `127.0.0.1`, `localhost` hoặc `::1`. HTTPS, proxy/remote hosting và một số cấu hình framework chưa thuộc phạm vi đã xác minh.

## 2. Cài đặt repository

### Bước 1 — Clone và chọn Node.js

```sh
git clone https://github.com/sonht113/dev-analyst.git
cd dev-analyst
```

Nếu dùng nvm:

```sh
nvm install
nvm use
```

Nếu dùng công cụ quản lý Node khác, chọn phiên bản phù hợp với bảng trên. Kiểm tra:

```sh
node --version
```

### Bước 2 — Cài đúng pnpm

Nếu chưa có pnpm 10.33.0:

```sh
npm install --global pnpm@10.33.0
```

```sh
pnpm --version
```

Kết quả mong đợi là `10.33.0`. Repository bật `engine-strict` và strict peer dependencies; phiên bản Node hoặc framework không phù hợp có thể làm bước cài đặt thất bại.

### Bước 3 — Cài dependencies và build thư viện

Chạy tại **root repository**:

```sh
pnpm install --frozen-lockfile
pnpm build:packages
```

Bước này cài 16 workspace projects gồm root, 11 package và 4 playground, rồi tạo JavaScript/declarations trong `packages/*/dist`. Không sửa `dist` hoặc lockfile bằng tay.

Không cần database server, API key hay Claude để chạy thử inspector. SQLite cache được quản lý tự động qua worker của DevAnalyst.

### Bước 4 — Mở một playground

```sh
pnpm dev:react
```

Mở [http://127.0.0.1:5173](http://127.0.0.1:5173). Dùng **Alt+Click** trên phần tử để xem mapping và phân tích nguồn. Các playground đã đăng ký integration; bước chạy thử không cần tạo config hoặc khởi động bridge riêng.

`pnpm dev` và `npm run dev` cũng khởi chạy playground React. Các lệnh `dev:*` tự build package prerequisites trước khi chạy app.

## 3. Chạy playground và kiểm tra kết nối

### Chọn framework

| Playground      | Lệnh từ root     | URL mặc định            | Phiên bản kiểm thử                                               |
| --------------- | ---------------- | ----------------------- | ---------------------------------------------------------------- |
| React + Vite    | `pnpm dev:react` | <http://127.0.0.1:5173> | React 19.3.1, Vite 8.3.5                                         |
| Vue + Vite      | `pnpm dev:vue`   | <http://127.0.0.1:5174> | Vue/compiler 3.5.45, plugin-vue 6.0.11, Router 5.5.1, Vite 8.3.5 |
| Next.js + React | `pnpm dev:next`  | <http://127.0.0.1:3000> | Next 16.4.6, React 19.3.1; mặc định Turbopack                    |
| Nuxt            | `pnpm dev:nuxt`  | <http://127.0.0.1:3001> | Nuxt/Kit 4.6.4, Vue 3.5.45, Vite 8.3.5, Nitro 2.13.6             |

Có thể mở nhiều app bằng các terminal riêng. Dừng từng app bằng **Ctrl+C** trong terminal đã khởi chạy nó. Không dùng chung một port cho hai server.

Bridge WebSocket chọn port loopback riêng, tự quản lý credential và lifecycle. Port ứng dụng ở bảng trên không phải port bridge; người dùng không cần tự nhập token hoặc chạy thêm bridge process.

### Xác nhận cài đặt thành công

1. Mở đúng URL ứng dụng; counter hoặc navigation của app vẫn hoạt động bình thường.
2. Thấy nút nổi **DevAnalyst · Analysis on/off** ở góc dưới bên phải màn hình.
3. Alt+Click phần tử có mapping: inspector hiển thị file, dòng/cột và `VERIFIED`.
4. Phân tích nguồn chuyển sang `AST READY`; page pre-analysis cập nhật tiến độ khi phát hiện phần tử và sau navigation.

Kiểm tra từ một terminal khác:

```sh
node packages/cli/dist/bin.js status apps/playground-react --url http://127.0.0.1:5173/
node packages/cli/dist/bin.js status apps/playground-vue --url http://127.0.0.1:5174/
node packages/cli/dist/bin.js status apps/playground-next --url http://127.0.0.1:3000/
node packages/cli/dist/bin.js status apps/playground-nuxt --url http://127.0.0.1:3001/
```

Chỉ chạy lệnh tương ứng với app đang mở. Khi bridge sẵn sàng và có một tab kết nối, kết quả có dạng:

```json
{
  "state": "ready",
  "clients": 1,
  "recovery": "If disconnected, reload the browser and allow the loopback WebSocket in CSP connect-src."
}
```

`clients: 0` có thể chỉ là chưa mở trang hoặc browser chưa kết nối. `ready` xác nhận local service, không chứng minh Claude đã sẵn sàng hay mọi phần tử đều có mapping.

Trong DevTools có thể xem snapshot không chứa bridge credential:

```js
window.__DEVANALYST_BRIDGE__?.getSnapshot();
window.__DEVANALYST_INSPECTOR__?.getSnapshot();
```

Snapshot inspector có thể chứa text đang hiển thị trong app; giữ dữ liệu này cục bộ. `pageAnalysis.completed` đếm site đã kết thúc ở READY hoặc FAILED, vì vậy cần xem cả trạng thái/lỗi thay vì chỉ dựa vào tổng số.

## 4. Thao tác với inspector

Playground hiện là dashboard quản lý **36 đơn hàng giả lập**: KPI, tìm kiếm/lọc/sắp xếp/phân trang, chọn nhiều/phê duyệt, form chi tiết, CSV và API error/retry. Counter/保存 nằm trong một khu vực lab nhỏ để so sánh mapping/HMR. Xem [hành trình thử nghiệm](docs/playgrounds.md).

| Thao tác                                     | Kết quả                                                      |
| -------------------------------------------- | ------------------------------------------------------------ |
| Hover                                        | Preview gọn; đưa chuột vào để cuộn/chọn chữ, không gọi AI    |
| Alt+Hover                                    | Xem metadata mở rộng                                         |
| Alt+Click                                    | Chọn và ghim phần tử, xem source/translation/analysis        |
| Nút nổi **Analysis on/off**                  | Tắt/bật toàn bộ hover, selection và phân tích của tab        |
| **Inspect** trong panel hoặc **Alt+Shift+I** | Bật/tắt chế độ chọn phần tử chủ động khi DevAnalyst đang bật |
| Alt+right-click                              | Mở menu inspection; right-click thường giữ menu browser/app  |
| Escape                                       | Đóng selection/menu                                          |
| Alt+P trong inspector                        | Ghim/bỏ ghim                                                 |
| Alt+C trong inspector                        | Sao chép metadata                                            |

Đưa chuột từ phần tử vào panel để đọc, cuộn và thao tác. Nội dung được giữ khi chuột hoặc focus ở trong panel; preview không tự ghim và không gọi AI. Nút **Ghim/Pin** giữ selection khi bạn di chuyển ra ngoài. Panel cuộn trong phần không gian còn trống, tránh tăng chiều cao đè lên nút đang inspect.

Các phím tắt trong config dùng physical key code; bảng trên là cách nhấn mặc định. Inspector có lựa chọn ngôn ngữ `en`, `vi`, `ja` và theme `system`, `light`, `dark`. Lựa chọn hiển thị đã lưu trong browser ưu tiên hơn giá trị mặc định từ config.

Nhấn link source để mở excerpt trong panel. Nút **Open source in editor / Mở mã nguồn trong editor** mở file trong editor khi đã [setup shell command](#7-setup-vs-code-hoặc-cursor). Hai thao tác này độc lập và không thay URL ứng dụng.

Ý nghĩa confidence:

- **VERIFIED**: có bằng chứng nguồn hiện tại, ví dụ vị trí template hoặc quan hệ handler → service → API. Không chứng minh lời gọi API thực sự đã chạy.
- **INFERRED**: cách diễn giải/dịch hoặc suy luận có giới hạn; AI prose không vượt mức này.
- **UNKNOWN**: thiếu bằng chứng, phần tử không được instrument, mapping mơ hồ/đã cũ hoặc cấu hình chưa hỗ trợ.

Original UI text được giữ nguyên. Translation có thể đến từ glossary/cache; nhãn chưa có bản dịch vẫn UNKNOWN khi AI tắt. Không thu thập password/form values; đánh dấu subtree riêng tư bằng `data-private` hoặc `data-devanalyst-private`. Cross-origin frames, closed shadow roots, canvas internals và một số hình học phức tạp có giới hạn riêng trong [inspector guide](docs/inspector-ui.md).

## 5. Thêm DevAnalyst vào ứng dụng

### Bản beta trên npm

Chọn integration tương ứng từ bản beta đã xác minh trên registry:

```sh
# React + Vite
pnpm add -D @sonht113/vite-plugin@beta

# Vue + Vite
pnpm add -D @sonht113/vue-plugin@beta

# Next.js
pnpm add -D @sonht113/next-plugin@beta

# Nuxt
pnpm add -D @sonht113/nuxt-module@beta
```

Chỉ cần cài integration tương ứng; registry sẽ resolve các dependency nội bộ. Đăng ký plugin/module theo hướng dẫn bên dưới. CLI tùy chọn được cài riêng bằng `pnpm add -D @sonht113/cli@beta`.

### Cách đưa package vào app

Các playground trong repository đã có dependency và cấu hình đúng. Nếu chỉ muốn trải nghiệm, bỏ qua phần này.

Với app khác trong **cùng pnpm workspace**:

1. Thêm đường dẫn app vào `pnpm-workspace.yaml` nếu chưa có. Repository hiện dùng danh sách app tường minh.
2. Cài integration tương ứng vào app bằng `workspace:*`.
3. Build thư viện từ root và đăng ký plugin/module theo framework bên dưới.

Ví dụ app có `name: "my-web-app"` trong `package.json`; chọn **một** lệnh phù hợp:

```sh
# React + Vite
pnpm --filter my-web-app add -D '@sonht113/vite-plugin@workspace:*'

# Vue + Vite
pnpm --filter my-web-app add -D '@sonht113/vue-plugin@workspace:*'

# Next.js
pnpm --filter my-web-app add -D '@sonht113/next-plugin@workspace:*'

# Nuxt
pnpm --filter my-web-app add -D '@sonht113/nuxt-module@workspace:*'
```

Giữ các dependencies framework của app tương thích với [bảng phiên bản](#3-chạy-playground-và-kiểm-tra-kết-nối), rồi chạy `pnpm build:packages` khi dùng workspace. Khi kiểm tra trước publication bằng archive, một `.tgz` integration vẫn cần đầy đủ các dependency nội bộ; xem [quy trình release](docs/releasing.md).

### React + Vite

Giữ plugin React của app và thêm DevAnalyst một lần:

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { devanalyst } from '@sonht113/vite-plugin';

export default defineConfig({
  plugins: [react(), devanalyst()],
});
```

Chạy lệnh Vite dev bình thường. Mapping dùng public React refs cho intrinsic JSX/TSX; native refs/spreads và một số opaque patterns không được map. Không có Fiber/selector/ancestor fallback. Chi tiết tại [React mapping ADR](docs/adr/0006-react-source-mapping.md).

### Vue 3 + Vite

```ts
// vite.config.ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { devanalystVue } from '@sonht113/vue-plugin';

export default defineConfig({
  plugins: [devanalystVue(), vue()],
});
```

Dùng **một** DevAnalyst Vite plugin: không đăng ký thêm `devanalyst()` cạnh `devanalystVue()`.

Mapping Vue sử dụng compiler SFC và public directive lifecycle, độc lập với React refs. Phạm vi hiện tại là native elements trong HTML template và inline `<script setup>` JS/TS. Options-API-only SFC, render-function/JSX, external blocks, template preprocessor và TSX setup chưa được map. Composition API được xác minh qua explicit imports; không tự suy đoán macro/auto-import symbols.

### Next.js — App Router

**Bước 1: bọc cấu hình Next.** Giữ các tùy chọn hiện có trong object truyền vào helper:

```ts
// next.config.ts
import type { NextConfig } from 'next';
import { withDevAnalyst } from '@sonht113/next-plugin';

const config: NextConfig = { reactStrictMode: true };
export default withDevAnalyst(config);
```

**Bước 2: thêm client bootstrap một lần vào root layout.** Root layout vẫn có thể là Server Component:

```tsx
// app/layout.tsx
import type { ReactNode } from 'react';
import { DevAnalystClient } from '@sonht113/next-plugin/client';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DevAnalystClient />
        {children}
      </body>
    </html>
  );
}
```

**Bước 3: tạo development wrapper.**

```js
// dev.mjs
import process from 'node:process';
import { startNextDevelopment } from '@sonht113/next-plugin';

const server = await startNextDevelopment({
  root: process.cwd(),
  port: Number(process.env.PORT ?? 3000),
  bundler: 'turbopack', // Đổi thành 'webpack' nếu dùng Webpack.
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void server.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
```

**Bước 4: cập nhật các scripts của app**, giữ nguyên những trường khác trong `package.json`:

```json
{
  "scripts": {
    "dev": "node dev.mjs",
    "build": "next build",
    "start": "next start --hostname 127.0.0.1 --port 3000"
  }
}
```

Chạy `pnpm dev` tại root app. Wrapper tự quản lý bridge và compiler IPC. Chạy `next dev` trực tiếp sẽ không kích hoạt instrumentation này. Với playground có sẵn trong repository, dùng `pnpm dev:next` từ root repository.

Chỉ `.tsx`/`.jsx` có explicit **`'use client'`** được map. Không thêm directive vào mọi file chỉ để loại bỏ UNKNOWN: điều đó có thể thay đổi server/client boundary của app. DOM từ Server Component vẫn UNKNOWN; server actions, `server-only` và Nitro/server execution không được suy ra từ phần tử browser.

Đã kiểm thử cả Webpack và Turbopack với Next 16.4.6. Pages Router, Edge runtime, Windows IPC, custom `basePath`/`assetPrefix`/`distDir`, standalone/static export và compiler pipelines khác chưa được xác minh. Turbopack rules `*.tsx`/`*.jsx` xung đột được giữ nguyên, kèm warning và mapping tắt. Xem [giới hạn Next](docs/frameworks.md#nextjs).

### Nuxt 4

Thêm module vào cấu hình hiện có:

```ts
// nuxt.config.ts
import { defineNuxtConfig } from 'nuxt/config';

export default defineNuxtConfig({
  modules: ['@sonht113/nuxt-module'],
});
```

Chạy `nuxt dev` qua dev script của app. Module tự gắn vào Nuxt/Vite/server lifecycle và thêm runtime phát triển cùng thông báo `page:finish` để pre-analysis theo trang đã commit. Không cần thêm bootstrap vào layout.

Phạm vi kiểm thử: Nuxt 4.6.4, Vite builder mặc định, local HTTP, default app directory và Nitro 2.13.6. Nitro 3, builder khác, layers, customized source directories, SSR-disabled/static output, runtime preset khác và non-default base URL chưa được xác minh. Server routes/plugins/composables không tự trở thành browser evidence. Xem [giới hạn Nuxt](docs/frameworks.md#nuxt-4).

## 6. Cấu hình devanalyst.config.ts

### Đặt file ở đâu?

Tạo `devanalyst.config.ts` tại **root ứng dụng** chứa `vite.config.ts`, `next.config.ts` hoặc `nuxt.config.ts` tương ứng. Ví dụ:

```text
apps/playground-react/
├── devanalyst.config.ts
├── vite.config.ts
└── src/
```

File config ở root repository không tự áp dụng cho các app con. Mỗi integration tìm file tại root app của mình. Nếu chưa có file, safe defaults được dùng; AI vẫn tắt.

Với React/Vite, có thể tạo file mặc định bằng lệnh sau từ root repository. Lệnh không ghi đè file đã tồn tại và không sửa Vite config:

```sh
node packages/cli/dist/bin.js setup apps/playground-react
```

Với Next/Nuxt, tạo file thủ công bằng helper của integration tương ứng; CLI `setup` hiện sinh import dành cho Vite.

### Ví dụ đầy đủ cho React playground

```ts
// apps/playground-react/devanalyst.config.ts
import { defineConfig } from '@sonht113/vite-plugin';

export default defineConfig({
  workspaceRoot: '.',
  source: {
    include: ['src/**'],
    exclude: ['src/generated/**', '**/*.test.*'],
  },
  routes: { exclude: ['/admin', '/admin/**'] },
  analysis: { depth: 'standard' },
  ai: { enabled: false, permittedPaths: [] },
  cache: {
    enabled: true,
    directory: '.cache/devanalyst',
    maxSizeMb: 256,
  },
  inspector: {
    enabled: true,
    language: 'vi',
    theme: 'system',
    shortcuts: {
      toggle: 'Alt+Shift+KeyI',
      pin: 'Alt+KeyP',
      copy: 'Alt+KeyC',
    },
  },
  editor: { enabled: true, command: 'code' },
  bridge: { host: '127.0.0.1', port: 0 },
  logLevel: 'info',
  environments: {
    development: { analysis: { depth: 'standard' } },
    testing: { cache: { enabled: false }, analysis: { depth: 'shallow' } },
  },
});
```

Khi dùng ví dụ cho framework khác, đổi helper import và source includes theo app:

| Target     | Import `defineConfig` từ | Include mặc định                                            |
| ---------- | ------------------------ | ----------------------------------------------------------- |
| React/Vite | `@sonht113/vite-plugin`  | `['src/**']`                                                |
| Vue/Vite   | `@sonht113/vue-plugin`   | `['src/**']`                                                |
| Next       | `@sonht113/next-plugin`  | `['app/**', 'src/**', 'pages/**']`                          |
| Nuxt       | `@sonht113/nuxt-module`  | `['app/**', 'components/**', 'pages/**', 'composables/**']` |

Đừng dùng nguyên `include: ['src/**']` cho app có source trong `app/`; các file ngoài allowlist sẽ không được map/đọc/mở editor. `.env`, Git internals, keys và các sensitive patterns bắt buộc vẫn bị loại trừ dù thay custom exclusions.

`defineConfig` của các integration hỗ trợ **file input và environments**. Helper cùng tên trong `@sonht113/core` là validator cho cấu hình đã resolve; không dùng nó cho file có `environments`.

### Environment và precedence

Thứ tự áp dụng:

```text
safe defaults → file base → environments[mode] → inline integration config
```

Objects merge theo section, arrays replace. Inline `bridge` options ưu tiên hơn `config.bridge`. Low-level analyzer limits tường minh ưu tiên hơn depth profile.

React/Vue dùng **Vite mode**. Ví dụ chạy playground React với environment `testing`:

```sh
pnpm --filter playground-react dev --mode testing
```

Next/Nuxt chọn environment `development`. Đây không phải cơ chế tự đọc `.env` để override DevAnalyst options. `NODE_ENV=production`/build không thể dùng environment override để bật runtime vào production.

Sau khi sửa file config hoặc module cấu hình được import, **restart dev server**, rồi reload browser. Config được load như trusted executable project code; application source analysis vẫn parse-only.

### Monorepo và shared components

Nếu app ở `apps/my-web-app` cần đọc `packages/ui` cùng repository, đặt config tại app root và giới hạn workspace như sau:

```ts
import { defineConfig } from '@sonht113/vite-plugin';

export default defineConfig({
  workspaceRoot: '../..',
  source: {
    include: ['apps/my-web-app/src/**', 'packages/ui/src/**'],
  },
});
```

Source/cache/editor paths lúc này tính từ common workspace root. Host bundler vẫn phải resolve và serve shared sources bình thường. Không thể dùng includes để vượt canonical containment hoặc bỏ qua sensitive exclusions.

### Depth, exclusions và debug

- `analysis.depth`: `shallow`, `standard`, `deep`; deterministic graph depth tương ứng 4, 12, 24, vẫn có các resource bounds khác.
- `ai.depth`: độ sâu context AI riêng, không tự bật AI.
- `source.exclude`: loại file khỏi mapping/source access/analysis/editor.
- `routes.exclude`: chặn dispatch source/AI/translation cho pathname hoặc hash-route phù hợp; local DOM inspection và mapping vẫn có thể hiện.
- `logLevel: 'debug'`: opt-in local structured event logging qua logger của integration. Không có disk log/telemetry mặc định và không ghi source, credentials, DOM values hay arbitrary errors.

Pre-analysis deterministic tự chạy sau khi bridge kết nối. `preanalysis.enabled`, `backgroundAI`, worker limits và resolver options là **integration options**, không phải keys của `devanalyst.config.ts`. Xem [configuration reference](docs/configuration.md) và [pre-analysis](docs/preanalysis.md).

## 7. Setup VS Code hoặc Cursor

1. Cài editor và dùng Command Palette của editor để cài shell command `code` hoặc `cursor` vào PATH.
2. Kiểm tra trong terminal dùng để chạy app:

```sh
command -v code
code --version
```

Với Cursor, thay bằng `command -v cursor` và `cursor --version`.

3. Chọn command trong config:

```ts
editor: { enabled: true, command: 'cursor' }
```

4. Restart dev server để nhận PATH/config mới. Alt+Click phần tử có mapping hiện tại, rồi nhấn nút mở source trong inspector.

Node xác minh workspace/file/revision/line/column trước khi gọi executable cố định bằng argument array. Dòng/cột là **one-based**. File nằm ngoài allowlist, source cũ hoặc editor thiếu PATH sẽ có thông báo recovery; không mở file bằng URL handler hoặc shell interpolation.

Bộ test dùng owned executable fixtures để xác minh file/dòng/cột và arguments. Interactive editor GUI và Windows launch chưa được xác minh trong validation hiện tại. Xem [editor safeguards](docs/configuration.md#vs-code-and-cursor).

## 8. Bật Claude Code khi cần

Mapping, source facts và inspector hoạt động khi AI tắt. Chỉ thực hiện phần này nếu muốn cho phép gửi source context tới Claude provider; tài khoản/model/quota và chi phí thuộc cấu hình Claude của bạn.

### Cài đặt và xác thực

Adapter hiện yêu cầu **native Claude Code 2.1.323** trên macOS/Linux. Phiên bản mới hơn không mặc nhiên tương thích với policy no-tools của adapter.

Cài native CLI và chọn đúng version theo [hướng dẫn cài phiên bản cụ thể của Anthropic](https://code.claude.com/docs/en/setup#install-a-specific-version). Kiểm tra:

```sh
claude --version
```

Mở `claude` và hoàn tất luồng xác thực chính thức trước khi dùng integration. DevAnalyst không tự đăng nhập hoặc chuyển tài khoản. Trạng thái auth/compatibility không chứng minh một inference thực sẽ thành công.

### Cho phép đúng source paths

Sửa phần `ai` trong config của app, ví dụ source của React/Vue nằm trong `src/`:

```ts
ai: {
  enabled: true,
  permittedPaths: ['src/**'],
  depth: 'standard',
  concurrency: 1,
  timeoutMs: 60000,
}
```

Các paths tính từ `workspaceRoot` và được giao với source policy. Với Next/Nuxt dùng `app/**` hoặc những thư mục thực sự cần thiết; không mở toàn bộ workspace nếu chỉ cần một vùng source.

Restart app. Với Vite, kiểm tra effective config và CLI bằng:

```sh
node packages/cli/dist/bin.js doctor apps/playground-react
```

`doctor` không khởi chạy inference. Khi bật AI, compatibility/auth failure khiến doctor báo không sẵn sàng. Với Next/Nuxt, dùng provider readiness API trong [Claude guide](docs/claude-code.md); project/plugin doctor hiện là Vite-specific.

### Khi nào AI chạy?

- Hover không khởi chạy inference mới.
- Explicit expanded inspection có thể gọi provider khi AI/path consent hợp lệ.
- Automatic background AI mặc định tắt và cần **thêm** `preanalysis.backgroundAI: true` ở integration options.

Ví dụ tùy chọn Vite, khi file config đã bật AI và giới hạn paths:

```ts
const inspector = devanalyst({
  preanalysis: { backgroundAI: true },
});
```

Provider giữ no-tools runtime enforcement, source/hash/range validation, secret filtering, bounded context/queue/time và cancellation. Original source/UI text không bị sửa. Không có live authenticated inference claim trong [validation hiện tại](docs/phase-11-validation.md); xem [Claude controls](docs/claude-code.md) trước khi bật transmission.

## 9. CLI, diagnostics và cache

Trong repository, chạy từ root bằng `node packages/cli/dist/bin.js`. Khi `@sonht113/cli` được cài/link đầy đủ vào consumer, binary tương ứng là `devanalyst`.

| Nhu cầu                                        | Ví dụ từ root repository                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Xem lệnh                                       | `node packages/cli/dist/bin.js --help`                                                      |
| Tạo config Vite nếu chưa có                    | `node packages/cli/dist/bin.js setup apps/playground-react`                                 |
| Kiểm tra React/Vite installation/config/Claude | `node packages/cli/dist/bin.js doctor apps/playground-react`                                |
| Khởi chạy Vite qua CLI                         | `node packages/cli/dist/bin.js dev apps/playground-react --port 5173 --strict-port`         |
| Xem live bridge                                | `node packages/cli/dist/bin.js status apps/playground-react --url http://127.0.0.1:5173/`   |
| Phân tích một source React                     | `node packages/cli/dist/bin.js analyze src/main.tsx apps/playground-react`                  |
| Mở source qua path/position guards             | `node packages/cli/dist/bin.js open src/main.tsx apps/playground-react --line 1 --column 1` |
| Xem cache                                      | `node packages/cli/dist/bin.js cache inspect apps/playground-react`                         |
| Clear cache                                    | `node packages/cli/dist/bin.js cache clear apps/playground-react`                           |

`dev`/project `doctor` dùng Vite config; không dùng chúng để khởi chạy/chẩn đoán plugin registration của Next/Nuxt. Shared `status --url` hoạt động trên cả bốn integrations. Truyền **URL gốc ứng dụng**, gồm base path nếu integration hỗ trợ; không truyền route `/orders/42`, query, token hay URL remote.

Offline CLI `analyze` hiện dùng React analyzer mặc định. Với Vue/Nuxt/Next, dùng public analyzer API với `framework: 'vue-vite' | 'nuxt' | 'next-react'`; xem [static analysis API](docs/static-analysis.md) và [framework guide](docs/frameworks.md).

### Cache và recovery

Mặc định SQLite nằm ở `.cache/devanalyst/analysis.sqlite` tính từ source workspace root. Cache tự được kiểm tra theo source/dependency hashes và framework/policy identity. Stale evidence không được hiển thị như current VERIFIED facts.

**Cache CLI là offline administration:** dừng dev server trước khi inspect/clear; sau clear, khởi động lại để reset cả memory cache. Không cần xóa database bằng tay. Corrupt/future/incompatible databases được giữ nguyên và có diagnostics/memory fallback; xem [persistent cache recovery](docs/persistent-cache.md).

Exit codes CLI: `0` thành công/help, `1` operational/readiness failure, `2` cấu hình/usage không hợp lệ hoặc command chưa hỗ trợ.

## 10. Kiểm thử trình duyệt và Playwright MCP

### Chạy test suite của repository

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:packages
```

Cài Chromium rồi chạy E2E:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

Các package cần được build trước khi chạy Playwright trực tiếp. Test tạo và dọn owned temporary app fixtures; không cần mở bốn playground thủ công cho E2E.

Muốn quan sát cửa sổ browser trong bộ framework:

```sh
pnpm build:packages
pnpm exec playwright test tests/e2e/frameworks.spec.ts --headed
```

Hoặc chỉ kiểm tra native production exclusion:

```sh
pnpm exec vitest run tests/active/integration/production-frameworks.test.ts
```

Root Playwright config dùng Chromium, một worker và không lưu network trace để tránh persist bootstrap credentials. Headed E2E tự đóng browser/fixtures khi test kết thúc; dùng MCP bên dưới nếu muốn tiếp tục thao tác sau demo.

Khi cần xác minh build từng package từ sạch:

```sh
pnpm test:independent
```

**Dừng dev servers/watchers trước bước này.** Lệnh chủ động xóa generated package outputs và không được chạy đồng thời với build, tests hoặc app đang dùng chúng.

### Playwright MCP để quan sát trực tiếp

MCP là browser controller tùy chọn; DevAnalyst không cần MCP để hoạt động. Phiên demo đã dùng `@playwright/mcp@0.0.85`. Thêm cấu hình sau vào MCP client hỗ trợ `mcpServers`; cần Google Chrome và `pnpm` trên PATH:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "pnpm",
      "args": [
        "dlx",
        "@playwright/mcp@0.0.85",
        "--browser",
        "chrome",
        "--isolated",
        "--viewport-size",
        "1440,1000"
      ]
    }
  }
}
```

MCP mặc định chạy browser có cửa sổ; không thêm `--headless` khi muốn quan sát. Tham khảo [hướng dẫn chính thức Playwright MCP](https://github.com/microsoft/playwright-mcp) cho cấu hình client cụ thể.

Nếu dùng Chromium đã cài cho E2E, lấy executable path từ root repository:

```sh
node --input-type=module -e "import { chromium } from '@playwright/test'; console.log(chromium.executablePath());"
```

Thay cặp `--browser`, `chrome` bằng `--executable-path`, đường dẫn vừa in. Không copy đường dẫn máy khác.

Khởi chạy playground riêng, kết nối lại MCP client, rồi yêu cầu agent dùng `browser_navigate` mở URL. Chạy server stdio một mình chưa mở trang. Có thể dùng prompt:

> Mở http://127.0.0.1:3000 bằng Playwright MCP có cửa sổ. Thử counter, Alt+Click 保存, kiểm tra source/API, mở Order 42 và giữ browser để tôi quan sát.

## 11. Build production

Từ root repository:

```sh
pnpm build
```

Lệnh build 11 thư viện và cả 4 playground. Hoặc build riêng app sau khi thư viện đã build:

```sh
pnpm --filter playground-react build
pnpm --filter playground-vue build
pnpm --filter playground-next build
pnpm --filter playground-nuxt build
```

Preview/start tùy app, từ terminal không chạy dev server trùng port:

```sh
pnpm --filter playground-react preview
pnpm --filter playground-vue preview
pnpm --filter playground-next start
pnpm --filter playground-nuxt start
```

Vite in URL preview trong terminal; Next start script dùng port 3000. Dừng app dev trước khi dùng port tương ứng cho production server.

Next production dùng native `next build`/`next start`; không dùng `dev.mjs`. DevAnalyst runtime injection, mapping hooks và local services dành cho development. Production tests kiểm tra các runtime/bridge/IPC/provider/cache markers và sự vắng mặt của development endpoints. Native build/trace/source-map artifacts của framework có phạm vi kiểm tra riêng trong [validation](docs/phase-11-validation.md).

## 12. Xử lý lỗi thường gặp

| Triệu chứng                                  | Kiểm tra và recovery                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lỗi engine hoặc pnpm version                 | Chạy `node --version`, `pnpm --version`; dùng `.nvmrc` và pnpm 10.33.0 trước khi install lại                                                     |
| Không resolve được package hoặc thiếu `dist` | Cài từ root workspace rồi `pnpm build:packages`; dùng public package exports, không import package khác qua `src/`                               |
| Port đã bị chiếm                             | Ctrl+C server do bạn quản lý hoặc chọn port khác trong host dev configuration; không tắt process không rõ nguồn gốc                              |
| Không thấy nút Inspect                       | Kiểm tra đang chạy development, integration đã đăng ký, `inspector.enabled` không tắt và config nằm đúng root app                                |
| Next mở được nhưng không có mapping          | Dùng wrapper + `withDevAnalyst` + root client bootstrap; chỉ explicit client JSX được map. Server DOM UNKNOWN là giới hạn có chủ đích            |
| Vue/Nuxt mapping UNKNOWN                     | Kiểm tra `<script setup>`/template envelope, source include/exclude, source revision và lỗi compile; Options API/macros/auto-imports có giới hạn |
| `INVALID_CONFIG`                             | Kiểm tra default export, helper đúng integration, field/type/bounds, shortcuts khác nhau và AI permittedPaths; restart server sau sửa            |
| File source hoặc shared package bị từ chối   | Xem `workspaceRoot` và paths tương đối; thêm đúng includes cần thiết, giữ canonical containment và mandatory exclusions                          |
| `state: ready`, `clients: 0`                 | Mở/reload đúng URL app, xem browser console và CSP; Node service ready chưa đồng nghĩa browser connected                                         |
| Bridge disconnected hoặc status 404          | Dùng URL gốc app, không dùng route hiện tại; kiểm tra server/config và `connect-src` cho loopback WebSocket                                      |
| App có CSP chặt                              | Cho phép same-origin runtime/bootstrap và đúng `ws://127.0.0.1:<bridge-port>`; có thể chọn fixed free bridge port để cấu hình CSP cụ thể         |
| Editor không mở                              | Kiểm tra shell command trên PATH của dev server, editor config, file/line/column và source hiện tại; restart sau sửa PATH                        |
| `AI is disabled` hoặc chưa có bản dịch       | Static inspection vẫn dùng được; glossary không bao phủ mọi nhãn. Chỉ bật Claude nếu đồng ý transmission và đã setup CLI                         |
| Claude incompatible/auth unavailable         | Kiểm tra native version 2.1.323 và authentication/model entitlement. Không bỏ no-tools flags để ép một CLI khác version chạy                     |
| Evidence cũ hoặc cache lỗi                   | Reload sau source/HMR/config restart; dừng app rồi dùng cache CLI/recovery guide, không xóa database tùy tiện                                    |
| Node 22 báo SQLite experimental              | Đây là warning của Node cho SQLite API; đọc thêm diagnostics nếu có lỗi thực, không coi warning đơn lẻ là bridge failure                         |
| MCP không mở browser                         | Kiểm tra MCP client đã kết nối và gọi navigate, có graphical display, browser/executable path đúng và không bật headless                         |
| Next demo báo `/favicon.ico` 404             | Playground chưa có favicon; thông báo resource này tách biệt với mapping/bridge, có thể thêm favicon ở host app khi cần                          |

File config là trusted executable code như Vite/Next/Nuxt config. Chỉ chạy config/CLI trong checkout bạn tin cậy. DevAnalyst source analysis parse-only, không cung cấp browser file-read/shell RPC; AI cần consent và đường dẫn cho phép riêng.

## 13. Cấu trúc và tài liệu

```text
apps/
├── playground-react/
├── playground-vue/
├── playground-next/
└── playground-nuxt/
packages/
├── core/            # Browser-safe contracts/config/evidence
├── inspector/       # Shared browser UI/runtime và mapping registry
├── analyzer/        # JSX/SFC mapping, guarded source/AST workers
├── ai/              # Claude Code no-tools provider
├── cache/           # SQLite worker và invalidation
├── server/          # Shared bridge/config/editor/queue composition
├── vite-plugin/     # React/Vite host integration
├── vue-plugin/      # Vue/Vite strategy
├── next-plugin/     # Next public dev server/loaders/client bootstrap
├── nuxt-module/     # Nuxt public module/lifecycle hooks
└── cli/             # Operational commands
```

| Tài liệu                                               | Nội dung                                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [Framework integrations](docs/frameworks.md)           | Setup theo framework, versions và unsupported configurations                                  |
| [Configuration reference](docs/configuration.md)       | Toàn bộ options, precedence, CLI và editor guards                                             |
| [Commerce playgrounds](docs/playgrounds.md)            | Workflow, demo API, hover tương tác và giới hạn                                               |
| [Inspector UI](docs/inspector-ui.md)                   | Translation, evidence, copy, confidence, themes và consent                                    |
| [Static analysis](docs/static-analysis.md)             | Node analyzer API, evidence và resource limits                                                |
| [Claude Code](docs/claude-code.md)                     | Provider API, compatibility, transmission và readiness                                        |
| [Pre-analysis](docs/preanalysis.md)                    | Scheduling, route cancellation, priorities và background AI                                   |
| [Persistent cache](docs/persistent-cache.md)           | SQLite layers, invalidation, administration và recovery                                       |
| [Testing](docs/testing.md)                             | Active gates, fixture policy và giới hạn verification                                         |
| [Phase 11 validation](docs/phase-11-validation.md)     | 355 unit/integration tests, full 49 E2E và final 7 framework cases đã qua ở thời điểm báo cáo |
| [Phase 10 validation](docs/phase-10-validation.md)     | Typed config, CLI, editor và developer experience                                             |
| [Architecture](docs/architecture.md)                   | Package/runtime boundaries và source evidence model                                           |
| [ADRs](docs/adr/)                                      | Quyết định kiến trúc, gồm [framework adapters](docs/adr/0013-framework-adapters.md)           |
| [Repository structure](docs/repository-structure.md)   | Active workspace và retained historical artifacts                                             |
| [Progress](docs/progress.md)                           | Trạng thái tính năng và remaining gates                                                       |
| [Implementation plan](docs/implementation-plan.md)     | Đủ 18 capability requirements và Definition of Done                                           |
| [Project constitution](docs/project-constitution.md)   | Identity, engineering, privacy và phase discipline                                            |
| [Conversation overview](docs/chat-session-overview.md) | Bàn giao các phase và quyết định đã chấp nhận                                                 |

Các kết quả validation là lịch sử thực chạy, không phải khẳng định test đã được chạy lại mỗi lần sửa README. Conversational follow-ups, live authenticated model quality và whole-project performance/accessibility hardening vẫn còn pending. Owner đã chọn MIT và scope `@sonht113/*` cho beta; việc phát hành beta không đồng nghĩa hoàn tất toàn bộ sản phẩm. Angular, Svelte và framework khác cần owner authorization riêng.
