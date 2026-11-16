# InfraChart Lens

This is the separate viewer and local server for `footprintjs-iac`. Consume the core library through its public exports; keep resource reconciliation, compilation and native recording in that library. Keep React and viewer dependencies here.

For onboarding, read [the owning module and transport guide](docs/onboarding.md)
and the base library's [source-linked context](https://github.com/footprintjs/footprintjs-iac/blob/main/docs/agent-onboarding.md).
State the planned change and missing context briefly; inspect source freely.
Declared diagrams and source hashes are navigation and freshness evidence only.
Native captures establish observed actions, and opaque provider callbacks remain
explicit boundaries. Benchmark studies are separate from runtime dependencies.

For expanded adapter deployment steps, read [the evidence and UI guide](docs/adapter-deployment-steps.md). The core projector owns scoped stage/decision admission; the optional adapter renderer groups those native nodes without creating operations. Absence from a recording never proves a step was skipped.

Use small cohesive helpers, stages and modules. Each flowchart construction belongs in one dedicated creation file. Run typecheck, meaningful tests and build directly locally before committing. Automatic CI is off; do not trigger it.

Resource status comes from the native deployment recorder. Grey means pending in this run, deploying means reconciliation started, and ready requires provider confirmation. Simulation must be clearly labelled. Do not use display timers to manufacture deployment progress. Keep incomplete capture, failed observations and external uncertainty visible.

Bind the server to loopback. Keep mutation inputs narrow, validate origin/host/content type, and do not expose arbitrary commands, paths or infrastructure targets. Preserve the existing Neo review server. Browser automation uses CUA only; unavailable browser access is not permission to use another browser automation mechanism.
