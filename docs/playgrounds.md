# Commerce playgrounds and hover inspection

Run an existing command from the repository root: `pnpm dev:react`, `pnpm dev:vue`, `pnpm dev:next` or `pnpm dev:nuxt`. Ports remain 5173, 5174, 3000 and 3001. No extra dependencies or database setup is required. See [README setup](../README.md).

All four playground applications display Japanese UI (`lang="ja"`), including navigation, order/status labels, forms, sample customer/product data, loading/error messages and detail routes. Text remains literal in JSX/Vue where possible so Japanese-to-Vietnamese inspection can match original source evidence. The inspector's own display language remains independently configurable; choose **Tiếng Việt** for Vietnamese analysis. Private fixture sentinel values and application/API identifiers remain stable.

## A realistic source-analysis journey

Each dashboard starts with 36 synthetic orders and derived KPI/pipeline counts. The same-origin API keeps data only in the server process; restarting the server or using **デモをリセット** resets the dataset. Vite provides the demo API in development and local preview. Next/Nuxt use their native application API routes. This is demo infrastructure, not a production commerce/authentication backend.

1. Search by order/customer/product, select a status, sort by amount and move between six-row pages. Empty results offer a filter reset.
2. Choose **閲覧者 · 閲覧のみ** (viewer) to see disabled approval/edit controls, then return to **承認担当者 · 承認可能** (reviewer). This is a UI role simulation, not server authorization.
3. Open **詳細 ↗** on a pending order, change quantity/priority/note and save with **変更を保存**. Validation, loading/error states and source-backed conditions are inspectable. Completed/non-pending orders remain read-only.
4. Select pending orders and choose **選択した注文を承認**. The API updates statuses; the table, KPIs, pipeline and activity list reflect the response. Mixed/non-pending selections disable the action; the API also rejects invalid state transitions.
5. Enable **APIエラーを再現** and synchronize with **データを同期**. A real 503 response produces an error banner; **再試行** clears simulation and requests data again.
6. Export the current filtered view to CSV, or resize to a mobile viewport. Notes/form values are not part of CSV exports.

The smaller **Inspector Lab** preserves counter/保存 controls for HMR, source and API-chain comparisons. Vue retains keyed A/B reorder and an async component. Next/Nuxt retain `/orders/42` examples; Next's server-rendered heading remains UNKNOWN while its explicit client button can be mapped. The lab is only one part of the dashboard.

All names, amounts and notes are synthetic. Input values remain subject to inspector privacy exclusions; sending a form to the application's own demo API is separate from DevAnalyst metadata/provider transmission. AI stays disabled unless explicitly configured.

## Reading and using a hover panel

Hover a source element, then move into the displayed panel. A short target dwell and the gap between element/panel preserve the selection during this movement. Once inside, controls become available and the current selection stays still while you scroll, select/copy text, choose display preferences or focus panel controls. The host page does not scroll with the panel's wheel actions.

Hover transfer does not pin the selection or invoke Claude. Click **Pin/Ghim** to retain it while moving elsewhere. Click **Expand analysis** or Alt+Click a source element for an explicit detailed inspection, using the existing configured AI consent. **Escape** or **Close** dismisses the panel; Escape from panel focus returns focus to the prior host control when available. Mouse **Unpin** restores follow-hover behavior.

Preview height is constrained to available viewport space, so new analysis cards scroll inside the panel rather than covering its trigger. Initial previews remain click-through and outside normal tab order. Native controls nested in a large hovered container keep their normal actions. For immediate target selection on dense/overlapping content, Alt+Click or explicit Inspect mode remains available.

The same behavior is shared by all framework integrations. Cross-origin/closed-root and unusual transformed-frame/top-layer limitations still apply; see [inspector guide](inspector-ui.md). Source mutation/unmount/invalidation can close or demote a held preview; holding a panel does not make stale evidence current.

## Development and regression checks

```sh
pnpm build:packages
pnpm exec playwright test tests/e2e/inspector.spec.ts --headed
pnpm exec playwright test tests/e2e/frameworks.spec.ts --headed
```

Tests use owned temporary fixtures and real framework/API servers; they close their browsers afterwards. To keep a browser available for manual exploration, use the [Playwright MCP instructions](../README.md#10-kiểm-thử-trình-duyệt-và-playwright-mcp). Library runtime changes require restarting the app server and reloading the browser; host source/CSS edits use ordinary HMR.

Japanese UI follow-up validation (2026-11-19): `pnpm lint`, `pnpm typecheck`, `pnpm test` (359 tests), `pnpm build` and `pnpm test:e2e tests/e2e/frameworks.spec.ts` (12 journeys) passed. Browser checks cover Japanese accessible names/document language/CSV headers, native navigation, HMR, order editing/approval, API failure/retry and mobile overflow across all four apps and both Next bundlers. React and Nuxt dashboard screenshots were visually inspected. These checks do not claim live authenticated AI translation.
