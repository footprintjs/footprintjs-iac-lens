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
in trusted server code. Changing a registered setup uses the versioned review
and activation flow below; the browser cannot rewrite a preset definition.
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

## Versioned setup updates

An optional base `OnboardingVersionRegistry` keeps a stable physical owner and
native deployment controller while each registered setup has its own immutable
workflow and application owner. The same `--onboarding-host` module can return:

```js
export function createOnboardingHost() {
  return {
    version: 1,
    workflow: registry.activeWorkflow,
    registry,
    registryPublication: {
      snapshot: readRetainedEvidenceForCapturedHead,
      subscribe: subscribeToHeadScopedNativeProgress,
    },
  };
}
```

Construct the registry through `footprintjs-iac/onboarding/versions/node`.
Types and bounded public readers are in `footprintjs-iac/onboarding/versions`.
Register version IDs and their release, checks, connection-policy and
configuration digests in trusted code. The registry supplies private session
paths and the `withActiveVersion` fence to each composition. All versions keep
the same registered physical target and native controller ledger. Explicit
legacy enrollment admits known existing history; an unknown directory is not
automatically adopted as a fresh deployment.

The lazy **Change setup** drawer follows:

**Choose registered version → Review diff and retained ownership → Activate
the exact sealed review → Check setup → Review and deploy resource changes.**

The configuration diff describes release, readiness checks, connection settings
or policy, and setup definition digests. It does not claim to predict individual
resource updates, replacement or migration. Those decisions remain in the
existing native deployment plan after activation. In Simple mode the drawer
shows these change categories and blockers; **Show technical diff** retains the
complete before/after digests, head, review ID and native run ID.

An active-version or equivalent-configuration no-op records the inspection
without changing the head or borrowing a new ready state. A real configuration
change starts the newly admitted workflow grey, clears the current app link,
resource/connection observations and readiness, and requires fresh checks and
a deployment review. Retired version IDs remain historical; rollback uses a
new registered revision expressing the earlier desired setup, which follows
the same fresh verification and native resource-diff process.

Unknown or pending original host, workflow or native controller outcomes block
activation even when a newer resource run succeeded. If both the active owner
and the configuration update are incomplete, inspect the original active owner
first, then inspect the retained registry intent. These are separate, exact
observation-only reconciliation controls; neither retries deployment.

`registryPublication` returns or emits `{ head, versionId, publication? }`.
Capture those IDs with the originating private session and detach its live
publisher when the active head changes. Lens ignores retired-head callbacks
and admits current publications only against the current registry head. In
versioned mode this scoped port takes precedence over the legacy unscoped
`publication` and `subscribePublication` fields. Snapshot reads perform no
discovery, reconnect, provider mutation or application probe.

The framework-neutral client exposes `onboardingVersion(action)` over the
loopback, same-origin `POST /api/onboarding/versions` endpoint:

```ts
{ action: 'review-version', versionId }
{ action: 'activate-version', reviewId }
{ action: 'reconcile-activation', reviewId }
{ action: 'refresh' }
```

The ordinary `/api/onboarding` actions remain unchanged. `/api/state` adds
`onboardingRegistry` and `onboardingRegistryRecording`; `onboarding` and
`onboardingRecording` continue to describe the current admitted workflow.
Accepted HTTP requests return before a potentially long native operation;
subscribe to state updates for its measured outcome.

Version history preserves registered IDs, release/configuration digests,
per-head workflow snapshots and native references. The bounded diagnostic
window stays attached to the stable owner across version changes, and each
new report carries its admitted version, head and release digest. Exact
legacy viewer bindings may be associated with a retained registered version;
the original JSON is first archived as
`recorded-diagnostics-legacy-<binding>.json`, and this association is explicitly
labelled as inferred from the matching viewer binding. Native captures are
unchanged. The viewer still reports omitted older runs; their native recordings
remain in the owner storage.

## Source map for an agent making a change

| Change | Owning source | Verification |
| --- | --- | --- |
| Public action/readiness policy | Base library `src/onboarding/` public exports | Base onboarding tests |
| Safe Lens snapshot/client | [`src/core/onboarding.ts`](../src/core/onboarding.ts), [`src/core/client.ts`](../src/core/client.ts) | [`test/onboarding.test.ts`](../test/onboarding.test.ts) |
| Native workflow transport | [`src/server/onboarding.ts`](../src/server/onboarding.ts), [`src/server/onboarding-host.ts`](../src/server/onboarding-host.ts) | HTTP and recovery cases in the same test |
| Loopback request admission | [`src/server/onboarding-request.ts`](../src/server/onboarding-request.ts) | Origin, content type, size and executable-input refusal cases |
| Optional UI | [`web/features/onboarding/`](../web/features/onboarding/) | [`test/onboarding-ui.test.ts`](../test/onboarding-ui.test.ts) |
| Version ownership, review, activation | Base library `src/onboarding-versions/` public exports | Base version-registry tests |
| Scoped version transport and native publication | [`src/server/onboarding-version-admission.ts`](../src/server/onboarding-version-admission.ts), [`src/server/onboarding-publication.ts`](../src/server/onboarding-publication.ts) | [`test/onboarding-versions.test.ts`](../test/onboarding-versions.test.ts) |
| Stable history and explicit legacy association | [`src/server/onboarding-history.ts`](../src/server/onboarding-history.ts) | Exact-adoption and quarantine cases in the same test |
| Lazy review/diff/history drawer | [`web/features/onboarding/versions/`](../web/features/onboarding/versions/) | [`test/onboarding-version-ui.test.ts`](../test/onboarding-version-ui.test.ts) |

Read the owning source and relevant test when changing behavior; this map is
navigation, not a claim that static structure proves runtime effects. The
[flow-development benchmark](https://github.com/footprintjs/flow-development-benchmarks)
motivates truthful source-linked context and explicit unknowns. Its research
sources/data are not runtime dependencies and no benchmark/model run is part of
these checks. Run `npm run check`, `npm test` and `npm run build` directly; CI
remains off.
