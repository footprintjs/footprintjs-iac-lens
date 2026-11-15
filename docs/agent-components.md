# Component graphs and runtime boundaries

The optional Agents workspace can expand an agent into its actual execution,
state, context and connection components. The framework-neutral protocol is
`AgentComponentGraphView` from the Lens core; React remains a lazy UI adapter.

The trusted application host maps an admitted
`footprintjs-iac/agent-platform/components` projection into this safe view.
`AgentComponentsWorkflow` is the optional Node entry point. Native FootPrint
subflows run the dependency decisions, parallel branches and joins. Each child
uses the recorded Create/Find → details → Connect → Verify lifecycle. A found
existing store does not mean that Lens created a database.

Every component view binds its definition digest, agent revision, deployment,
infrastructure graph and target. The host owns actual resource checks, private
profiles, authentication and durable operation ownership. Browser actions still
accept registered IDs only. Construction, opening, refresh and replay do not
invoke a provider or an agent. A selected unfinished invocation remains uncertain
even if it is optional; a known optional failure is different from an unknown
effect. Refresh does not authorize a retry.

## Visual meaning

- Execution components use a worker/process shape.
- Contexts and conversations use a circle.
- Volatile memory has a RAM shape; persistent stores have a database cylinder.
- Multiple logical roles can share one physical store node.
- Actual runtime placement supplies the enclosing boundaries. Kubernetes may
  report namespace, Pod and containers; systemd reports host and services.
  A declared boundary is labelled Selected until native identity checks admit it.
- Connection edges use their own verified connection component, independently
  from prerequisite arrows and containment. Container existence does not prove
  that the agent sends traffic to it.

Simple mode contracts placement-only intermediate levels for readability while
preserving actual ancestor containment. Details retains the full hierarchy and
native prerequisite graph. Connection-only check nodes appear on their live
edges in Simple and as full components in Details. Inspect any node, edge or
boundary to see the admitted native phase identities and opaque proof references.
Raw prompts, tool arguments/results, credentials and artifact tickets are absent.

## Boundary progress

The outline fills from completed required native work, not elapsed time.
Counts include selected required descendants, the explicitly registered physical
identity anchor and required connection checks associated with that boundary.
Containment is not an execution order. Independent children can progress together.

Grey means pending; blue means active work; green requires measured readiness.
Amber means a pause; red means a known failure. Skipped required work cannot make
an outline ready. A missing capture stays unconfirmed and displays no invented
percentage. Known planned totals may remain in an uncertain observation for
inspection, but the UI does not display a percentage for indeterminate progress.

A physical identity can be verified by a component outside its drawing boundary.
For example, the worker's scoped Pod inspection can establish that a second
container exists and is ready without proving any agent-to-container traffic.
The identityComponentId and matching child recording make that association
explicit. An observed empty boundary shows Identity checked, rather than implying
that work was created inside it.

The first composition uses a finite dependency DAG. Native engine loops can live
inside subflows; this API does not add a cyclic component scheduler, sandbox
implementation, automatic rollback or universal cross-run causal inference.
Parent and child recording references retain explicit links for inspection.
