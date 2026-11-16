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

Simple and System design use the same optional, lazy-loaded renderer. Cards expose category, product label, origin and recorded status. Nested boundaries show host/runtime placement. Clicking a component, boundary or live connection opens its evidence, including native run/stage IDs and explicit uncertainty. Kubernetes, Node.js, Python and SQLite use a locally bundled, pinned CC0 Simple Icons subset. systemd, memory and unknown technologies retain their declared text and use a generic category glyph; no arbitrary remote icon URL is accepted.

The component evidence panel currently displays matching native run/stage IDs; it does not deep-link directly to that stage. To traverse a published deployment recording, close the panel and open **System design → Execution evidence → Resource deployment**. The existing Flow Lens opens the recorded parent and adapter subflows. Check recordings can be explored through their corresponding Connection/Identity source when the host publishes that source. A topology check reference alone does not publish its full checker snapshot.

The graph uses readable HTML labels and a bounded graph viewport. Large systems can scroll within that viewport instead of shrinking all labels. Completed setup details collapse by default. Technical setup controls, the deployment flow, execution recordings and artifacts remain available separately.

Connections use reserved row corridors, separate attachment points, rounded bends and a white separation stroke at crossings. Arrowheads have an explicit 8px size and match the recorded connection status. Status badges stay clear of components, boundary titles and other wires; when a dense graph has no clear badge position, its connection remains selectable under **more connections**. Routing follows the immutable definition and stays fixed while check outcomes change. The seven-component Neo layout retains full-size 184×104 cards in a 996×388 canvas.

A configuration change clears the previous current topology. Only a publication bound to the newly active target/configuration can display again. Old recordings remain in history.

The headless core and server require no React, diagram renderer or browser. Legacy hosts without topology retain the existing resource view.
