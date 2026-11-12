# FootPrint IaC Lens

A separate live system view for [footprint-iac](https://github.com/footprintjs/footprint-iac). Resource nodes start grey for pending work, become blue while reconciling, and become green only after the configured provider confirms readiness. Failures and skipped work remain visible. The execution view lazily loads [Flow Lens](https://github.com/footprintjs/explainable-ui) over the actual native FootPrint recording.

Most logic is framework-neutral TypeScript. The root and `/core` exports contain the protocol, state projection, dependency layout and injectable transport client. `/react` is the optional React adapter. `/server` is the separate Node loopback server. React, React DOM, XYFlow and Flow Lens are optional peers; importing the headless API does not load them. Angular, Svelte and Vue adapters can consume the same headless contract; those adapters are not implemented yet.

## Run directly

Use Node.js 24 or newer. These private repositories need GitHub read access and must be sibling checkouts for the current local package dependency:

```sh
git clone https://github.com/footprintjs/footprint-iac.git
git clone https://github.com/footprintjs/footprint-iac-lens.git
cd footprint-iac
npm ci
npm run check
npm test
npm run build
cd ../footprint-iac-lens
npm ci
npm run check
npm test
npm run build
npm start
```

Open the printed URL. The preferred port is `15231`; an occupied port falls back to an available loopback port. Server details are in `.artifacts/server.json`. Automatic CI is off. These commands run locally and do not publish packages.

Lens opens in **Simple**: a build scene with large resource pictures, short labels and **Build system**. Grey resources wait, blue resources animate only while recorded work is running, and green resources have a recorded ready outcome. Steps follow the captured deployment flow; work that runs together can animate together. Switch to **Details** for the deployment pipeline, running system, resource panels and full FootPrint evidence.

After a successful run, **Check setup** reapplies the same setup. A recorded no-op or verification keeps the resource picture solid with a checking scan instead of showing it being built again. Communication links show **Not checked → Checking → Connected / Failed** from real connection checks. Sign-in and access checks have their own result. These observations stay separate from resource readiness; animation cannot turn an unchecked or failed result green. Reduced-motion preferences stop the repeating animation while keeping every status visible.

The built-in server starts with an explicitly labelled **Simulation** fixture. In **Details**, choose a successful simulation, an injected failure, or reapply a successful run to check no-op behavior. The simulator deliberately delays its readiness promise so progress is visible; the UI never manufactures deployment outcomes using animation timers. Requests run serially. A failure leaves earlier successful resources managed so the next successful simulation can reconcile them.

## Show the actual Neo fixture

First prepare Neo from the core checkout using its [setup instructions](https://github.com/footprintjs/footprint-iac/blob/main/docs/SHARING.md). Then run Lens with:

```sh
npm start -- --neo
```

Select **Neo · local Kubernetes** and **Deploy Neo locally**. Lens reads the successful review metadata from the sibling core checkout, reuses that target's durable inventory, and reconciles through `InfraEngine`. Only the isolated `kind-footprint-iac-test` or `kind-footprint-iac-review` context is accepted, with a workspace-owned kubeconfig and loopback API endpoint. It does not replace Neo's native development workflow.

This fixture uses the app's scripted model and seeded SQLite data. Its container-local data is ephemeral. Ready means the adapter confirmed the resource's readiness contract in this run; it does not establish production durability, live collector/model behavior or cross-replica conversation continuity.

For a first deployment instead of a reapply, prepare a new cluster from the sibling core checkout, then start a separate Lens server:

```sh
cd ../footprint-iac
npm run neo:prepare-fresh
cd ../footprint-iac-lens
npm start -- --fresh-neo
```

Preparation creates a uniquely named local recording cluster, loads the real Neo images and leaves the app absent. The dashboard starts with Neo's three resources grey; click **Deploy Neo locally** to perform their first creation. Its default port is `15232`, with separate viewer data under `.artifacts/fresh/<context>/`; `.artifacts/fresh/server.json` points to the latest fresh dashboard and its directory. The existing review cluster, dashboard and app server stay available. Fresh startup checks the cluster's actual published API port and refuses an existing namespace or nonempty inventory. An exclusive local claim prevents two dashboards from starting the same fresh take; admission requires every resource to be absent and planned for creation. Use **Reapply / check no-op** afterward, or prepare another target to record another first creation. Keep the same Lens process running for the reapply; restarting fresh mode after creation is intentionally refused.

After a successful fresh Neo deployment, Lens opens two random loopback ports for the Node/UI and Python health endpoints. Once both health checks pass, it shows the actual local app URL and **Open Neo**. The app-access result is separate from the Kubernetes deployment result: a failed local tunnel is shown without changing resource readiness. Its private `neo-forward.json` records the selected ports and owned process; the listener remains available after the dashboard exits, until that process or its selected pod stops. The checks establish access at that time, rather than continuous traffic monitoring. The real fixture still uses the scripted model and seeded data described above.

## Reuse the headless API

```ts
import { createDashboardClient, layoutResources, projectBuildScene, statusCounts } from 'footprint-iac-lens/core';

const client = createDashboardClient({ fetch: yourFetch, openStream: yourStream });
// Feed its state into your framework's rendering mechanism.
// layoutResources(state) returns plain node/edge descriptors.
// projectBuildScene(state) returns the Simple scene: resource pictures,
// captured flow, active steps, measured connection states and missing-evidence warnings.
```

The transport is injected so the core needs neither React nor a browser DOM. `projectBuildScene` is a pure projection of the same recorded state, with no timers, deployment scheduler or provider calls. The server sends versioned snapshots over `/api/state` and `/api/events`; monotonically increasing revisions prevent an older initial fetch from overwriting a newer stream update. Resource events retain their full IDs, run IDs and native runtime-stage attribution.

`npm run build:core` compiles only the framework-neutral TypeScript. `npm run build:server` adds the Node server, with no React/UI source in either build. The full `npm run build` also creates the optional React adapter and the standalone web app.

For React, install the optional peers and load the separate surface:

```tsx
import { lazy, Suspense } from 'react';
import 'footprint-iac-lens/react/style.css';

const IacLens = lazy(() => import('footprint-iac-lens/react')
  .then(module => ({ default: module.IacLens })));

<Suspense fallback="Opening infrastructure…"><IacLens /></Suspense>;
```

Use the same origin or a deliberately configured reverse proxy for the embedded UI. The included server refuses cross-origin mutations and binds only to loopback. The `/react` styles do not reset the host document's body. The built-in app loads the evidence surface lazily as well.

The default `fitWindow` layout keeps the selected graph, deployment counts and
live connection/access summaries within the viewport. The graph refits when its
canvas changes size. Resource, connection and access details open in focused
panels; long evidence can scroll inside its panel. Embedded consumers that want
the document layout can use `<IacLens fitWindow={false} />`.

## Graph, evidence and artifacts

The system graph describes infrastructure resources and their declared dependencies. The execution view shows the different graph of stages and decisions that reconciled those resources. Select a resource for its desired specification and recorded outcomes; inspect execution evidence for captured reads, writes and governing decisions.

**Deployment flow** follows declared prerequisites and the native chart/event
sequence. **Running system** arranges resources by their communication topology,
independently of creation order. Both views share the selected resource. Its
details combine declaration and adapter information, the recorded provider
operation, and only the connection/access checks explicitly bound to that
resource. Embedded storage borrows its runtime's readiness; it does not become a
separately provisioned database. Missing bindings or native capture stay visible.

Communication edges now start **Not checked**, become **Checking** while a real probe runs, and finish **Connected** or **Failed** from native FootPrint connection events. A passed Neo deployment automatically runs the checks; **Check connections** repeats them for the same admitted target. Each run retains its own native evidence and JSONL trace. Select an edge or its status row for the HTTP target, observation time, latency, source pod and recorded route/error details. **Inspect connection recording**, or the execution view's **Recorded flow** selector, opens the separate connection-check chart in Flow Lens.

The Kubernetes check sends DNS and HTTP traffic from an existing ready Neo pod through the Service's real ClusterIP, verifying that its advertised backends belong to the expected Deployment before and after the request. A successful response requires HTTP 200 with JSON `status: "ok"`. This is a point-in-time check from the recorded pod, not continuous traffic monitoring or proof of every client's access. Results do not come from node colours or display timers; a connection failure leaves the last successful deployment verdict intact. **Open Neo** uses a separate deployment port-forward and can remain usable when the Service route fails.

Other hosts can provide `connectionReview: { adapter, label, description, scopes }`
to `startDashboard`. It works alongside `managedReview` or `initialReview` and
binds probes to the configured graph digest. A managed deployment runs these
checks after successful reconciliation; **Check connections** makes another
recorded observation. `scopes` keys are the actual compiled relation IDs,
`communication:${relationIndex}`, including intervening non-communication
relations. They describe the measured path without changing its recorded verdict.

The full Neo identity example configures the public
`neoIdentityConnectionAdapter(target)`: a credential grant through uncached
LDAPS federation, a signing-key request from the Ready owned Neo Pod, and the
in-cluster Service health request. Target, ownership and routing checks remain
inside the adapters. Viewer requests cannot choose a destination or credentials.

## Identity and access reviews

A trusted local host can supply `identityReview` to `startDashboard`. **Check identity and access** runs those declared checks through the core's native FootPrint chart and streams actual **Checking → Passed / Failed** events. A negative test can pass: an expected denial must observe `denied`, and a wrong-password test must observe `rejected`. An unavailable identity service fails either test. Identity failures retain the successful resource deployment and its original recording.

The adapter owns the actual authentication and application requests. It keeps test credentials and tokens in its server-side closure and returns the core's allowlisted diagnostic metadata. Neither `/api/run` nor the dashboard receives a username, password, token, provider URL or arbitrary request body. The browser can request only the configured `identity` scenario. Checks are point-in-time; they do not enable continuous login monitoring or prove that an untested route enforces a policy.

This complete starter function accepts your measured adapter and an already-recorded deployment snapshot. Paths and credentials are supplied on your own laptop:

```ts
import type { AccessCheckAdapter } from 'footprint-iac/identity';
import { startDashboard, type InitialReview } from 'footprint-iac-lens/server';

export function openIdentityReview(options: {
  directory: string;
  staticDirectory: string; // Built Lens web assets.
  review: InitialReview;  // graph, native DashboardRun, target and optional neoUrl.
  adapter: AccessCheckAdapter;
}) {
  return startDashboard({
    directory: options.directory,
    staticDirectory: options.staticDirectory,
    initialReview: options.review,
    identityReview: {
      stack: options.review.graph.name,
      label: 'Neo identity and access',
      checks: [
        { id: 'reader-login', label: 'Reader signs in', kind: 'login', expected: 'authenticated' },
        { id: 'reader-chat', label: 'Reader can chat', kind: 'access', expected: 'allowed' },
        { id: 'guest-chat', label: 'Guest cannot chat', kind: 'access', expected: 'denied' },
        { id: 'wrong-password', label: 'Wrong password is rejected', kind: 'login', expected: 'rejected' },
      ],
      adapter: options.adapter,
    },
  });
}
```

`initialReview` shows infrastructure that another trusted host deployed through the core engine. By itself, it disables resource deployment controls and supplies no mutation adapter or state store for that target. It still shows the supplied resource recording, graph and local **Open Neo** URL. A host can explicitly add the versioned workflow below to authorize reviewed updates. It cannot be combined with the built-in managed `neo` target. Without `initialReview`, a configured identity review can run independently; the built-in Neo deployment also runs it automatically after successful resource and connection checks.

## Create or find, then connect and verify

The optional `resourceFlow` host mode composes the base library's native
resource workflow with the complete Lens workspace. It has four explicit tasks: **Create resource** or **Find
existing resource**, **Connection details**, **Connect application**, and
**Verify connection and access**. The same connection and verification stages
consume details obtained automatically or from an approved profile selected
during a human pause. The workflow remains independent of Neo and cloud brands.

Compose a `ResourceFlowWorkflow` and `FileResourceFlowStore` through
`footprint-iac/resource-flow/workflow`, then supply that fixed instance:

```ts
await startDashboard({
  directory: '/owned/viewer-state',
  staticDirectory: '/owned/lens/dist/web',
  resourceFlow: {
    workflow,
    target: { id: 'application-storage', label: 'Application storage' },
    neoUrl: 'http://127.0.0.1:5230/?test', // optional, shown after successful verification
    workspace: {
      graph: systemGraph,
      phaseGraphs: { acquire: sourceGraph, connect: consumerGraph },
      snapshot: workspaceSnapshot,
      subscribe: subscribeWorkspace,
      recheckConnections: checkConfiguredConnections,
      recheckIdentity: checkConfiguredAccess,
    },
  },
});
```

This mode cannot be combined with the built-in simulator, managed deployment,
master revision or separate connection/access mutation modes. The host may
supply an `initialReview` for existing deployment evidence. Starting the viewer
does not run the workflow or create resources. `start()` and `resume()` still
belong to the configured core workflow; Lens has no provisioning implementation.

Simple keeps the full resource canvas and live communication edges, with a
compact four-task strip above it. The human profile handoff appears inline.
Pending objects are grey, working objects blue, confirmed objects green and a
human wait amber. These states come from native FootPrint progress events.
A completed Create task says **Ready**, since
the adapter may have reconciled an already owned resource; Find says **Found**.
Existing mode leaves the referenced resource's infrastructure lifecycle with its
owner. Connection checks are measured observations, not evidence that a resource
was created or that a route was configured. Find resources say **Found**, based
on their measured lookup; no deployment starts are invented for them. The exact
phase graphs supply planned positions only, keeping the canvas stable before
the actual native child charts arrive. Create and Connect retain their own
graphs, run IDs, event sequences and recordings; the combined canvas is not a
fabricated six-resource native apply run.

During a pause, the viewer offers only the connection profiles fixed by the host.
It sends `POST /api/resource-flow` with `{ action: "start" }` or
`{ action: "resume", pauseToken, profileId }`. The exact current one-use pause
token and an approved profile ID are required. Missing/stale tokens, unknown
profiles, extra fields, endpoints, passwords, commands and target paths are
refused. Ordinary deployment and version mutation scenarios are unavailable in
this host mode. After completion, `/api/run` can invoke only the host's fixed
connection or access recheck callbacks. Rechecks record new measured outcomes
without rewriting the historical parent Verify result. The
headless client's `resourceFlow(action)` method uses the same narrow protocol.

A human pause releases the workflow action and provider/state locks. Restarting
with the same core store restores its pending profile selection. A resumed
workflow revalidates the resource before connecting; it does not rerun the
completed Create task. Private credentials are resolved by trusted adapters,
outside browser requests and public workflow state.

**Details** retains Deployment flow, Running system, capabilities and placement,
resource inspectors, output artifacts and native evidence. The parent workflow
and child resource recordings have separate selectors. Existing version history
can be supplied read-only; this host never stages or applies master revisions.
The workflow inspector also exposes the definition and target scope, measured outcomes, safe
failure receipts, and each native segment's run/evidence references. A pause and
resume retain separate native segment IDs linked under the same logical
execution. Optional fixed-host `recording(state)` and `artifacts()` callbacks
provide the admitted native snapshot for lazy Flow Lens inspection and related
deployment/check evidence. Browser requests cannot select evidence files.

### Run both paths with the real Neo app

Use sibling core and Lens checkouts with Node 24+ and the core identity guide's
Docker, kind, kubectl and protected Neo source prerequisites. Run `npm ci`,
`npm run check`, `npm test` and `npm run build` in each library checkout locally.
Do not enable CI. Prepare this laptop's own target and protected app images using
the core [identity integration guide](https://github.com/footprintjs/footprint-iac/blob/main/integration/identity/README.md).
Pin its printed canonical `target.json` path; another laptop's target, ports,
image cache and credential files are not inputs. Use a separate prepared target
when existing viewers must continue controlling their own deployments.

For a fresh Create demonstration, leave all six target resources absent and run
from the Lens checkout:

```sh
node examples/neo-resource-flow.ts /printed/identity/target.json --mode=create --details=human --flow=create-human --port=0
```

Open the printed loopback URL in Simple mode and click **Start workflow**. Create
provisions only the directory and sign-in service. The flow then pauses at
**Connection details**, with Connect and Verify still waiting. Choose the
approved profile and click **Continue**. Connect deploys the four owned Neo
consumer resources; Verify measures three communication paths and seven
identity/access checks. **Open app** appears after successful verification.
Sign in with the local Alice reader and run the zone audit, then separately
verify that Bob signs in but receives **Access denied**. The app uses the
documented scripted model and seeded data; this does not claim production
storage durability or general model reasoning.

Keep that deployment and select the same pinned target for Find:

```sh
node examples/neo-resource-flow.ts /printed/identity/target.json --mode=existing --details=human --flow=find-human --port=0
```

Find reads and validates the exact existing source identities. It does not call
their creation adapter. After the same human profile handoff, Connect can
reconcile the already configured consumer as a genuine no-op, then Verify
records fresh checks. Use `--details=automatic` for either mode when the adapter
should supply the approved profile without pausing. Each new experiment needs a
distinct `--flow` ID; an existing ID restores its saved execution instead of
repeating Create. Restarting the identical command while paused restores the
same pending token and checkpoint without repeating acquisition.

**Details** shows child resource actions, connection/access receipts and the
linked paused/resumed native segments. **Inspect segment** opens either segment
in Flow Lens. Record from before Start through both paths and the application
tests when an unedited demonstration is needed. Preserve each execution's
`<target>/resource-flows/<flow-id>/` history privately; do not commit credentials,
checkpoints, traces or recordings. The viewer accepts profile choices only and
does not expose a free-form connection editor or arbitrary company LDAP import.

## Review and apply a versioned master JSON

The core's `footprint-iac/master` API keeps immutable desired-system revisions,
their parent revision, the applied and staged heads, and every recorded apply
attempt. This history is separate from the provider inventory. A release's
revision ID and content digest are also separate from Lens's increasing snapshot
`revision` number and a native deployment's run ID.

A trusted host can supply `initialReview` together with `revisionWorkflow` to
`startDashboard`. Its `snapshot()` reads the durable master state; `review()`
returns the candidate summary and fixed provider configuration;
`completed(prepared, run)` rereads the resulting master history. Optional
`artifacts()` exposes the host-selected JSON documents. This mode requires an
existing recorded deployment and cannot be combined with `managedReview` or the
built-in Neo target.

In **Simple**, **Review changes** keeps the existing deployment recording and
app link visible while the host reads and plans the candidate. Lens shows the
current and candidate versions, highlights affected resources, and dims
unchanged ones. **Details** reveals the exact resource actions and JSON field
differences. A semantic JSON difference does not imply a provider update: the
actual plan decides whether a resource needs creation, update, verification or
no change. The viewer does not expose an implicit prune or deletion action.

**Apply update** echoes the exact completed review ID. Missing, stale or already
used reviews are refused. The browser supplies only
`{ scenario: "revision-review" }` or
`{ scenario: "revision-apply", reviewId }`; it cannot upload a graph, choose a
target or run a command. Admission preserves the existing target binding. When
the host uses the core master workflow, the engine checks the reviewed plan
against current provider state before mutation; a changed plan requires a fresh
review.

Applying captures one new native FootPrint run. Only affected resources receive
provider mutations; unchanged resources can have recorded no-op or readiness
checks. Those checks remain distinct from building a resource. Progress and
terminal outcomes come from the native recorder, including failures and missing
evidence. A failed apply retains the previous applied master and its earlier
recordings. Review again before retrying the candidate on the same deployment.

After infrastructure convergence, the host can restore owned local app access
with `afterApply()` and run configured connection and identity/access checks.
These checks have their own FootPrint recordings. An unavailable app connection
or failed access check does not roll back a proven infrastructure revision:
Simple retains the applied version and shows **Checks need attention**. Inspect
the separate results, recover the service and rerun its checks. The applied
master proves the recorded infrastructure outcome; it does not assert that every
later connection or application request succeeded.

### Upgrade the existing real Neo deployment

First complete the six-resource Neo identity deployment using the core
[identity guide](https://github.com/footprintjs/footprint-iac/blob/main/integration/identity/README.md).
Keep its printed canonical `target.json` path and successful native recording.
For the next application version, review and stage the intended source changes
in the Neo checkout and obtain its exact 40-character `git write-tree` value.
From the core repository, build and load those images into the same cluster
without replacing the applied target:

```sh
node integration/identity/build-neo.ts --stage-only /path/to/Neo REVIEWED_TREE_HASH /prepared/target.json
```

The command prints a new `targetPath` beneath that prepared target's
`candidates/<source-tree>/` directory. Pass that exact path to Lens:

```sh
cd ../footprint-iac-lens
node examples/neo-identity-versioned.ts /prepared/target.json /prepared/candidates/SOURCE_TREE_HASH/target.json --port=0
```

Open the printed URL in **Simple**. Starting the viewer adopts the matching
successful baseline and stages the candidate; it does not deploy infrastructure.
Click **Review changes**, inspect **Details** if needed, then **Apply update**.
An application-image-only change shows **Update Program**, with the other five
resources unchanged. One actual FootPrint run records the update and existing
resource checks, followed by measured connections and login/access checks.
**Open Neo** retains its original local address after the owned forward is
restored. Test the reader's allowed route and guest's denied route in the app;
the automatic checks and their recordings are also available in Lens.

The target's `master/master.json` retains revision and attempt history;
`master/runs/` retains native deployment results. Only a proven applied revision
publishes the new canonical target. Restarting the same command after success
opens the applied version and its recording without redeploying it. If startup
reports that canonical bindings and recorded history disagree, inspect the
retained publication evidence before continuing. Keep this private local state
with the prepared target rather than copying it into Git.

## Deployment flow from the native recorder

In **Details**, **Deployment flow** is a resource pipeline. Simple uses the same
captured flow for its build scene. Compute, storage and network are labels
on resources, not a fixed execution sequence. **Browse capabilities** keeps the
category inventory separate and collapsed by default. A runtime containing
embedded SQLite appears once, with compute and storage labels; it does not
become two independently provisioned resources.

The core engine publishes its unchanged FootPrint chart and explicit
resource-to-stage bindings before traversal. The headless
`projectNativeDeploymentChart` walks those actual gates, selector branches and
joins to place the boxes. It checks the run, graph digest and stage bindings;
it never constructs a second execution schedule. `projectDeploymentFlow`
combines that native topology with the same recorder's resource events.

Start numbers come only from native event sequence. Grey is unstarted, blue
is reconciling, and green requires a recorded provider-confirmed outcome.
**Scheduled together** describes a native fork; **Overlapping work** requires
actual captured overlap. A failed step remains failed and skipped work has no
invented start number. Existing-resource checks are labelled as such.

Clicking a box reveals its resource ID, recorded runtime stage and mapped
capabilities. The native execution-evidence view retains the full chart,
conditions, reads and writes. The pipeline summarizes that same execution;
resource readiness, network communication and continuing health remain
separate facts. Solid **then** arrows describe observed completion before the
next start. **Next** arrows show the native schedule; optional **needs** arrows
show declared resource prerequisites.

Older recordings without explicit native bindings still show observed event
order, labelled **Recorded execution**. Without valid ordered events or native
topology, only prerequisites are shown. Missing or conflicting capture stays
visible. This implementation adds no new cluster or provider dependency.

## Managed provider reviews and system blocks

A trusted local composition can instead configure `managedReview` with its
declared `graph`, a core `DeploymentRecorder`, and an `apply()` callback returning
the actual `InfraEngine.apply` result. Pass the **same recorder object** to the
engine's `recorders` and `chartObservers` options and to the review. The recorder's
`subscribeChart` channel supplies topology; its `subscribe` channel supplies live
resource observations. **Deploy system** and **Reapply / check no-op** request
only `{ scenario: "review" }`; the browser cannot select a graph, adapter, path
or target. Managed reviews cannot be combined with an initial recorded review
or the built-in Neo target, and cannot fall back to simulator scenarios.

The initial view is pending. Started and ready statuses come from the native
recorder while the configured provider operation runs. Each reapply clears the
view and captures a new actual execution, including real no-op operations.
Run IDs, the recorded graph digest, resource outcomes and saved native evidence
must agree before the review passes. Missing, rejected or mismatched capture
remains visible as a failed/incomplete review; a callback's success result alone
cannot manufacture ready resources. Configured identity checks stay unavailable
until the managed resource review passes. Application links are host-selected;
resource readiness does not independently prove that a local port-forward exists.

`systemView` optionally supplies trusted high-level blocks such as compute,
storage, network and identity. Each block has named units mapped to actual
resource IDs. Headless `projectSystemBlocks` derives unit and block status from
the native resource outcomes. Without an explicit definition it can use the
current `SystemDesign` and binding. Existing prerequisites are labelled and
excluded from provisioning counts. An embedded unit borrows the readiness of
its declared runtime resource; it does not invent another database, container
or volume resource. Unknown or empty managed mappings remain **unmapped**,
and failures and skipped dependencies remain visible. Unit lists expand inline;
the started animation respects reduced-motion settings and never changes status.

Build the reviewed Neo images first using the core
[identity guide](https://github.com/footprintjs/footprint-iac/blob/main/integration/identity/README.md). Then start one
viewer against the newly prepared, empty target:

```sh
node examples/neo-identity-live.ts /printed/target.json --port=0
```

Open the printed URL in **Simple** mode. Directory, Sign-in, Space, Access,
Program and Network are all grey before clicking **Build system** once. A fresh
target produces six real creates in one native FootPrint deployment run, on the
same chart. A separately labelled native schedule preview supplies initial
positions only; recorded starts and provider confirmations drive progress.

Fresh targets use the owned sign-in service's stable name, so no bootstrap
viewer or manual address handoff is required. The viewer rejects
`--identity-only`; `--full` remains an optional alias for the same single build.
Existing targets with a recorded provider IP remain supported.

After readiness, start the target's explicit loopback forward before opening
Neo. Connection checks run automatically after the deployment and verify the
owned endpoint, DNS answer and HTTP peer. Access checks use private server-side
credential closures. These are measured point-in-time checks, not continuous
connection monitoring.

Select **Inspect identity recording** or **Recorded flow → Identity and access checks** for the native chart. Each run writes private `identity/<runId>.json` evidence and `identity-traces/<runId>.jsonl` beneath the host's viewer directory. Recovery creates another run and preserves the earlier failure. Resource, connection and identity recordings remain separate views of their respective operations.

Kubernetes runs expose generated JSON/YAML from the complete desired graph. The CloudFormation object-storage files are a separate, labelled export-only example using a synthetic account ID; no AWS deployment occurs. Artifact generation has structural validation and does not prove that a cloud deployment would succeed. Native resource mappings and compilation evidence are available from the core synthesis API.

Replay reconstructs recorded state. Backwalking traverses captured dependencies, with missing evidence and external uncertainty retained. Live snapshots survive SSE reconnects while the server runs; the viewer saves the final state under `.artifacts/latest.json`, and the core retains its durable inventory and execution evidence. Keep `.artifacts/` local because it contains infrastructure and execution data.

The server accepts only named demo/failure/no-op/Neo/connection scenarios, host-configured managed or versioned reviews, and identity checks. It has no arbitrary command, graph upload, path or cloud-target execution endpoint. Keep this prototype local; remote hosting and authentication require a separate design.
