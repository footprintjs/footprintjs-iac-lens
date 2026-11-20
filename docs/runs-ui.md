# Progressive run journey

Lens opens with **Recent runs**. The home page shows a human label, setup version
when available, result and recorded time. It does not display native run IDs,
resource identifiers, adapter names or architecture controls. Unknown dates stay
unknown. Older summary-only entries remain useful results without invented
replay. A history persistence problem is disclosed under **Run history needs
attention**, separately from the application's execution result.

Selecting a run opens two synchronized panes and one short current-action
sentence: the deployment chart on the left, and an isometric running system on
the right. Both use one FootPrint replay timeline. New frames retain bounded
native stage projections beside the physical snapshot, so seeking never imports
future completed steps. Older recordings disclose unavailable adapter detail.
The scene preserves **Existing**, managed and embedded origins. Its optional
`inspectable={false}` presentation renders
plain component/boundary labels rather than hidden keyboard controls. Detailed
native evidence and architecture remain accessible through **Details**.

Consumer definitions with `presentation: 'object'` render as unframed isometric
objects directly on their host/runtime ground, with labels and recorded progress
nearby. The normal run view allows clicking an object to inspect its native
evidence. Pointer or keyboard exploration pauses Follow while preserving the
selected moment and the other pane's current subflow.

Deployment uses Explainable UI's standard stage renderer, measured layout,
subflow drill and breadcrumb. It opens the complete recorded resource operation
at its root, rather than selecting its deepest adapter body. Both panes inherit
the same host palette, font, spacing and node tokens. Playback remains one
selected FootPrint publication for both panes.

Click an ordinary deployment step to smoothly center and zoom to that node.
**Step details** then opens its recorded evidence without obscuring navigation
on the first click. Subflow nodes keep the standard drill behavior; **Fit View**
returns to the complete visible scope. Camera navigation never moves the shared
replay cursor or executes deployment work. Reduced-motion preferences disable
the camera animation.

**Follow execution** starts enabled for a newly selected run. It follows only
the selected publication's native running stages, enters their exact child
scope, and returns to the appropriate parent when the active work moves there.
Parallel child scopes stay visible together at their deepest common parent;
parallel stages in one scope fit together. A single deployment pane still shows
one resource: several active resources use a stable selection and display their
count, while system highlighting includes every exactly linked active resource.

Automatic camera fitting happens only when entering or leaving a scope. The
whole visible subflow fits once; successive steps change their highlights without
panning or zooming. Brief recorded gaps between steps retain that entered scope
as context while its resource is deploying. Context is rebuilt from the selected
recording prefix, so a backwards seek cannot retain a future subflow. An empty
frontier still has no active-step or component highlight.

The running-system pane outlines components whose recorded action references
resolve to that same native running frontier, plus their declared enclosing
boundaries. A shared-resource action remains shared work; the outline does not
claim an independent per-component operation. Progress, readiness, origins and
connection outcomes continue to come from the saved system observations. No
matching action means no component highlight; missing detail is not guessed
from names or resource proximity.

Clicking a node, drilling, panning or zooming pauses Follow while retaining the
current scope and replay moment. Press Follow execution to resume at that same
moment. Seeking or playing the single replay control keeps Follow available for
historical observations; it never switches a historical frame to live data.
Completed, skipped, failed and unconfirmed work is not treated as currently
running. When the resource settles, the chart returns to its resource overview.

System cards show the current native action and a separate recorded-work meter
in Simple mode. Each dot is one observed runtime stage, with shared/component
rows for the same instance counted once. At most eight actual dots are shown;
the count includes earlier recorded instances retained in Details. This is not a
percentage of planned work: the adapter has not declared every future action for
each component. Provisional passed actions remain Observed; admitted outcomes
are Confirmed, and failures or uncertainty stay visible. The existing verification
strip still waits for independently admitted component/check outcomes. Existing
databases without recorded deployment actions receive no invented work meter.

The running-system camera gently centers on the physical area containing the
recorded work. It moves when that area changes, rather than for each step.
Components within one runtime or host share an area; parallel areas are framed
together. Zoom is capped at 18% above the complete overview and never enlarges
cards above their authored size. The complete active area remains visible, with
connected neighbours retained when they fit. Paper colours and the recorded
progress remain on the cards while the camera moves.

Brief same-resource gaps can retain the last visited area as camera context,
without retaining active component highlights. This context is rebuilt from the
selected recording prefix; rewinding cannot borrow a later area. Completion
returns to the overview. Moving either chart manually pauses Follow execution;
resuming it centers the area for that same replay moment. Reduced-motion
preferences apply camera transitions immediately.

