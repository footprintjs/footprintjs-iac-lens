# Assessed stateful migrations in Lens

The provider-aware assessment is read-only. It reports provider observations, a disposition, reason codes and required safeguards at one point in time. It neither applies a resource change nor guarantees that a later provider operation will succeed. A change requiring replacement does not become a safe data migration merely because a provider reports `replace`.

The independent migration view follows a protected native flow: inspect the source, pause cooperating writers, save a verified backup, prepare another store, move and check data, await explicit cutover approval, switch the app, check the app, keep the previous store and resume writes. Each displayed operation is taken from the base FootPrint workflow. Pure planned steps and read-only assessment results are labelled separately from actual execution. There is no deletion control and no progress timer.

`MigrationReviewOptions` from `footprintjs-iac-lens/server` registers:

- Safe `id`, `label`, `scopeLabel` and a bounded list of plan IDs/labels/descriptions.
- A native `ChangeAssessmentWorkflowPort`. Its full definition and resource values stay on the host; only the public sealed report and safe progress are sent to the browser.
- `prepare(planId, report)`, resolving the approved ID and full admitted report to `{ workflow: MigrationWorkflowPort, plan: MigrationPlan }`. It must not execute migration effects. Pass the full sealed assessment to the base workflow and validate its resource, source scope and provider decision in the consumer.
- Optional `current` to reopen the same immutable migration and its explicit durable gate. Stored running attempts are shown as uncertain; Lens does not replay them.
- Optional bound native-recording loaders and host-only system publications. Provider internals and private metadata are not browser state.

The framework-neutral protocol exposes `state.migration` and `client.migration(action)`. HTTP requests accept only registered host/plan IDs and exact current review, assessment or execution digests/IDs. Source/destination paths, SQL, commands, secrets, provider targets, gate tokens and checkpoint bodies cannot be submitted by the browser. The server pins the assessment definition/report and migration definition/plan, checks every native subscription and final return, and retains gate tokens on the host. Unexpected bindings are quarantined for inspection. The local server still uses loopback, host/origin and JSON admission; this is not public customer authentication.

Only a current native cutover gate with a saved backup, checked data, held writer fence and original active store offers **Approve switch**. A failed or unknown effect cannot become an enabled approval or successful progress. Recovery appears only when the base adapter establishes the original consumer/data contract. Some post-switch failures correctly require inspection and keep writes paused instead of offering an unsafe restoration.

## Real local SQLite example

Build the sibling base library, then run the normal Lens checks/build locally. CI stays off.

```sh
npm run check
npm test
npm run build
node examples/sqlite-migration.ts /tmp/lens-sqlite-success-unique --port=0
```

This is a **real SQLite fixture with an explicitly cooperating consumer**, independent of Neo and cloud infrastructure. The fixture has separate owned source/candidate files, real users/conversations/messages, registered read/write programs and a real schema transformation. SQL programs and filesystem handles exist only in trusted host code. The registered offline replacement policy is a host contract, not a claim that SQLite universally cannot alter a schema in place. A durable single-host fence protects cooperating writers; privileged or unrelated writers require another adapter and isolation mechanism.

1. Open the printed loopback URL and choose **Review changes**. Inspect the read-only report. No candidate store is created by assessment or preview.
2. Choose **Preview move**, then **Start migration**. Native operations create a backup and candidate, transfer actual data and compare every preserved field and stable ID under the registered invariants.
3. At **Await approval**, the app still reads the original store and cooperating writes are blocked. Inspect the native prepare recording. Restarting the same example directory reopens this exact durable gate without repeating the completed effects.
4. Choose **Approve switch**. The app resolves the atomic candidate pointer, runs the registered app check, retains the original file and resumes writes only after successful verification.
5. **Details** opens the safe assessment, planned flow, recorded operations and latest bound FootPrint segment.

The sample also provides registered failure profiles. Use a fresh unique owned directory for each scenario; failed candidates, original files, backups and evidence are retained.

```sh
node examples/sqlite-migration.ts /tmp/lens-sqlite-bad-data-unique --scenario=bad-data --port=0
node examples/sqlite-migration.ts /tmp/lens-sqlite-app-failure-unique --scenario=consumer-failure --port=0
```

`bad-data` deliberately alters one preserved message through a fixed host program. Data verification fails, cutover stays unavailable, and the original remains active under the fence. **Resume original app** is offered only for the established safe recovery path; it resumes the original consumer and retains the failed candidate.

`consumer-failure` deliberately fails the registered app check after switching. The UI accurately shows the new active store, paused writes and **Needs inspection**. It offers no automatic pointer restoration, deletion or blind retry.

The public host helper `createSqliteMigrationHost(directory, { scenario })` returns `{ host, fixture }` for local tests. The fixture's `readSummary()` and `appendExampleMessage()` use actual registered SQLite consumer programs; tests verify blocked writes at the gate, records and ownership relationships after cutover, and new writes after resumption. Raw conversation rows never enter Lens or native trace summaries.
