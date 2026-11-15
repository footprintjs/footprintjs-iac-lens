# Application-owned deployment hosts

Lens provides the setup interface. The consuming application owns its deployment
controller, adapters, admitted targets, credentials and durable native records.
The host bridge connects them without adding application-specific logic to Lens.

This guide describes the planned `footprintjs-iac-lens@0.2.0-alpha.2` and
`footprintjs-iac@0.5.0-alpha.2` milestone. The npm commands apply after those
versions are published; this guide is not a publication or test-results report.
Use Node.js 24 or newer.

## Install and start

Install the packages in the consuming application. Neither a Lens checkout nor a
sibling core source checkout is required:

```sh
npm install --save-exact footprintjs-iac@0.5.0-alpha.2 footprintjs-iac-lens@0.2.0-alpha.2
npx footprintjs-iac-lens@0.2.0-alpha.2 --host ./infra/lens-host.mjs --directory ./.private/lens --port 0
```

`infra/lens-host.mjs` is the application's own implementation of the contract
below. It is not included in Lens. Open the printed loopback URL. Port `0` asks
the operating system for an available port; `server.json` records the chosen URL
in the selected state directory.

The operator supplies `--host` as a local `.mjs`, `.js` or `.ts` file. Lens
resolves its real path and calls the named `createApplicationHost` export once
with an absolute private state directory. TypeScript hosts must be executable by
the selected Node runtime; compile hosts that need transformations beyond its
supported TypeScript syntax. Imports in the host resolve from that module's
location. Use installed public package exports rather than another repository's
source files.

The module executes with the local operator's privileges. Choose trusted code
through the CLI; browser requests cannot select modules. `--host` is mutually
exclusive with `--neo`, `--fresh-neo` and `--core-root`. Loading or initialization
failure stops startup with a safe error rather than falling back to simulation.
Starting Lens without a host retains the explicitly labelled simulator.

## Factory and registered choices

The public types are exported by `footprintjs-iac-lens/server`; browser-facing
types are exported by `footprintjs-iac-lens/core`. The factory has this TypeScript
signature; it must return a real host composed by the application:

```ts
import type {
  ApplicationHost,
  ApplicationHostContext,
} from 'footprintjs-iac-lens/server';

export declare function createApplicationHost(
  context: ApplicationHostContext,
): ApplicationHost | Promise<ApplicationHost>;
```

An `ApplicationHost` has `version: 1`, a stable `id`, a safe `label`, an optional
`description`, a nonempty `strategies` catalog, the four methods below and an
optional `connectionProfiles` catalog. Register the catalog in trusted app code;
Lens does not discover arbitrary deployment adapters from customer input.

Each strategy has an `id`, `label`, optional `description` and nonempty `targets`.
Each target declares:

| Field | Meaning |
| --- | --- |
| `id`, `label`, optional `description` | A stable registered choice and safe display text. |
| `requiresProfile` | Whether inspection needs a saved connection. |
| `requiresSource` | Optional boolean: require a complete, target-bound native source-preparation receipt before review and promotion. |
| `profileAdapterIds` | Optional allowlist of connection-adapter IDs offered for this target. |
| `requiredInspectionCheckIds` | Nonempty IDs that must all pass before review or deployment. |
| `requiredVerificationCheckIds` | Nonempty IDs that must all pass before promotion and Ready. |

For example, an application may register **Existing server** through a systemd
adapter and **Kubernetes** through a workload adapter. Each choice points to a
prepared target the application already admits. Only offer supported targets.
This interface does not install Kubernetes, create a machine, infer production
credentials or migrate an application between the two strategies. Core platform
bootstrap is a separate host integration, not a hidden step in this milestone.

## Optional source input

An application can prepare code from GitHub, another Git host or a local Git
repository behind the library's `SourceAdapter` interface. Its existing
`ApplicationHost.inspect` composes the optional
`footprintjs-iac/source-preparation/node` workflow. The native chart resolves the
exact version, gets code, builds a package and stores that package. Target
inspection, review, apply and verification keep the same application host. Do
not register a second independent delivery host alongside it.

The host supplies the source adapter, allowed repository/version, build recipe,
artifact store and private credentials. Browser actions keep accepting only the
registered strategy, target and connection IDs. GitHub Actions are unnecessary.
GitHub is an input adapter; Kubernetes and systemd remain independent deployment
adapters. Changing either does not replace the native FootPrint orchestration.

A source-enabled target sets `requiresSource: true`. Live and retained
`ApplicationPublication.source` values use `ApplicationSourceView`, exported by
the public Lens core. The bounded projection includes:

- Adapter ID, safe label, credential-free HTTPS repository (or `Configured
  repository` for private local paths), ref and exact commit/tree once resolved.
