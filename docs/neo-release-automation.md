# Neo updates from GitHub or Lens

The private loopback host in `examples/neo-release-automation.ts` composes
`footprintjs-iac`'s release catalog, build-once preparation, recorded change
assessment, release automation and ordered environment pipeline. Lens shows
real child workflow progress and retains each deployment in History. CI and
GitHub Actions remain off; the running local process performs the work.

## Prepare the host

Keep `footprintjs-iac` and `footprintjs-iac-lens` as sibling checkouts. Use Node.js
24+, the local Docker/kind tools required by the Neo integration and GitHub read
access to the private application repository. Run core typecheck/tests/build,
then Lens typecheck/tests/build directly. This guide describes the current
working-copy candidate; a repository URL alone does not establish that these
unpublished changes are already available from a fresh clone.

Prepare three distinct, healthy, owned Neo identity targets on this laptop.
Use their canonical absolute `target.json` paths; do not copy another laptop's
paths, kubeconfigs, credentials or localhost URLs. The release host upgrades
existing deployments. It does not bootstrap the initial six resources in empty
clusters. Follow the core identity setup and
[`NEO-RELEASE-PIPELINE-HANDOFF.md`](../../footprint-iac/docs/NEO-RELEASE-PIPELINE-HANDOFF.md)
for baseline preparation, source/build receipts and generated login credentials.

Retain `NeoPreparedRelease` baseline records from the actual current builds.
Each record contains its sealed manifest, matching publication and private
`buildTargetPath`. Prefer `prepared()` from a passed release preparation or the
explicit prior-build receipt import documented in that handoff. A new build of
the same source is not proof that it identifies the currently running images.
Use one canonical manifest registration for an identical package shared across
environments. Unknown or ambiguous runtime image identity stops deployment.

## Private host JSON

The CLI accepts only this host configuration shape. It is private trusted
configuration, not browser input:

```ts
{
  id: string,                 // stable host ID, letters/numbers/.-_
  label: string,              // short dashboard name
  directory: string,          // absolute private runtime/evidence directory
  repository: string,         // GitHub owner/repository
  environments: Array<{
    id: string,
    label: string,
    targetPath: string,       // canonical absolute target.json
    promotion: 'automatic' | 'manual',
    rollback: 'disabled'
  }>,
  baselineReleases: Array<{
    manifest: ReleaseManifest,
    publication: DeliveryPublication,
    buildTargetPath?: string
  }>,
  automatic: { enabled: boolean, initial: 'observe' | 'latest' },
  intervalMs: number,         // integer, 30,000 through 3,600,000
  manualSources: ResolvedReleaseChoice[]
}
```

Environment array order is the deployment order. Use `dev`, `gamma` and `prod`
for those stages, and distinct prepared targets for each. The first environment
is the build host. The same sealed package is then loaded/promoted to later
targets without rebuilding. Set all three `promotion: 'automatic'` explicitly
for unattended advancement, or use `manual` on a stage to require its recorded
approval gate. Neo currently requires `rollback: 'disabled'` in every stage;
generic recovery interfaces do not create an unsupported restore capability.

For example, create the real JSON from this laptop's retained baseline records
instead of inventing manifest digests or candidate paths:

```js
import {readFile,writeFile} from 'node:fs/promises';
const baselineReleases = JSON.parse(await readFile('/private/neo-baselines.json','utf8'));
const host = {
  id: 'neo-updates', label: 'Neo software updates',
  directory: '/private/neo-release-runtime',
  repository: 'sanjay1909/neo-agentfootprint',
  environments: [
    {id:'dev', label:'Development', targetPath:'/private/dev/target.json', promotion:'automatic', rollback:'disabled'},
    {id:'gamma', label:'Gamma', targetPath:'/private/gamma/target.json', promotion:'automatic', rollback:'disabled'},
    {id:'prod', label:'Production', targetPath:'/private/prod/target.json', promotion:'automatic', rollback:'disabled'},
  ],
  baselineReleases,
  automatic: {enabled:true, initial:'observe'},
  intervalMs: 60000,
  manualSources: [],
};
await writeFile('/private/neo-release-host.json',JSON.stringify(host,null,2)+'\n',{
  flag:'wx', mode:0o600,
});
```

Replace the schematic `/private/...` locations with this laptop's actual paths.
Keep that file outside the web root and outside shared bundles. Changes to
targets, stage policies, baseline registrations or reviewed source pins change
the host binding; use a separately reviewed runtime directory instead of
rewriting an active attempt's settings. Keep previous directories and evidence.

