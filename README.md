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

Kubernetes runs expose generated JSON/YAML from the complete desired graph. The CloudFormation object-storage files are a separate, labelled export-only example using a synthetic account ID; no AWS deployment occurs. Artifact generation has structural validation and does not prove that a cloud deployment would succeed. Native resource mappings and compilation evidence are available from the core synthesis API.

Replay reconstructs recorded state. Backwalking traverses captured dependencies, with missing evidence and external uncertainty retained. Live snapshots survive SSE reconnects while the server runs; the viewer saves the final state under `.artifacts/latest.json`, and the core retains its durable inventory and execution evidence. Keep `.artifacts/` local because it contains infrastructure and execution data.

The server accepts only named demo/failure/no-op/Neo scenarios. It has no arbitrary command, graph upload, path or cloud-target execution endpoint. Keep this prototype local; remote hosting and authentication require a separate design.