- The selected strategy/target/profile binding, native definition digest, build
  recipe digest and configuration digest.
- Four recorded phases: `resolve`, `fetch`, `build`, `publish`.
- A complete native recording reference and `receiptDigest` for a ready result.

The host computes `receiptDigest` with the library's
`sourcePreparationReceiptDigest` helper after native state admission. This binds
the exact revision, packages and recording. A definition digest alone describes
configured inputs; a mutable branch can later resolve to another commit.

Lens shows **Choose version → Get code → Build package → Store package** in
Simple mode. Details retains full version identities and the native recording
run. Source preparation does not mark resources created or an app promoted.

The source receipt is sealed into the application review. Replacing it during
review or apply invalidates the result. Missing required source proof blocks
review and promotion; a source for another target/profile is refused. The host
must also revalidate its private receipt and exact controller inputs before any
deployment effect. Projection admission does not verify a provider by itself.

Package preparation also does not prove that a running service uses the new
code. A source-enabled target can require a `source-runtime` verification check
alongside health, login and access. Its deployment adapter must measure the
actual image or installed runtime identity against the sealed source receipt.
A systemd restart alone does not install a package. Missing runtime evidence
keeps the application unpromoted and its candidate URL unavailable.

Agent hosts receive the same optional read-only `context.source`. Their
`AgentView.binding.sourceDigest` must match its exact `receiptDigest`. Changing
source hides old component readiness until the promoted runtime and its native
checks match the new source. Agents and their component UI remain lazy-loaded.

Opening, refresh and replay read retained receipts only. Source fetching,
building and publishing run only through explicit inspection. Source checkout
paths, commands, tokens and opaque adapter metadata never enter the browser DTO.

## Inspection, review, deployment and verification

Every method receives the selected registered IDs, not browser-supplied provider
arguments. A selection is `{ strategyId, targetId, profileId? }`.

| Host method | Required behavior and result |
| --- | --- |
| `inspect(selection, publish)` | Inspect the admitted target and compatibility using the application's real controller. Return `{ ok, checks }`, with each check containing `id`, `label` and `status: 'passed' \| 'failed' \| 'unknown'`. An unknown or failed required check blocks review. |
| `plan(selection, publish)` | Prepare a read-only review of the selected desired change. Return `{ ok, reviewId?, changes }`. Each change has `resourceId`, `label` and `action: 'create' \| 'update' \| 'noop' \| 'replace' \| 'delete' \| 'blocked'`. An admitted review needs a sealed `reviewId` and no blocked changes. |
| `apply({ ...selection, reviewId }, publish)` | Revalidate and apply that exact native review, then perform the required real application checks. Return `{ ok, promoted, status, checks?, appUrl? }`. Promotion requires `status: 'promoted'`, `ok: true` and every required verification check passed. Failed or uncertain results stay unpromoted. |
| `snapshot(selection?)` | Read retained native receipts and selection only. Return any available `selection`, `inspection`, `review`, `deployment`, `publication` and `incomplete` fields. It must not discover targets, reconnect services, retry effects or silently deploy. |

The deployment statuses are `promoted`, `blocked`, `apply-failed`,
`verification-failed` and `incomplete`. A successful resource operation alone
does not establish successful application verification. `appUrl` is available
only with a promoted result and must be an HTTP(S) URL without credentials,
query or fragment.

The application's underlying controller owns durable review binding, ownership
checks, revalidation, one-use review consumption, operation locks and
intent-before-effect records. It must enforce them across process restarts.
Lens coordinates the UI: a changed target or profile invalidates the displayed
inspection and review, only the current admitted review can deploy, and actions
run serially. That coordination does not replace the core's durable safeguards.

## Saved connections and secrets

Provide `connectionProfiles` when a target needs a user-entered connection. It
implements the core `ConnectionProfileCatalog` surface: `schemas`, `list`,
`register` and `test`. The adapter-declared schema gives Lens its public and
password fields. The target's adapter allowlist filters available forms and
saved profiles. The host still validates that the selected profile belongs to
the exact target; an adapter ID alone does not establish endpoint admission.

In Lens, select a target, choose **Add connection**, enter its declared fields,
save and select the resulting immutable profile. **Test connection** calls the
registered validation hook. An adapter without a probe reports **Connection
check unavailable**. This optional probe is separate from the deployment's
mandatory recorded Verify checks.

Connection registration is the deliberate exception to ID-only action payloads:
its separate endpoint submits bounded schema-declared settings and secret input
to the local host. Password controls clear on submission; Lens does not retain
them in browser storage or dashboard state. Subsequent selection and deployment
requests contain saved profile IDs, never credential values. Do not include
secrets in public labels, configuration, errors, native publications or traces.