The GitHub adapter uses `GITHUB_TOKEN` when present, otherwise the existing
`gh auth token` credential. Tokens remain in the host request and never belong
in repository URLs, JSON source choices, browser fields or screenshots. The Git
source adapter uses this laptop's ordinary Git credential configuration.

## Run and deploy

From the Lens checkout after its build:

```sh
node examples/neo-release-automation.ts /private/neo-release-host.json --port=0
```

Open the printed loopback URL. The example immediately schedules its first
finite release check, then schedules another only after the prior check ends.
`initial: 'observe'` records existing published versions as the baseline without
deploying the backlog. `initial: 'latest'` explicitly opts into deploying the
latest existing published version at startup. With automatic mode enabled,
future newly discovered published releases can build and start the configured
pipeline while this host remains running. Closing the host stops its polling;
an interval setting alone is not an external scheduler or always-on service.

In Lens:

1. **Refresh releases** lists current source choices only. It does not build or
   deploy a candidate.
2. Select a version and press **Deploy version** to resolve its exact
   repository/ref/commit/tree, build once and start the fixed environment order.
3. Watch source/build progress and each environment's recorded rollout/checks.
   Every environment runs provider assessment during planning and revalidates
   before application effects. Replacement or unknown compatibility stops the
   candidate instead of silently deleting/recreating resources.
4. If a stage is manual, approve its exact retained gate. Approval continues the
   same package and does not rebuild it.
5. Open **History** and an environment's details to inspect retained operations,
   resource changes, application checks and the native recorded flow. Failures
   remain separate attempts; an uncertain effect is not automatically retried.

One active, gated or uncertain attempt blocks later starts. A known terminal
failure stops automatic newer releases. After inspecting it, a human can choose
a different registered source manually; the failed attempt remains retained.
The same repository/commit/tree is deduplicated even if another tag names it.

## Before the first published release

At the current repository check, Neo has zero published GitHub releases and its
release entry is a draft. Drafts are excluded from the published-release catalog;
the host does not publish anything to manufacture an automatic deployment test.
Use a reviewed pinned source for manual local acceptance until a release is
published through the owner's normal process.

Each `manualSources` entry must have a `reviewed-` ID, no `publishedAt`, and the
same exact HTTPS repository identity as the host. For example, construct one
from a reviewed source pin and add it to the private host JSON:

```js
{
  id: 'reviewed-neo-v2',
  label: 'Reviewed Neo v2 commit · manual',
  version: 'reviewed-commit',
  source: {
    repository: 'https://github.com/sanjay1909/neo-agentfootprint.git',
    ref: '839f6fd726607eb742e76374b94ab8733ef99be2',
    commit: '839f6fd726607eb742e76374b94ab8733ef99be2',
    tree: reviewedTreeHash
  }
}
```

Resolve and review the actual commit/tree through Git before registering it.
`reviewedTreeHash` is a host-preparation variable, not a literal JSON value or a
browser field. A manual source is clearly a reviewed Git source pin; it cannot
masquerade as a published GitHub release. Source preparation independently
resolves the pin again and refuses changed code before fetching/building.

## Current validation and scope

The current working copies pass **486 core tests plus 213 Lens tests: 699**,
with typechecks and builds passing. A real manual Lens deployment built one
reviewed v2 GitHub source version, then updated three local Neo environments in
order. Each environment recorded one app update, five unchanged resources,
three successful connection checks and seven successful identity/access checks.
The same prepared artifacts reached all three. Controlled catalog/native tests
cover automatic new-source initiation, initial backlog exclusion, deduplication,
manual gates and retained failure/uncertainty; a live newly published GitHub
release was not available for that acceptance.

The development laptop's current review URL is
`http://127.0.0.1:52978`; it is a local running process, not a portable deployment
address. Browser acceptance confirmed Alice allowed, Bob authenticated but
denied, and the native observation → capability → policy → safeguard → decision
flow. Simple mode fits the pipeline, running system and checks at 1280×720
without vertical scrolling. A real host restart restored Prod, its original
3/7 check measurements and matching preflight without rebuilding or deploying.
The independent replay audit verified every captured run it inspected with zero
unread entries or gaps, and checked actual Kubernetes UIDs against preflight
identity hashes. Private measured reports and screenshots remain in the
development workspace under `outputs/neo-release-automation/`.

Dev/gamma/prod here are separate local stage targets. Remote production hosting,
verified Neo rollback, database migration and universal schema/data safety are
not configured. Neo uses in-memory application state unless MSSQL is configured;
an infrastructure dry-run does not prove schema compatibility or preserve an
in-memory session through a restart. Assessment and backwalk explain recorded
evidence and decisions; runtime outages and uninstrumented external behavior
can still fail during execution. Keep real data migration explicit when a
supported plan requires it.
