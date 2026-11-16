# System placement in Lens

`DashboardState.systemTopology` is the optional, framework-neutral system view from `footprintjs-iac/system-topology`. It describes where components run, which technologies the operator declared, what already existed, and which connections native checks actually measured.

The base library owns the definition, evidence admission and projection. Lens reads the resulting `SystemTopologyView`; it never turns a whole service-group update into fictional per-component installs. The deployment flow remains separate: it answers what runs first, waits, branches or runs in parallel. The system view answers what runs where and what communicates.

## Publishing

A trusted application/onboarding host may publish `systemTopology` alongside its physical graph, before deployment, and after each native observation. Bind the definition to the target ID and graph digest. Bind observations to that definition digest and the current immutable onboarding configuration digest.

```ts
import { defineSystemTopology, projectSystemTopology } from 'footprintjs-iac/system-topology/node';

const definition = defineSystemTopology({
  id: 'placement', label: 'Application placement',
  boundaries: [
    { id: 'server', kind: 'server', label: 'Registered server' },
    { id: 'runtime', kind: 'runtime', label: 'Services', parentId: 'server',
      technology: { id: 'systemd', label: 'systemd' } },
  ],
  nodes: [{ id: 'api', label: 'Application', category: 'compute', origin: 'deployment',
    boundaryId: 'runtime', technology: { id: 'nodejs', label: 'Node.js' },
    bindings: { resourceIds: ['service-group'], componentIds: ['app-unit'] } }],
  connections: [],
}, { targetId, graphDigest: graph.digest });

publish({ systemTopology: projectSystemTopology(definition, {
  targetId, graphDigest: graph.digest, definitionDigest: definition.digest,
  configurationDigest,
  resources: [], components: [], checks: [], // pending before native observations
}) });
```

Use actual admitted resource/component/check observations in subsequent publications. Never create them from desired configuration, timers, an unverified report or a combined service-group success. The base library supplies status labels, facts, progress and evidence scope.

## Viewing

Simple and System design use the same optional, lazy-loaded renderer. Cards expose category, product label, origin, recorded status, current adapter action and verified-check progress. Nested boundaries show host/runtime placement. Clicking a component, boundary or live connection opens its evidence, including native run/stage IDs and explicit uncertainty. Kubernetes, Node.js, Python and SQLite use a locally bundled, pinned CC0 Simple Icons subset. systemd, memory and unknown technologies retain their declared text and use a generic category glyph; no arbitrary remote icon URL is accepted.

When a native adapter action matches the current admitted deployment recording, **Show deployment step** opens its exact mounted scope and runtime execution in Deployment flow. The link checks the native run, resource and full runtime-stage identity; stale or incomplete captures do not acquire a guessed link. The action history remains in the component evidence panel. Full deployment captures remain available through **System design → Execution evidence → Resource deployment**. Check-only references can be explored through their corresponding Connection/Identity source when the host publishes that source; a topology check reference alone does not publish its full checker snapshot.

The graph uses readable HTML labels and a bounded graph viewport. A ResizeObserver fits the complete diagram, including host boundaries and connections, to the available width and height. Native coordinates and route paths remain unchanged; only the display scale changes, and cards never enlarge above their declared size. Completed setup details collapse by default. Technical setup controls, the deployment flow, execution recordings and artifacts remain available separately.

Connections use reserved row corridors, separate attachment points, rounded bends and a white separation stroke at crossings. Arrowheads have an explicit 8px size and match their wire. Connected edges use a stable colour palette with matching badge swatches; status words remain explicit. Untested or unconfirmed edges stay grey, checking edges are amber and animated, and failures are red. Ready card borders and boundary headers stay neutral; compact header meters show boundary progress without resembling connection lines. Status badges stay clear of components, boundary titles and other wires; when a dense graph has no clear badge position, its connection remains selectable under **more connections**. Routing follows the immutable definition and stays fixed while check outcomes change. The seven-component Neo layout retains 184×104 source cards in a 996×388 canvas. In an actual 1238×354 graph viewport, the whole canvas displays at about 91% scale with no vertical scrolling.

A configuration change clears the previous current topology. Only a publication bound to the newly active target/configuration can display again. Old recordings remain in history.

The headless core and server require no React, diagram renderer or browser. Legacy hosts without topology retain the existing resource view.
