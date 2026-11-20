# ADR 0017 — MIT beta and personal npm scope

Status: accepted by explicit owner request and follow-up choices.

The owner authorized publication of a first beta, selected the MIT license, and chose `@sonht113/*` after the authenticated account `sonht113` received `Scope not found` for the proposed `devanalyst` organization. This supersedes the historical package-scope decision only. DevAnalyst remains the product name, `devanalyst` the CLI, and `devanalyst.config.ts` the configuration file. The eleven active directories and four supported integration targets remain unchanged.

Prepare all eleven packages at `0.1.0-beta.1` with public access and the `beta` tag. Keep root and playgrounds private. Use public cross-package imports under the chosen scope and retain `workspace:*` source dependencies; pnpm rewrites those dependencies for registry consumers. Include package READMEs, the MIT license, public exports/declarations/maps and corresponding source. Verify independent builds, normal checks, browser journeys, archive contents and an isolated archive consumer before publication. Verify registry versions/tags and a registry consumer after publishing.

This beta does not establish full product completion or live authenticated Claude quality. Existing development-only, privacy, AI consent and compatibility limits remain. No Angular/Svelte integrations, stable/latest release, paid npm organization or automated release pipeline are authorized by this decision. See [release procedure](../releasing.md).
