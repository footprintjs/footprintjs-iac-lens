# One recorded deployment, two diagram adapters

The executable FootPrint chart is the deployment workflow. A recording captures
its admitted actions, branches, skips, retries and observations. The Running
system diagram is a separate read model: registered placement and connections,
combined with measured outcomes. It does not run another deployment.

Both diagram families now use the published `footprint-explainable-ui@0.46.0`
renderer. Their adapters retain separate semantic inputs:

| Adapter | Input | Canvas contract |
| --- | --- | --- |
| Deployment | Admitted resource/native schedule and execution observations | `TracedFlow` with a typed deployment `TraceGraph` |
| Native adapter subflow | Admitted mounted stages, exact scope IDs and branch decisions | `TracedFlow` with native IDs and semantic deployment cards |
| Synchronized run deployment | Complete admitted resource-operation graph across its scopes | Standard EUI `StageNode`, measured layout and built-in subflow drill/breadcrumb; no custom node registry |
| System | Admitted `SystemTopologyView`: components, boundaries, connections and measured states | `TracedFlow` without an execution overlay, with a typed physical graph and custom component/boundary/connection renderers |
| Legacy resources | Resource progress plus independently measured connection outcomes | `TracedFlow` with existing cards and authored routes; no invented execution overlay |

Authored geometry can pass through the renderer. Diagram adapters own domain
labels and presentation metadata; Explainable UI owns the graph canvas and its
rendering extensions. Custom system edges deliberately have no workflow
`data.kind`: communicating with LDAP is not a "run next" relationship. Physical
containment does not become execution ancestry. No synthetic runtime overlay is
created from readiness colors.

The chart factories are separate cohesive modules:

- `web/lib/create-deployment-trace-graph.ts`
- `web/features/adapter-deployment/create-adapter-trace-graph.ts`
- `web/features/system-topology/create-system-graph.ts`
- `web/lib/create-resource-trace-graph.ts`

Physical and legacy connection layouts fit cards, outside wires and visible
badges through the renderer's controlled camera API. Each chart has one camera
owner; changing a status preserves the user's pan and zoom.

Progress and replay continue to read saved native observations. A cursor move
selects a recorded state; it invokes no provider. Existing/Embedded origins,
resource IDs, configuration identity and native run/stage IDs remain unchanged.
**Show deployment step** resolves exact native evidence, rather than matching
component names. Full native recordings remain under Execution evidence.
Opening Details while replaying keeps the selected captured system state. The
Recording tab is explicitly labelled as the full run recording, with its own
native cursor; it is not presented as a recording prefix for that replay frame.

The evidence panel retains its modern-provenance compatibility boundary. Version
0.46 does not establish full parity for every `viewAt`, `builtOnView` and write-
verb capture used here. The updated dependency reader remains responsible for
those recorded dependencies; renderer reuse does not broaden causal claims.

## Input and output boundaries

A common validated model can serve different adapters without merging their
responsibilities. Source adapters obtain registered local/GitHub/release inputs;
interpretation and validation produce the desired infrastructure model. Provider
adapters plan, apply and observe the target with FootPrint recording. Output
adapters consume the appropriate model:

- Complete desired, provider-bound graph → CloudFormation/Kubernetes artifacts.
- Desired system definition + admitted observations → system diagram.
- Native build chart + linked recording → deployment diagram, replay and backwalk.

The base library already exposes `OutputAdapter` and `synthesize` under
`footprintjs-iac/synthesis`; its current AWS profile is narrow S3 template lowering
with structural validation. A rendering upgrade does not add general AWS
provisioning. A running-system snapshot alone is not a complete deployable desired
model, and changing file format does not change the infrastructure platform.

The run player shows deployment on the left and an isometric physical system on
the right, with one shared replay control. Each new frame stores a bounded,
validated `deployment` projection alongside its physical state. The full native
recording is still stored once per run. Earlier moments never borrow terminal
stage outcomes. Older records retain their original bytes and disclose missing
adapter detail instead of inventing it.

The synchronized deployment pane reuses the standard Explainable UI presentation.
It starts at the recorded resource operation's root, with child scopes opened by
the renderer's native drill navigation. All recorded decisions, branches and
loops remain in the graph. The outer scheduler is not part of this adapter
projection; it remains available in Execution evidence. Skipped and unconfirmed
steps have explicit standard descriptions and never receive a done flag.
Recorded node flags come from the selected moment, without manufacturing an
execution order or retry count. New projections retain the exact native
constructor kind; older captures do not guess whether a generic decision was a
fork.

Both panes consume the same resolved Lens theme tokens. The standard deployment
view uses EUI's normal styling and layout, without a forced light/dark preset or
`unstyled` override. The running-system projection keeps its physical semantics
and reads the same token roles.

For EUI 0.46's controlled flat chart, `StandardChartMeasurements` requests genuine
DOM dimensions and handle positions through xyflow's public measurement hook on
each node publication. That release replaces controlled nodes without retaining
their measured metadata; rapid live updates can otherwise leave unchanged-size
nodes hidden while the resize observer waits. This bridge supplies no invented
dimensions, positions, visibility styles or execution state. The standard EUI
layout and nodes still own presentation.

`SystemTopologySlot` accepts `renderer="isometric"`; standalone consumers retain
the existing flat default. The physical adapter projects floor plates, wires and
ports into one plane while keeping component text upright. Communication remains
a physical connection, not workflow execution or causal ancestry. The optional
renderers stay behind lazy UI boundaries; headless core/server imports remain
free of React and diagram libraries.
