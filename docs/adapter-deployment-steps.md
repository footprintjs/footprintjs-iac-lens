# Recorded adapter deployment steps

The Deployment flow opens native adapter subflows when the configured host publishes a matching deployment chart. It keeps the physical resource count unchanged: a single systemd service transaction can contain many real recorded stages, while databases or directories that already existed remain **Existing** in the system view and the deployment footer.

The optional renderer loads only when the expanded view is available. The framework-neutral `projectAdapterDeployment(state, resourceId?)` export supplies resources, scoped stage IDs, mounted subflows, branches, loops, observed runtime IDs and statuses. It invokes no provider and does not schedule work.

## Evidence and progress

Chart structure describes possible steps. A native stage boundary or committed history establishes observed execution. Exact recorded decisions establish excluded branches; a missing stage alone is not evidence that it was skipped. Missing, foreign or incomplete evidence remains unconfirmed. Runtime counters and scope paths preserve repeated stages and mounted charts without merging their local identities.

The configured base-library deployment observer can publish metadata-only native lifecycle recordings while execution is in progress. Consumers explicitly enable this with `createDeploymentRecorder({captureStages:true})`; final retained histories remain expandable without live capture. Neo forwards these recordings through the existing Lens recording protocol. Live callbacks come from actual native stage hooks; the UI uses no elapsed-time progress timers. Full native recordings remain available under Execution evidence.

## Viewing

Compact mode keeps a binary decision and its direct branches in one card. Both branches retain their own status and evidence. Larger selectors remain separate nodes so every branch stays visible. **Show full chart** displays each native node separately. The subflow selector and **Parent flow** navigate the actual mounted chart hierarchy; the renderer never substitutes Compute, Storage or Network categories for execution order.

Click a stage or branch to inspect its resource, deployment run, scoped stage ID, runtime instances and recorded reason. A no-change deployment shows skipped provider work while the parent flow retains its read-only observations and verification. A completed service group never implies that an existing database or external directory was created.

## Live actions inside the running system

Running system cards retain their origin label while showing current adapter actions and measured verification progress. **Existing** describes where a component came from; restarting or checking it does not change that origin. A shared restart is labelled **Restarting service group**, not a separate installation of each displayed component. Check-only existing databases and directories do not inherit a compute group's provisioning actions.

The small meter counts admitted component observations and checks (`completed / total verified`). It is not elapsed time, bytes copied or an invented installation percentage. A provisional action can be live while verification remains incomplete. Parallel actions remain plural, and individual actions are listed in the component's evidence panel.

**Show deployment step** opens the exact mounted native scope and execution in Deployment flow. The framework-neutral `resolveTopologyDeploymentStep()` matches the admitted native run, resource and complete runtime-stage identity; it does not search labels. Missing, foreign, stale, ambiguous or skipped execution evidence produces no link. A new run revalidates a previously selected step so old green evidence cannot be reused. The same action link works from Simple mode and opens the detailed deployment view on demand.

The reviewed deployment button is available in both graph tabs. This lets a user keep Running system visible throughout the real deployment without duplicating the workflow or starting another executor. Full action and verification records remain under Execution evidence.
