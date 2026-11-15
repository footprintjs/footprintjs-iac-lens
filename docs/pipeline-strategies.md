# Release pipelines in InfraChart Lens

Lens is a local consumer of the base library. Its host registers release choices, strategy option schemas, acceptance suites and schedule presets. The browser selects only these IDs and bounded declarative values. Adapter instances, repository access, paths, commands, targets and credentials stay in the host. The local server still uses loopback, host/origin and JSON validation; this is not a public customer authorization service.

`PipelineReviewOptions` from `footprintjs-iac-lens/server` accepts:

- `catalog`: safe `PipelineCatalog` metadata. A source version and a prepared, content-addressed release are different kinds. Prepared choices require a manifest digest.
- `prepare(selection)`: resolve the registered choices to a `PipelineWorkflowPort` and compiled plans from `compileRolloutPlans`. This prepares an unstarted immutable attempt and must not run deployments. Unsupported adapter operations or options must fail compilation.
- `current`: optional existing attempt and its selection for inspecting a retained execution or continuing an explicit durable promotion/recovery gate. Stored running attempts are shown as uncertain, without pretending this viewer owns an active process.
- `subscribePublication`: optional native resource/system observations, using the same restricted publication fields as delivery hosts. This keeps the existing system diagram and its native evidence separate from the pipeline.
- `loadRecording(state, stageId)`: optionally load a bound recording with the base library's `loadPipelineRecording`, checking run, definition, execution and stage identities. Lens also verifies the returned snapshot run ID against that stage’s latest completed receipt. Never return private adapter metadata.

The framework-neutral client has `pipeline(action)` and the state protocol has `state.pipeline`. Preview requests contain only `{ action: 'preview', pipelineId, selection }`. A successful preview issues an exact digest used by `start`; changing the draft requires another preview. Promotion/recovery requests contain execution and stage IDs. Gate tokens are retained on the host and taken from the current native pending action; the browser cannot supply or override them.

Configuration preview and actual recorded deployment are labelled separately. Stage statuses, checks, simple progress messages and operation details come from native workflow state and receipts. No progress timers run in the UI. The existing system chart, resource details, connections and access views are retained when the host publishes them. Each attempt retains its completed outcome; opening another release uses a new host-created attempt rather than replaying writes.

Optional schedule IDs are host-approved configuration. A host offering these choices must register them with the base trigger/monitoring runtime and expose recorded check results; a selected schedule alone does not prove a monitor is running. The example intentionally offers no schedules. Rollback restores the previous verified application release only when the adapter supports it and a verified baseline exists; it makes no claim to reverse database migrations or data writes.

## Local simulator example

Build the sibling base library first, then in this repository:

```sh
npm run check
npm test
npm run build
node examples/pipeline-strategies.ts /tmp/iac-lens-pipeline-example 0
```

Open the printed loopback URL. This example is explicitly labelled **Simulation**; it does not deploy Neo or change cloud/Kubernetes infrastructure. It creates baseline verification through the same native pipeline workflow, then offers immutable prepared release choices and multiple registered strategies.

1. Choose **Example update**, use **Set up stages** to choose direct, gradual traffic, separate environment or the registered custom strategy.
2. Press **Preview**. Inspect the configuration graph; recorded steps remain empty until execution.
3. Press **Start deployment**. Development runs, then Gamma waits for explicit approval.
4. Press **Deploy to Gamma**, then **Deploy to Production**. Inspect environment cards and their native recordings.
5. Restart with a new temporary directory and choose **Example with a failed Gamma check**. Promote Gamma, inspect the failed native check, and press **Restore previous version**. Production remains pending and the failed rollout remains in the evidence history.

CI stays off. This example is for contract/UI validation. A real Neo host must register real deployment/check adapters and publish its native system/resource observations; it must not reuse the simulation adapter or claim its checks are application login tests.

## Real Neo consumer

`examples/neo-release-pipeline.ts` composes the same generic Lens surface with the base Neo consumer. It exposes direct updates only. The registered Neo acceptance suite always measures three real connections and seven login/access cases, including expected denial. The UI cannot disable it. Canary, automatic restoration, data rollback and storage replacement are absent from this consumer’s catalog.

The host configuration is a private local JSON file containing `id`, `directory`, `environments` and `releases`. Environment entries contain canonical local `targetPath` values, labels and fixed promotion policies; each has `rollback: "disabled"`. Each release entry contains an admitted immutable manifest, its host-private publication from `createNeoReleasePreparation`, and optionally the prepared build target path. Use the base preparation workflow to create these values; a GitHub source choice alone is not a built release. No browser request can supply these objects or local paths.

```sh
node examples/neo-release-pipeline.ts /private/local/neo-host.json --port=0
```

The consumer must point at an explicitly prepared local target with a complete native deployment baseline. Its current system view uses that baseline and then follows real native resource, connection and access observations during deployment. Click **Preview**, inspect the exact prepared version and configured stage sequence, then **Start deployment**; manual stages require explicit promotion. Open an environment to inspect its actual operations and bound native recording. The main system diagram retains its own resource/connection/identity drilldown.

The Lens host retains the current attempt descriptor and reloads it for inspection or an outstanding explicit promotion gate. Stored running attempts are uncertain and are never blindly replayed. For a separately reviewed new release attempt, restart with `--new-attempt`; this changes the selected attempt pointer only after a new preview and retains prior native attempt files. It does not reset the base target ledger, delete infrastructure, bypass uncertainty or retry provider writes.
