# Reusable application onboarding

Onboarding composes the base library's native flow. An app supplies registered
discovery, connection and verification adapters plus its existing deployment
strategy. Lens displays that same workflow; it does not implement another
deployment controller.

The visible stages are **Discover system → Configure connection → Verify
connections → Review changes → Deploy and test**. Setup verification happens
before deployment. The deployment strategy must additionally run the app's
required health, login, allowed/denied access and dependency checks before it
returns a promoted result. An unavailable check is not a pass.
When the preset supplies `projectDeployment`, Lens displays its admitted
`deployment.checks` as **App checks**, preserving each native check ID and
outcome. Pre-deployment connection checks remain **Setup checks**. The panel
does not infer successful login or denied access from a healthy process.

## Operator composition

Use the base library's public `footprintjs-iac/onboarding` and
`footprintjs-iac/onboarding/node` exports to construct one `OnboardingWorkflow`
for a registered target. Keep its private directory stable. CLI and Lens should
receive the same registered deployment controller and its existing state
directory; a dashboard directory is not a new deployment target.

An operator-owned module exports:

```js
export function createOnboardingHost() {
  return {
    version: 1,
    workflow, // the base OnboardingWorkflow, including snapshot/dispatch/subscribe/recording
    publication: readRetainedApplicationEvidence,
    subscribePublication: subscribeToNativeDeploymentProgress,
  };
}
```

`publication` and `subscribePublication` are optional. They use the existing
`ApplicationPublication` protocol for the resource graph, deployment flow,
running system, native deployment recording, measured connections and access
checks. They must describe the same registered target. The first reads retained
evidence only; the second forwards actual native progress. Neither may retry a
deployment or manufacture progress.

Start the regular Lens CLI:

```sh
footprintjs-iac-lens --onboarding-host /absolute/path/to/site.mjs \
  --directory /absolute/path/to/private/lens-state --port 15231
```

The SDK equivalent is `startDashboard({ onboarding: host, directory,
staticDirectory, port })`. A dashboard accepts one deployment owner. Do not also
pass `applicationHost`, a simulator, release pipeline or another mutation owner.
The existing `--host` application setup remains supported.

Browser actions select only a named stage or the exact current review. Target
identity, adapter code, connection profiles, commands and secret values remain
in trusted server code. Changing the preset configuration requires a deliberate
new native configuration, not editing the browser request or deleting history.
Interrupted deployment effects require the registered native reconciliation
port. Refresh only reads retained status.

## Lazy interface and evidence

The optional panel loads only when the dashboard has an onboarding host. The
resource and running-system views remain available through native publications.
Simple mode uses short stage names and statuses. Details retains complete
target, review and native run identifiers. The recording button opens the exact
admitted onboarding execution, independently of the deployment recording.
The existing diagnostic history retains failed and recovered onboarding runs
separately and can backwalk the recorded outcome. It explicitly marks external
adapter internals as an evidence boundary unless their own native records are
also supplied.

Framework consumers can lazy-load `footprintjs-iac-lens/react/onboarding` and
its `style.css` export. The protocol and server remain framework independent.

## Source map for an agent making a change

| Change | Owning source | Verification |
| --- | --- | --- |
| Public action/readiness policy | Base library `src/onboarding/` public exports | Base onboarding tests |
| Safe Lens snapshot/client | [`src/core/onboarding.ts`](../src/core/onboarding.ts), [`src/core/client.ts`](../src/core/client.ts) | [`test/onboarding.test.ts`](../test/onboarding.test.ts) |
| Native workflow transport | [`src/server/onboarding.ts`](../src/server/onboarding.ts), [`src/server/onboarding-host.ts`](../src/server/onboarding-host.ts) | HTTP and recovery cases in the same test |
| Loopback request admission | [`src/server/onboarding-request.ts`](../src/server/onboarding-request.ts) | Origin, content type, size and executable-input refusal cases |
| Optional UI | [`web/features/onboarding/`](../web/features/onboarding/) | [`test/onboarding-ui.test.ts`](../test/onboarding-ui.test.ts) |

Read the owning source and relevant test when changing behavior; this map is
navigation, not a claim that static structure proves runtime effects. The
[flow-development benchmark](https://github.com/footprintjs/flow-development-benchmarks)
motivates truthful source-linked context and explicit unknowns. Its research
sources/data are not runtime dependencies and no benchmark/model run is part of
these checks. Run `npm run check`, `npm test` and `npm run build` directly; CI
remains off.
