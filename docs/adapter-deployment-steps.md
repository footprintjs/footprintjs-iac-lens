# Recorded adapter deployment steps

The Deployment flow opens native adapter subflows when the configured host publishes a matching deployment chart. It keeps the physical resource count unchanged: a single systemd service transaction can contain many real recorded stages, while databases or directories that already existed remain **Existing** in the system view and the deployment footer.

The optional renderer loads only when the expanded view is available. The framework-neutral `projectAdapterDeployment(state, resourceId?)` export supplies resources, scoped stage IDs, mounted subflows, branches, loops, observed runtime IDs and statuses. It invokes no provider and does not schedule work.

## Evidence and progress

Chart structure describes possible steps. A native stage boundary or committed history establishes observed execution. Exact recorded decisions establish excluded branches; a missing stage alone is not evidence that it was skipped. Missing, foreign or incomplete evidence remains unconfirmed. Runtime counters and scope paths preserve repeated stages and mounted charts without merging their local identities.

The configured base-library deployment observer can publish metadata-only native lifecycle recordings while execution is in progress. Consumers explicitly enable this with `createDeploymentRecorder({captureStages:true})`; final retained histories remain expandable without live capture. Neo forwards these recordings through the existing Lens recording protocol. Live callbacks come from actual native stage hooks; the UI uses no elapsed-time progress timers. Full native recordings remain available under Execution evidence.

## Viewing

Compact mode keeps a binary decision and its direct branches in one card. Both branches retain their own status and evidence. Larger selectors remain separate nodes so every branch stays visible. **Show full chart** displays each native node separately. The subflow selector and **Parent flow** navigate the actual mounted chart hierarchy; the renderer never substitutes Compute, Storage or Network categories for execution order.

Click a stage or branch to inspect its resource, deployment run, scoped stage ID, runtime instances and recorded reason. A no-change deployment shows skipped provider work while the parent flow retains its read-only observations and verification. A completed service group never implies that an existing database or external directory was created.