The host chooses its profile repository, secret-store adapter and outbound
endpoint policy. The core includes memory and encrypted local-file adapters;
an application can register its own approved secret backend. File encryption
with a local key is a local storage option, not a managed vault. Keep private
profiles, keys, credentials and receipts out of source control and shared
recordings. See the core
[connection-profile guide](https://github.com/footprintjs/footprintjs-iac/blob/main/docs/connection-profiles.md)
for persistence and adapter contracts.

## Native graph and progress

The `publish` callback accepts `ApplicationPublication` observations from the
host's real FootPrint execution. Methods may also return a final `publication`.
Use the same native graph and recording that the core controller produced;
creating an onboarding host does not justify a second simulated deployment.

Publication supports resource `graph`, native `run` and `recording`, design and
binding data, `schedulePreview`, `systemView`, measured `connections` and
`identity` checks, `changeAssessment`, safe `artifacts` and registered target/app
access metadata. Payloads are validated before admission. Publish a complete
native recording envelope with its run identity; a list of display messages is
not a substitute. Keep credentials and private provider errors out of all fields.
The exact types are in
[`application-host.ts`](../src/server/application-host.ts).

During `apply`, publish `{ phase: 'verify' }` when real verification begins.
Otherwise Lens keeps Deploy running until the host returns an actual outcome.
Do not infer progress from elapsed time or claim success because a request was
accepted. Publications arriving after their operation ends are ignored. A
capture/display fault leaves evidence incomplete and does not undo a provider
operation.

**Simple** presents short labels, setup choices and the same continuous native
resource scene. Grey means pending, blue means recorded work is building and
green requires recorded provider readiness. A no-op stays a measured no-op.
Communication links and login/access checks have independent outcomes; resource
readiness cannot turn an unmeasured connection green.

**Details** retains deployment flow, running system, resource panels, exact
review changes, check IDs, output artifacts and lazy native FootPrint evidence.
The diagram appears when the host supplies it. Missing graph/recording evidence
stays visibly missing; onboarding never substitutes the standalone simulator.

## Private state and uncertain outcomes

`--directory` selects writable operator state, separate from package installation
files. Without it, Lens uses `.artifacts/` under the current working directory.
The CLI creates the directory privately and writes private `server.json`
metadata; Lens also retains its displayed snapshot. The host receives that
directory but owns its own durable deployment records and secret storage. Keep
each host's state stable across restarts. Choosing an empty Lens directory does
not authorize resetting or taking ownership of existing infrastructure.

At startup and on **Refresh status**, Lens calls `snapshot`. A retained running
or unknown effect remains **Result not confirmed**. Refresh reads history; it
does not retry deployment. The host must explicitly report `incomplete: false`
only after its native retained records establish a confirmed result. Omitting
the field cannot clear an earlier uncertainty.

While uncertain, Lens blocks new target/profile choices and further deployments,
even when no selection was restored. Refresh remains available without a
selection. Historical successful checks do not make the current operation Ready
or enable **Open app**. Confirm or reconcile the native outcome through the
application's trusted operational path, then refresh before reviewing a new
change.

The server binds to loopback and validates mutation host/origin and JSON input.
Application actions contain only registered selection IDs, fixed action names
and the sealed review ID. Browser requests cannot submit commands, module paths,
arbitrary targets or provider arguments. This is a local operator interface;
exposing it as a remote customer service requires a separately designed host
authorization and tenancy layer.

## Manual acceptance walkthrough

Use the consuming application's own setup guide to prepare its registered
targets and build/release inputs. This checklist describes expected behavior;
it does not assert that a particular server or application was tested here.

1. Start the packaged Lens CLI with the application's host and a private state
   directory. Confirm its real label and choices appear, with no simulator build
   button or invented resources.
2. Choose the strategy, target and required saved connection. Test it if the
   adapter supports that probe. An invalid connection must block inspection or
   review according to the host's actual checks.
3. Run **Check setup**, then **Review changes**. Inspect create/update/no-op or
   blocked decisions. Changing a target or profile must invalidate that review.
4. Click **Deploy** once. Observe native resource changes and real verification.
   Open the application only after all required checks and promotion pass. Test
   the application's own login and allowed/denied access when those are part of
   its registered acceptance policy.
5. Reopen Lens with the same host/state. Confirm it reads retained receipts
   without replaying writes. A deliberately unconfirmed operation must offer
   Refresh and block deployment/target changes until native status is confirmed.
6. Repeat with another prepared strategy only if the application registers it.
   Selecting Kubernetes must not imply that Lens installed a cluster or migrated
   data from the existing server.

Run checks and publish directly according to the repository's release process;
this onboarding path does not require or enable CI.
