# DevAnalyst beta releases

The owner authorized a first public beta under the MIT license. The candidate version is `0.1.0-beta.1` for the eleven active packages, using the `beta` distribution tag and public npm access. Root and playground manifests stay private. Registry publication must be reported only after each package/version and tag is verified remotely; preparation and successful archive checks are not proof of publication.

The owner selected the personal npm scope `@sonht113/*` after the `devanalyst` organization check returned `Scope not found`. The authenticated npm account is `sonht113`, establishing ownership of this personal scope. Imports, manifests, workspace filters and current setup documentation use the chosen scope. The product remains DevAnalyst, with the `devanalyst` binary and `devanalyst.config.ts`. See [ADR 0017](adr/0017-mit-beta-publication.md).

Pre-publication validation on Node 22.23.2 / pnpm 10.33.0 passed: eleven independent builds, `pnpm check` (361 unit/integration tests, lint/typecheck, four app builds and archive/CLI checks), and 60 Chromium E2E tests. An isolated consumer installed all eleven candidate archives with strict peers, imported their public entries, rejected a private subpath, served instrumented React and browser runtimes without Vite errors, and built production without inspector markers. Its installed CLI printed `0.1.0-beta.1`. Local archive overrides were used only in that temporary consumer, not published manifests. Registry publication/installation remain separate checks below.

## Release contents

Publish `core`, `inspector`, `analyzer`, `ai`, `cache`, `server`, `vite-plugin`, `vue-plugin`, `next-plugin`, `nuxt-module` and `cli` together. Internal dependencies remain `workspace:*` in source; pnpm converts them to exact release versions in archives. Each package includes its README, MIT license, public JavaScript/declarations/maps and the source files needed by those maps. Package metadata links to the repository, package directory and issue tracker.

This is a compatibility-limited beta. Conversational follow-ups, live authenticated Claude quality, wider performance/accessibility validation and full product/release acceptance remain pending. Do not advertise general framework/OS support beyond [the tested framework guide](frameworks.md). Claude remains opt-in and requires the documented compatible native CLI. Existing privacy controls and development-only production exclusion remain required.

## Validation and publication

Use Node.js `^22.22.3 || ^24.15.0` and pnpm `10.33.0`. Run these checks sequentially; the independence checker deletes generated package outputs:

```sh
pnpm install --frozen-lockfile
pnpm test:independent
pnpm check
pnpm test:e2e
```

`test:packages` packs every package, verifies README/license/export targets, rejects test/build-state/local configuration/cache artifacts and checks that workspace dependencies were rewritten. Verify installation from the candidate archives in a separate consumer outside this workspace before publication. CLI `--version` reads installed package metadata, including prerelease suffixes.

Only the eleven approved package manifests are publishable (`private: false`). Root and playground manifests remain private. Commit the reviewed release source and metadata. From a clean `master` branch, first inspect the dry run, then publish:

```sh
pnpm --filter '@sonht113/*' -r publish --access public --tag beta --dry-run
pnpm --filter '@sonht113/*' -r publish --access public --tag beta
```

Follow npm's interactive authentication/2FA flow when required; never store tokens or one-time codes in source or release logs. If a publication partially succeeds, inspect registry versions and retry only missing package versions. Do not overwrite published versions or move `latest` for a beta. Verify every `beta` tag and install an integration from the public registry in a separate consumer before reporting success.

Future releases increment the version. A stable release needs a separate decision and must replace the package `publishConfig.tag` deliberately. This manual beta release does not authorize automated publication from arbitrary branches or changes to unrelated product features.
