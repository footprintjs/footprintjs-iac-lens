# Consumer-owned system symbols

Lens renders a consumer's passive symbol pack on the existing Explainable UI
canvas. The library owns the adapter contract, measured placement, routing,
theme bridge and evidence presentation. The application owns the drawings and
the meaning of each registered subject. Lens includes no hardware catalogue.

The left pane continues to show recorded deployment actions. The right pane
shows declared physical placement with consumer symbols, recorded component
actions and measured progress. A process symbol never changes a component into
a separately provisioned server. Existing and Embedded origins stay visible.

## Register a pack

A pack contains bounded SVG path definitions and exact assignments:

```ts
import {createSystemSymbolAdapter} from 'footprintjs-iac-lens';
import {IacLens} from 'footprintjs-iac-lens/react';
import {diagramSymbols} from './my-app/lens-symbols.js';

const symbolAdapter = createSystemSymbolAdapter(diagramSymbols);
<IacLens symbolAdapter={symbolAdapter} theme={{preset:'paper'}} />;
```

Each definition has an opaque `id`, a finite `viewBox` width/height and passive
paths. A path supplies `d`, optional `fill` (`none`, `surface`, `subtle`, `accent`),
optional `stroke` (`none`, `ink`, `muted`, `accent`) and bounded `strokeWidth`.
Paint roles use the shared theme. The pack contains no HTML, scripts, URLs,
credentials or executable actions.

Set `presentation: 'object'` on a definition to make the drawing the primary
isometric object. It appears directly on its physical floor with an unframed
caption and recorded progress nearby. The renderer does not wrap it in a card.
Neo's example uses this mode for its consumer-owned three-face objects and
database cylinder. Omitted presentation retains the compact glyph/card mode for
existing consumers; unmatched subjects keep the normal fallback.

Give an object symbol optional `ports` to attach its wires to the drawing.
Each port has `x` and `y` in the symbol's `viewBox` and a `side` of `left` or
`right` for the outward approach. Place ports on visible outlines and supply
separate points for separate wires. Objects without ports keep the default
attachment points.

Each binding supplies `targetId`, `topologyId`, `subject` (`component` or
`boundary`), `subjectId` and `symbolId`. Resolution requires that exact target,
topology and declared object. It never searches labels or assumes a compute
component is hardware. Unknown or unmatched subjects retain the standard card.

Standalone hosts register the same pack without importing React:

```ts
import {startDashboard} from 'footprintjs-iac-lens/server';
import {diagramSymbols} from './my-app/lens-symbols.js';

await startDashboard({...registeredOptions, diagramSymbols});
```

The loopback server validates the pack before opening. The browser reads it
through `GET /api/diagram-symbols`; there is no browser mutation endpoint for
symbol registration. An absent pack or older server retains the standard view.
An embedded host can instead implement the `SystemSymbolAdapter.resolve`
interface in its trusted application code.

## Geometry, live state and history

Mapped system symbols use a measured presentation profile. The footprint,
upright label, boundary heading, wire attachment and connection label obstacles
participate in placement and fitting. Status changes keep that geometry stable.
The same gentle camera and manual Follow controls continue to apply.

An object click opens its existing evidence panel. It pauses camera following
without moving the replay moment or performing provider work. Native actions,
verified-check progress and Existing/Embedded origins remain separate facts;
the consumer drawing never supplies them.

Symbols describe current consumer presentation, like the theme. They are not
native execution evidence and are not copied into every recorded publication.
Historical labels, origins, actions, progress and connection outcomes still come
from the selected immutable FootPrint moment. A newer symbol pack can change
the appearance of a matching old subject; it cannot change its recorded facts.

Neo's example pack lives in its consumer repository at
`infra/examples/lens-symbols.mjs`. The operator passes explicit subject-role
assignments from its own registered topology. Importing that module performs
no discovery, installation, deployment or network call.

Object-mode wires are routed on the same isometric axes as the physical ground,
with measured artwork, caption and boundary-header clearance. Attachment points
and lanes are presentation geometry; they never change the registered source,
destination or measured connection status. Connection badges render above the
physical ground so the native result remains visible and inspectable.