**New run** opens the existing registered setup controls. With onboarding, these
are the same native workflow and sealed review/Deploy actions used elsewhere;
there is no second executor or automatic chain. A new deployment run identity
closes setup and follows the corresponding catalog entry once admitted.

## Replay and live state

Explainable UI's compact `TimeTravelControls` provides the single **Replay
position** slider, previous/next buttons and playback clock. Lens maps each
position to an actual `RunRecord.frames` publication, in sequence. It never calls
an execution endpoint, mutates desired configuration, or creates intermediate
states. **Recorded steps** is the default when clock coverage is incomplete.
Complete native clocks allow the slider to display the recorded elapsed time.
**Play** advances existing observations at a reading pace; it does not claim the
original wall-clock speed. A collapsed **Stages** strip sits below the slider.
Expanding it exposes compact activity buttons; selecting one stops playback and
jumps to its first captured publication. Only adjacent identical captions are
grouped. This is a navigation strip, without a Gantt chart, inferred work
durations or fabricated native stage identities. Expanding or collapsing it
preserves the current replay position. **Live**
requires a connected stream and a matching current native running observation.
An older saved in-progress result is never labelled live. Catalog/record polling is read-only display
refresh, not a source of run identity or recorded progress.

An adapter may publish measured connection results together after its operation.
Replay preserves that publication granularity. It does not insert per-connection
checking states or stretch short operations to create an animation.

The current live dashboard can supply a scene only after its native run, target,
graph and topology/configuration bindings match the selected captured run.
Historical runs keep their own states. They never borrow a newer green result.
Missing recordings show a limited result rather than substituting current data.

A verified ready application receives **Open app** and its registered safe
HTTP(S) address, including production domains. A completed resource operation
without application verification says **Completed**. An older link is labelled
**Open recorded app** and explicitly describes verification during that run;
it makes no present-health or current-version claim. URLs with credentials or
non-HTTP schemes are not shown.

## Modules and ownership

- `src/core/run-history.ts`: framework-neutral catalog, record, repository,
  observation and read-only client contracts.
- `web/features/runs/RunWorkspaceSlot.tsx`: lazy feature boundary.
- `RunHome.tsx`: recent activity and bounded list.
- `RunPlayer.tsx`, `RunTimeline.tsx`, `RunScene.tsx`: selected observation,
  shared cursor, Explainable UI replay controls and quiet scene.
- `create-replay-snapshots.ts`, `create-replay-timeline-rows.ts`: display-only
  publication mapping and adjacent-caption navigation, without execution claims.
- `RunDetails.tsx`: historical recording/diagram exploration without mutation
  controls. Current-run details open the existing advanced workspace.
- `use-run-history.ts`: admitted read-only requests, request cancellation and
  refresh while a run is active.
- `model.ts`: ordering, selection and safe application-link presentation.
- `select-run-moment.ts`: one publication for both diagrams.
- `system-follow-context.ts`: prefix-derived physical camera context, separate
  from the exact current execution highlights.
- `RunDeploymentSlot.tsx`, `RunDeploymentScene.tsx`: lazy native step canvas.
- `src/core/run-history-deployment.ts`: bounded scoped projection validation.
- `src/server/run-frame-deployment.ts`: per-publication native projection capture.

The same catalog can present instrumented workflows, checks and agent jobs
through a registered `RunRepository`. The automatic deployment observer does
not infer arbitrary script behavior. A consumer supplies recorded steps and
explicit associations; timestamps, source hashes or nearby events alone do not
establish that two captures belong to the same run.

## Retention and host adapters

The default Node server keeps the latest 12 catalog entries and at most 128
observations per run under its registered private `runs/` directory. It retains
the first and latest observations when the replay limit is reached and discloses
the omitted count. The final native recording is stored once, separately from
the display frames. Older archive files remain available for recovery even when
they leave the bounded list. These limits describe this local viewer, not a
distributed event store.

Checksummed immutable blobs and an atomic index keep each saved summary attached
to its own replay. A conflicting writer or unreadable archive is reported;
deployment continues independently. Reopening history does not reconnect,
recheck or mutate resources. An interrupted viewer capture has an unconfirmed
result until the current registered native execution supplies another observation.

A host can replace local persistence with the framework-neutral contract:

```ts
import type { RunRepository } from 'footprintjs-iac-lens';

const runRepository: RunRepository = {
  list: () => retainedCaptures.readCatalog(),
  read: id => retainedCaptures.readRun(id),
};

await startDashboard({ ...registeredOptions, runRepository });
```

`retainedCaptures` is the host's store, not a bundled service. Supplying the
adapter replaces automatic local collection; the host owns publishing its
captured records. Lens validates the bounded public data contract and never
passes an execution capability to history readers. `createRunHistoryClient`
provides the corresponding read-only HTTP API at `/api/runs` and
`/api/runs/:opaqueId`.
