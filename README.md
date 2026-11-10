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

The default is explicitly labelled **simulation**. Choose a successful simulation, an injected failure, or reapply a successful run to check no-op behavior. The simulator deliberately delays its readiness promise so progress is visible; the UI never manufactures deployment outcomes using animation timers. Requests run serially. A failure leaves earlier successful resources managed so the next successful simulation can reconcile them.

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
import { createDashboardClient, layoutResources, statusCounts } from 'footprint-iac-lens/core';

const client = createDashboardClient({ fetch: yourFetch, openStream: yourStream });
// Feed its state into your framework's rendering mechanism.
// layoutResources(state) returns plain node/edge descriptors.
```

The transport is injected so the core needs neither React nor a browser DOM. The server sends versioned snapshots over `/api/state` and `/api/events`; monotonically increasing revisions prevent an older initial fetch from overwriting a newer stream update. Resource events retain their full IDs, run IDs and native runtime-stage attribution.

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

## Graph, evidence and artifacts

The system graph describes infrastructure resources and their declared dependencies. The execution view shows the different graph of stages and decisions that reconciled those resources. Select a resource for its desired specification and recorded outcomes; inspect execution evidence for captured reads, writes and governing decisions.

Communication edges now start **Not checked**, become **Checking** while a real probe runs, and finish **Connected** or **Failed** from native FootPrint connection events. A passed Neo deployment automatically runs the checks; **Check connections** repeats them for the same admitted target. Each run retains its own native evidence and JSONL trace. Select an edge or its status row for the HTTP target, observation time, latency, source pod and recorded route/error details. **Inspect connection recording**, or the execution view's **Recorded flow** selector, opens the separate connection-check chart in Flow Lens.

The Kubernetes check sends DNS and HTTP traffic from an existing ready Neo pod through the Service's real ClusterIP, verifying that its advertised backends belong to the expected Deployment before and after the request. A successful response requires HTTP 200 with JSON `status: "ok"`. This is a point-in-time check from the recorded pod, not continuous traffic monitoring or proof of every client's access. Results do not come from node colours or display timers; a connection failure leaves the last successful deployment verdict intact. **Open Neo** uses a separate deployment port-forward and can remain usable when the Service route fails.

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

`initialReview` shows infrastructure that another trusted host deployed through the core engine. Resource deployment controls are disabled, and this Lens server receives no mutation adapter or state store for that target. It still shows the supplied resource recording, graph and local **Open Neo** URL. It cannot be combined with the built-in managed `neo` target. Without `initialReview`, a configured identity review can run independently; the built-in Neo deployment also runs it automatically after successful resource and connection checks.

## Deployment flow from the native recorder

The main visual is a resource pipeline. Compute, storage and network are labels
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

The complete local identity example uses two honest stages:

```sh
node examples/neo-identity-live.ts /printed/target.json --identity-only --port=15238
```

The first **Deploy system** creates the owned directory and sign-in provider,
then observes the provider address from its durable physical identity. Build
the reviewed Neo images using the core identity guide, then start the second
viewer:

```sh
node examples/neo-identity-live.ts /printed/target.json --full --port=15239
```

Its first apply creates the four application resources and records the two
identity resources as real no-ops. Start the descriptor's explicit loopback
forward before opening Neo. Access checks use private server-side credential
closures. These staged bindings do not claim automatic provider-output
interpolation or continuous connection monitoring.

Select **Inspect identity recording** or **Recorded flow → Identity and access checks** for the native chart. Each run writes private `identity/<runId>.json` evidence and `identity-traces/<runId>.jsonl` beneath the host's viewer directory. Recovery creates another run and preserves the earlier failure. Resource, connection and identity recordings remain separate views of their respective operations.

Kubernetes runs expose generated JSON/YAML from the complete desired graph. The CloudFormation object-storage files are a separate, labelled export-only example using a synthetic account ID; no AWS deployment occurs. Artifact generation has structural validation and does not prove that a cloud deployment would succeed. Native resource mappings and compilation evidence are available from the core synthesis API.

Replay reconstructs recorded state. Backwalking traverses captured dependencies, with missing evidence and external uncertainty retained. Live snapshots survive SSE reconnects while the server runs; the viewer saves the final state under `.artifacts/latest.json`, and the core retains its durable inventory and execution evidence. Keep `.artifacts/` local because it contains infrastructure and execution data.

The server accepts only named demo/failure/no-op/Neo/connection scenarios, the host-configured managed review and identity checks. It has no arbitrary command, graph upload, path or cloud-target execution endpoint. Keep this prototype local; remote hosting and authentication require a separate design.
