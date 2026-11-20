# @sonht113/ai

Opt-in Node.js Claude Code CLI provider with bounded evidence context, cancellation and enforced no-tools execution.

Beta release `0.1.0-beta.1`; APIs and the verified compatibility envelope may change. Requires ESM and Node.js `^22.22.3 || ^24.15.0`.

Install a compatible native Claude Code **2.1.323** executable on macOS/Linux and authenticate it separately. The provider starts its own bounded CLI subprocess and does not attach to an existing conversation.

AI is disabled by default. Explicit `ai.enabled` and nonempty `ai.permittedPaths` are required before inference. Permitted source evidence may be transmitted to the provider. Hover does not start inference; automatic background AI needs separate consent. CLI authentication alone does not prove model entitlement, available quota or successful live inference. Live authenticated model quality has not been verified for this beta.

Use the integration packages for browser inspection, or follow the Node provider examples in the Claude guide. The adapter does not expose arbitrary repository-reading, editing or shell tools.

DevAnalyst is development-only. AI is opt-in, source access is bounded by explicit policy, and source-backed findings distinguish VERIFIED, INFERRED and UNKNOWN. Static code references do not prove runtime execution.

Documentation: [setup](https://github.com/sonht113/dev-analyst#readme), [framework support](https://github.com/sonht113/dev-analyst/blob/master/docs/frameworks.md), [configuration](https://github.com/sonht113/dev-analyst/blob/master/docs/configuration.md), [Claude provider](https://github.com/sonht113/dev-analyst/blob/master/docs/claude-code.md).

License: MIT.
