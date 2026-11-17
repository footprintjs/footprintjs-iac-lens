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

**New run** opens the existing registered setup controls. With onboarding, these
are the same native workflow and sealed review/Deploy actions used elsewhere;
there is no second executor or automatic chain. A new deployment run identity
closes setup and follows the corresponding catalog entry once admitted.

## Replay and live state

The range control selects actual `RunRecord.frames`, in sequence. It never calls
an execution endpoint, mutates desired configuration, or creates intermediate
states. **Recorded steps** is the default when clock coverage is incomplete.
Complete native clocks allow the slider to display the recorded elapsed time.
The Play control is labelled **Step replay** and advances existing observations
at a reading pace; it does not claim the original wall-clock speed. **Live**
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
  playback cursor and quiet scene.
- `RunDetails.tsx`: historical recording/diagram exploration without mutation
  controls. Current-run details open the existing advanced workspace.
- `use-run-history.ts`: admitted read-only requests, request cancellation and
  refresh while a run is active.
- `model.ts`: ordering, selection and safe application-link presentation.
- `select-run-moment.ts`: one publication for both diagrams.
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
