# Optional Agents workspace

Lens can show an application's real agents beside its infrastructure. It loads
this workspace only when the viewer chooses **Agents**. The infrastructure
workspace continues to work without an agent catalog or React adapter.

The feature separates **Infrastructure → Execution environment → Agent**.
Infrastructure status comes from the current admitted native deployment and its
graph/target binding. Environment and agent readiness come from the app's native
readiness workflow. A deployment alone cannot establish agent readiness.

## Trusted host port

Add an `agentPlatform` object or async factory to the existing `ApplicationHost`.
The factory and server review are not loaded during initial infrastructure setup.
It implements the public `AgentPlatformHost` type from
`footprintjs-iac-lens/server`:

```ts
{
  version: 1, id: 'company-agents', label: 'Company agents',
  async snapshot(context) { /* read retained, admitted native records only */ },
  async check(agentId, context, publish) { /* explicit native readiness + fixed probe */ }
}
```

The app owns catalog, immutable revisions, primitive provider adapters, private
authentication, probes and durable operation ownership. Its `snapshot` must not
authenticate, contact a provider, enumerate conversations or invoke an agent.
`check` must reserve durable intent before effects and block a second attempt if
an earlier effect is uncertain. A restarted viewer is not authorization to retry.

The base library's optional `footprintjs-iac/agent-platform/node` composes the
existing recorded ResourceFlow workflow: Create/Find → connection details or
human pause → Connect → Verify. It supplies native checkpoints and immutable
revision/graph admission. Lens is a viewer and explicit action boundary; it does
not introduce another deployment or agent orchestration engine.

## Safe public observations

Public `AgentPlatformView` types and readers live in the headless Lens core.
They contain stable identities, status, stage metadata and opaque native proof
references. Never include prompts, answers, tool inputs/results, bearer tokens,
artifact tickets, filesystem paths or raw recordings. Turn evidence is admitted
by the app under the same conversation and principal that created it. The Lens
endpoint accepts only open, refresh, or check with a registered agent ID.

A deployment recording reference uses the dashboard's domain deployment run ID;
the admitted recording retains its separate native FootPrint runtime ID. They
are not interchangeable. A changed graph or target invalidates current readiness,
capability proofs and conversation display until the source supplies matching
records. Old native records remain retained by their owner.

Unknown, incomplete, paused and unsupported are distinct from success. Required
capabilities need measured native proof. This first feature does not implement a
durable conversation scheduler, revision routing, isolated conversation sandboxes
or process-memory snapshots. An adapter cannot promise these by declaration.

## UI and adapters

The built dashboard lazy-loads its agent feature. Embedders can independently
lazy-load `footprintjs-iac-lens/react/agents` and its stylesheet; React remains an
optional adapter over the framework-neutral view. Other frameworks consume the
same core types/client and host endpoint. Simple mode uses short status labels;
Details exposes complete join identities and recorded stage summaries.

Neo's consumer bridge is documented in its `infra/agent-platform/README.md`.
It registers one logical triage agent, preserves its native skills/subflows,
and observes actual authenticated AG-UI runs. A local scripted model/seeded-data
test must retain that provenance; it does not establish production readiness.
