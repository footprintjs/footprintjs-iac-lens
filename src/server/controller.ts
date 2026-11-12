import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDeploymentRecorder, readDeploymentSchedulePreview } from 'footprint-iac/progress';
import type { InfraGraph } from 'footprint-iac';
import { validateInfraGraph } from 'footprint-iac/graph';
import type { DashboardRun, DashboardState, Scenario } from '../core/types.ts';
import { readSystemViewDefinition, type SystemViewDefinition } from '../core/capabilities.ts';
import { graphArtifacts, cloudFormationExample } from './artifacts.ts';
import { demoGraph } from './graphs.ts';
import { ReviewSimulator, executeRun } from './execute-run.ts';
import type { NeoTarget } from './neo.ts';
import { checkNeoForward, startNeoForward, type NeoForward } from './neo-forward.ts';
import { KubernetesConnectionAdapter } from 'footprint-iac/connections';
import { untestedConnections } from '../core/connections.ts';
import { pendingConnectionReview, readConnectionReview, runConnectionReview, type ConnectionReviewOptions } from './run-connections.ts';
import { pendingIdentity, readIdentityResourceBindings, runIdentityReview, type IdentityReviewOptions } from './run-identity.ts';
import { executeManagedReview, pendingManagedResources, type ManagedReviewOptions } from './execute-managed-review.ts';
import { projectDeploymentSchedulePreview } from '../core/native-deployment-chart.ts';
import { readRevisionReview, type RevisionReviewState } from '../core/revision-review.ts';
import { readRevisionPreparation, type RevisionWorkflowOptions, type RevisionPreparation } from './revision-workflow.ts';
import type { ResourceFlowAction } from '../core/resource-flow.ts';
import { ResourceFlowReview, ResourceFlowRequestError, type ResourceFlowReviewOptions } from './resource-flow.ts';

const verificationAttention = 'The version was applied. Connection or access checks need attention; recorded results are available.';

/** Already-recorded infrastructure supplied by the host; this server does not acquire its mutation credentials. */
export interface InitialReview {
  graph: InfraGraph; run: DashboardRun; target?: DashboardState['target']; neoUrl?: string;
}
export interface ControllerOptions {
  directory: string; neo?: NeoTarget; initialScenario?: 'neo'; readinessDelay?: number;
  identityReview?: IdentityReviewOptions; initialReview?: InitialReview;
  managedReview?: ManagedReviewOptions; systemView?: SystemViewDefinition;
  connectionReview?: ConnectionReviewOptions;
  revisionWorkflow?: RevisionWorkflowOptions;
  resourceFlow?: ResourceFlowReviewOptions;
}

export class RequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export class DashboardController {
  private state: DashboardState;
  private readonly listeners = new Set<() => void>();
  private readonly simulator: ReviewSimulator;
  private completion: Promise<void> = Promise.resolve();
  private activeNeo: NeoTarget | undefined;
  private neoForward: NeoForward | undefined;
  private readonly options: ControllerOptions;
  private identityGraphDigest: string | undefined;
  private connectionGraphDigest: string | undefined;
  private preparedRevision: RevisionPreparation | undefined;
  private resourceFlowReview?: ResourceFlowReview;

  constructor(options: ControllerOptions) {
    if (options.resourceFlow && (options.neo || options.initialScenario || options.managedReview || options.revisionWorkflow
      || options.identityReview || options.connectionReview)) throw Error('Choose one configured resource workflow host');
    if (options.revisionWorkflow && (!options.initialReview || options.managedReview || options.neo)) {
      throw Error('A revision workflow requires one existing recorded deployment');
    }
    if (options.initialReview && (options.neo || options.initialScenario)) throw new Error('Choose an initial recorded review or a managed Neo target');
    if (options.managedReview && (options.neo || options.initialReview || options.initialScenario)) {
      throw new Error('Choose one configured managed review, recorded review or Neo target');
    }
    const managedReview = options.managedReview && { ...options.managedReview,
      graph: validateInfraGraph(options.managedReview.graph) };
    if (managedReview && managedReview.graph.resources.length === 0) throw Error('A managed review needs declared resources');
    if (managedReview?.schedulePreview) {
      managedReview.schedulePreview = readDeploymentSchedulePreview(managedReview.schedulePreview);
      const admitted = projectDeploymentSchedulePreview({ revision: 0, busy: false, graph: managedReview.graph,
        schedulePreview: managedReview.schedulePreview });
      if (!admitted.chart) throw Error('The schedule preview must match the configured resource graph');
    }
    const identityReview = options.identityReview && { ...options.identityReview, checks: structuredClone(options.identityReview.checks),
      resourceBindings: structuredClone(options.identityReview.resourceBindings),
      adapter: Object.freeze({ check: options.identityReview.adapter.check.bind(options.identityReview.adapter) }) };
    this.options = { ...options, identityReview, managedReview,
      ...(options.systemView ? { systemView: readSystemViewDefinition(options.systemView) } : {}),
      initialReview: options.initialReview && structuredClone(options.initialReview) };
    this.simulator = new ReviewSimulator(resolve(options.directory, 'provider.json'), options.readinessDelay);
    if (options.initialScenario === 'neo' && !options.neo) throw new Error('An initial Neo graph requires a prepared target');
    const neo = options.initialScenario === 'neo' ? options.neo : undefined;
    const initialReview = this.options.initialReview;
    const graph = initialReview?.graph ?? managedReview?.graph ?? neo?.binding.graph ?? (options.resourceFlow ? null : demoGraph());
    if (options.connectionReview) {
      validateInfraGraph(graph!);
      this.options.connectionReview = readConnectionReview(options.connectionReview, graph!);
      this.connectionGraphDigest = graph!.digest;
    }
    if (identityReview) {
      identityReview.resourceBindings = readIdentityResourceBindings(identityReview, graph!.resources.map(resource => resource.id));
      if (Object.values(identityReview.resourceBindings ?? {}).some(ids => ids.length > 0)) this.identityGraphDigest = graph!.digest;
    }
    this.state = { revision: 0, graph, busy: false, mode: initialReview?.run.mode ?? managedReview?.mode ?? (managedReview || options.resourceFlow ? 'managed' : neo ? 'kubernetes' : 'simulator'), neoAvailable: !!options.neo,
      ...(managedReview ? { managedReviewAvailable: true, managedReviewLabel: managedReview.label ?? 'Configured system deployment' } : {}),
      ...(this.options.connectionReview ? { connectionReviewAvailable: true } : {}),
      ...(this.options.systemView ? { systemView: this.options.systemView } : {}),
      ...(managedReview?.schedulePreview ? { schedulePreview: managedReview.schedulePreview } : {}),
      ...(initialReview && !options.revisionWorkflow && !options.resourceFlow ? { deploymentReadOnly: true } : {}),
      ...(neo ? { design: neo.design, binding: neo.binding } : {}),
      ...(initialReview?.neoUrl ? { neoUrl: initialReview.neoUrl } : options.neo?.url ? { neoUrl: options.neo.url } : {}),
      target: options.resourceFlow?.target ?? initialReview?.target ?? managedReview?.target ?? (managedReview ? { id: 'managed-review', label: managedReview.label ?? 'Configured local providers' } : neo ? { id: neo.binding.targetId, context: neo.context, namespace: 'footprint-iac-neo-test', label: 'Fresh local Neo Kubernetes target' }
        : { id: 'local-simulator', label: 'Local simulator · no cloud resources' }),
      run: initialReview?.run ?? (graph ? { id: '', status: 'idle', mode: managedReview?.mode ?? (managedReview ? 'managed' : neo ? 'kubernetes' : 'simulator'), resources: this.pending(graph), events: [] } : undefined),
      connections: graph ? this.pendingConnections(graph) : undefined, ...(identityReview ? { identity: pendingIdentity(identityReview) } : {}), artifacts: [] };
  }

  async initialize(): Promise<void> {
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    this.state.artifacts = this.state.graph ? [...await graphArtifacts(this.state.graph), ...await cloudFormationExample()] : [];
    if (this.options.resourceFlow) {
      const options = this.options.resourceFlow;
      this.resourceFlowReview = new ResourceFlowReview(options, publication => {
        this.state.resourceFlow = publication.state; this.state.busy = publication.busy;
        this.state.resourceFlowError = publication.error;
        this.state.neoUrl = publication.state.status === 'passed' ? options.neoUrl : undefined;
        if (publication.artifacts) this.state.artifacts = publication.artifacts;
        if (publication.recording) this.state.recording = publication.recording;
        this.publish();
      });
      await this.resourceFlowReview.initialize();
    }
    if (this.options.revisionWorkflow) {
      this.state.revisionReview = readRevisionReview(await this.options.revisionWorkflow.snapshot());
      if (this.state.revisionReview.current?.graphDigest !== this.state.graph?.digest) throw Error('The recorded deployment does not match the current master revision');
      this.state.artifacts.push(...await this.options.revisionWorkflow.artifacts?.() ?? []);
    }
    this.publish();
  }
  getSnapshot(): DashboardState { return structuredClone(this.state); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  whenIdle(): Promise<void> { return this.completion; }
  dispose(): void { this.resourceFlowReview?.dispose(); }
  startResourceFlow(input: ResourceFlowAction): void {
    if (!this.resourceFlowReview) throw new RequestError(409, 'No resource workflow is configured');
    try { this.resourceFlowReview.action(input); this.completion = this.resourceFlowReview.whenIdle().then(() => this.persist()); }
    catch (error) { if (error instanceof ResourceFlowRequestError) throw new RequestError(error.status, error.message); throw error; }
  }

  start(scenario: Scenario, reviewId?: string): void {
    if (this.options.resourceFlow) throw new RequestError(409, 'This viewer runs only its configured resource workflow');
    if (!['demo', 'failure', 'neo', 'noop', 'connections', 'identity', 'review', 'revision-review', 'revision-apply'].includes(scenario)) throw new RequestError(400, 'Unknown review scenario');
    if (this.state.busy) throw new RequestError(409, 'A deployment is already running');
    if (scenario === 'revision-review' || scenario === 'revision-apply') {
      if (!this.options.revisionWorkflow) throw new RequestError(409, 'No versioned master workflow is configured');
      if (scenario === 'revision-apply' && (!reviewId || reviewId !== this.preparedRevision?.summary.reviewId
        || this.state.revisionReview?.status !== 'ready' || this.state.revisionReview.canApply !== true)) {
        throw new RequestError(409, 'Review the current changes before applying this exact update');
      }
      this.state.busy = true;
      this.completion = (scenario === 'revision-review' ? this.reviewRevision() : this.applyRevision())
        .finally(async () => { this.state.busy = false; this.publish(); await this.persist(); });
      return;
    }
    if (reviewId !== undefined) throw new RequestError(400, 'A review ID belongs only to a versioned update');
    if (scenario === 'connections' && this.options.connectionReview) {
      const graph = this.state.graph;
      if (!graph || graph.digest !== this.connectionGraphDigest) throw new RequestError(409, 'Connection checks are configured for a different resource graph');
      if (this.state.run?.status !== 'passed') throw new RequestError(409, 'Complete the configured deployment before checking connections');
      this.state.busy = true; this.state.connections = this.pendingConnections(graph); this.publish();
      this.completion = this.performConfiguredConnections().finally(async () => {
        this.state.busy = false; this.publish(); await this.persist();
      });
      return;
    }
    if (scenario === 'identity') {
      if (!this.options.identityReview) throw new RequestError(409, 'Identity checks were not configured by this local dashboard host');
      if (this.identityGraphDigest !== undefined && this.state.graph?.digest !== this.identityGraphDigest) {
        throw new RequestError(409, 'Identity checks are configured for a different resource graph');
      }
      if ((this.options.managedReview || this.options.revisionWorkflow) && this.state.run?.status !== 'passed') throw new RequestError(409, 'Complete the configured deployment review before checking identity');
      this.state.busy = true; this.state.identity = pendingIdentity(this.options.identityReview); this.publish();
      this.completion = this.performIdentity().finally(async () => {
        this.state.busy = false; this.publish(); await this.persist();
      });
      return;
    }
    if (this.options.managedReview) {
      if (scenario !== 'review') throw new RequestError(409, 'This dashboard deploys only its configured managed review');
      const managed = this.options.managedReview;
      this.state = { ...this.state, busy: true, neoUrl: undefined, appAccess: undefined,
        run: { id: '', status: 'running', mode: managed.mode ?? 'managed', resources: pendingManagedResources(managed.graph), events: [] },
        connections: this.pendingConnections(managed.graph),
        ...(this.options.identityReview ? { identity: pendingIdentity(this.options.identityReview) } : {}) };
      this.publish();
      this.completion = this.performManaged(managed);
      return;
    }
    if (scenario === 'review') throw new RequestError(409, 'A managed review was not configured by this local dashboard host');
    if (this.options.initialReview) throw new RequestError(409, 'This dashboard displays read-only deployment evidence; infrastructure changes belong to its host');
    if (scenario === 'connections') {
      if (!this.activeNeo || this.state.mode !== 'kubernetes' || this.state.run?.status !== 'passed') {
        throw new RequestError(409, 'Deploy the prepared local Neo target successfully before checking connections');
      }
      const graph = this.state.graph!, neo = this.activeNeo;
      this.state.busy = true; this.state.connections = untestedConnections(graph); this.publish();
      this.completion = this.performConnections(graph, neo).finally(async () => {
        this.state.busy = false; this.publish(); await this.persist();
      });
      return;
    }
    if (scenario === 'neo' && !this.options.neo) throw new RequestError(409, 'Neo was not enabled from a prepared local review');
    if (scenario === 'noop' && this.state.run?.status !== 'passed') throw new RequestError(409, 'Complete a successful run before checking no-op');
    const neo = scenario === 'neo' ? this.options.neo : scenario === 'noop' ? this.activeNeo : undefined;
    const graph = scenario === 'noop' ? this.state.graph! : neo ? neo.binding.graph : demoGraph(scenario === 'failure');
    let identity = this.state.identity;
    if (this.identityGraphDigest !== undefined) {
      identity = graph.digest === this.identityGraphDigest ? pendingIdentity(this.options.identityReview!) : undefined;
    }
    this.activeNeo = neo;
    this.simulator.faults.failBeforeApply = scenario === 'failure' ? new Set(['persistent-store']) : new Set();
    this.state = { ...this.state, graph, identity, busy: true, mode: neo ? 'kubernetes' : 'simulator',
      ...(!neo || neo.freshClaimPath ? { neoUrl: undefined, appAccess: undefined } : {}),
      ...(neo ? { design: neo.design, binding: neo.binding } : { design: undefined, binding: undefined }),
      target: neo ? { id: neo.binding.targetId, context: neo.context, namespace: 'footprint-iac-neo-test', label: 'Prepared local Neo Kubernetes fixture' }
        : { id: 'local-simulator', label: 'Local simulator · provider readiness is deliberately delayed' },
      run: { id: '', status: 'running', mode: neo ? 'kubernetes' : 'simulator', startedAt: new Date().toISOString(), resources: this.pending(graph), events: [] },
      connections: this.pendingConnections(graph),
      ...(this.options.connectionReview ? { connectionReviewAvailable: graph.digest === this.connectionGraphDigest } : {}) };
    this.publish();
    this.completion = this.perform(graph, neo, scenario === 'neo');
  }

  private pending(graph: InfraGraph) { return graph.resources.map(resource => ({ id: resource.id, resourceId: resource.id, status: 'pending' as const })); }

  private async reviewRevision(): Promise<void> {
    this.preparedRevision = undefined;
    this.state.revisionReview = { ...this.state.revisionReview, status: 'reviewing', canApply: false };
    this.publish();
    try {
      const prepared = readRevisionPreparation(await this.options.revisionWorkflow!.review(), this.state);
      this.preparedRevision = prepared;
      this.state.revisionReview = prepared.summary;
      this.state.artifacts = [...await graphArtifacts(this.state.graph!), ...await cloudFormationExample(),
        ...await this.options.revisionWorkflow!.artifacts?.() ?? []];
    } catch {
      this.state.revisionReview = { ...this.state.revisionReview, status: 'failed', canApply: false,
        error: 'The changes could not be reviewed. Check the configured master JSON and local evidence.' };
    }
    this.publish();
  }

  private async applyRevision(): Promise<void> {
    const prepared = this.preparedRevision!;
    this.preparedRevision = undefined; // Each completed review is single-use.
    const managed = prepared.managedReview;
    this.state.revisionReview = { ...prepared.summary, status: 'applying', canApply: false };
    this.state.graph = managed.graph;
    this.state.schedulePreview = managed.schedulePreview;
    this.state.neoUrl = undefined; this.state.appAccess = undefined;
    this.options.connectionReview = prepared.connectionReview;
    this.options.identityReview = prepared.identityReview;
    this.connectionGraphDigest = prepared.connectionReview ? managed.graph.digest : undefined;
    this.identityGraphDigest = prepared.identityReview ? managed.graph.digest : undefined;
    this.state.connectionReviewAvailable = !!prepared.connectionReview;
    this.state.connections = this.pendingConnections(managed.graph);
    this.state.identity = prepared.identityReview ? pendingIdentity(prepared.identityReview) : undefined;
    this.state.run = { id: '', status: 'running', mode: managed.mode ?? 'managed', resources: pendingManagedResources(managed.graph), events: [] };
    this.publish();
    try {
      this.state.artifacts = [...await graphArtifacts(managed.graph), ...await cloudFormationExample()];
      this.state.run = await executeManagedReview(managed, run => { this.state.run = run; this.publish(); });
      if (this.state.run.status === 'passed') {
        await prepared.afterApply?.();
        this.state.neoUrl = managed.neoUrl;
        if (managed.neoUrl) this.state.appAccess = { status: 'ready', checkedAt: new Date().toISOString() };
        if (prepared.connectionReview) await this.performConfiguredConnections();
        if (prepared.identityReview) await this.performIdentity();
      }
      this.state.revisionReview = readRevisionReview(await this.options.revisionWorkflow!.completed(prepared, this.state.run));
      this.refreshRevisionVerification();
      this.state.artifacts.push(...await this.options.revisionWorkflow!.artifacts?.() ?? []);
    } catch {
      // A forward or a verification failure cannot undo an already recorded infrastructure update.
      let summary = { ...prepared.summary, status: 'failed' as const, canApply: false } as RevisionReviewState;
      try { summary = readRevisionReview(await this.options.revisionWorkflow!.completed(prepared, this.state.run!)); } catch { /* Preserve the last admitted definition if its store cannot be read. */ }
      this.state.revisionReview = { ...summary, canApply: false,
        error: summary.status === 'applied'
          ? 'The version was applied. Application verification needs attention; recorded results are available.'
          : 'The update needs attention. Recorded resource outcomes and local revision history are retained.' };
      this.state.appAccess = { status: 'failed', message: 'Check the local application connection and revision evidence.' };
    }
    this.publish();
  }
  private async performManaged(options: ManagedReviewOptions): Promise<void> {
    try {
      this.state.run = await executeManagedReview(options, run => { this.state.run = run; this.publish(); });
      if (this.state.run.status === 'passed' && options.neoUrl) this.state.neoUrl = options.neoUrl;
      if (this.state.run.status === 'passed' && this.options.connectionReview) await this.performConfiguredConnections();
    } finally { this.state.busy = false; this.publish(); await this.persist(); }
  }
  private publish(): void {
    this.state.revision++;
    for (const listener of this.listeners) { try { listener(); } catch { /* A disconnected viewer cannot change a deployment. */ } }
  }

  private async perform(graph: InfraGraph, neo?: NeoTarget, firstCreate = false): Promise<void> {
    const recorder = createDeploymentRecorder();
    const unsubscribeChart = recorder.subscribeChart(chart => {
      this.state.run = { ...this.state.run!, id: chart.runId, chart };
      this.publish();
    });
    const unsubscribe = recorder.subscribe(event => {
      const projected = recorder.getSnapshot();
      this.state.run = { ...this.state.run!, id: event.runId,
        resources: graph.resources.map(resource => ({
          ...(projected.resources[resource.id] ?? { resourceId: resource.id, status: 'pending' as const }), id: resource.id })),
        events: [...projected.events] };
      this.publish();
    });
    try {
      this.state.artifacts = [...await graphArtifacts(graph), ...await cloudFormationExample()];
      this.publish();
      const completed = await executeRun({ graph, directory: this.options.directory, recorder, simulator: this.simulator,
        ...(neo ? { neo } : {}), requireFreshCreate: firstCreate });
      this.state.run = { ...this.state.run!, id: completed.result.runId,
        status: completed.result.ok ? 'passed' : 'failed', finishedAt: new Date().toISOString(),
        ...(completed.recording ? { recording: completed.recording } : {}),
        report: { ok: completed.result.ok, evidencePath: completed.result.evidencePath,
          tracePath: completed.result.tracePath, traceStatus: completed.result.traceStatus,
          failure: completed.result.failure, results: completed.result.results,
          ...(completed.captureError ? { captureError: completed.captureError } : {}) } };
      if (completed.result.ok && neo) {
        if (this.options.connectionReview) await this.performConfiguredConnections();
        else await this.performConnections(graph, neo);
        if (this.options.identityReview) await this.performIdentity();
        if (neo.freshClaimPath) await this.openNeo(neo);
      }
    } catch (error) {
      this.state.run = { ...this.state.run!, status: 'failed', finishedAt: new Date().toISOString(),
        report: { error: error instanceof Error ? error.message : String(error),
          coverage: 'Resource status shows only recorded outcomes; missing outcomes remain unknown.' } };
    } finally {
      unsubscribe(); unsubscribeChart(); this.state.busy = false; this.publish();
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    try { await writeFile(resolve(this.options.directory, 'latest.json'), JSON.stringify(this.state, null, 2) + '\n', { mode: 0o600 }); }
    catch (error) {
      if (this.state.resourceFlow) this.state.resourceFlowError = 'The viewer snapshot could not be saved. The native workflow store remains authoritative.';
      else this.state.run = { ...this.state.run!, report: { deploymentReport: this.state.run?.report,
        viewerPersistenceError: error instanceof Error ? error.message : String(error) } };
      this.publish();
    }
  }

  private async performConnections(graph: InfraGraph, neo: NeoTarget): Promise<void> {
    try {
      await runConnectionReview({ graph, directory: this.options.directory,
        adapter: new KubernetesConnectionAdapter({ context: neo.context, kubeconfig: neo.kubeconfig,
          namespace: 'footprint-iac-neo-test', container: 'node', path: '/health', timeoutMs: 3_000 }),
        update: connections => { this.state.connections = connections; this.publish(); } });
    } catch (error) {
      this.state.connections = { ...untestedConnections(graph), status: 'failed', checkedAt: Date.now(),
        report: { error: error instanceof Error ? error.message : String(error) } }; this.publish();
    }
  }

  private pendingConnections(graph: InfraGraph) {
    return pendingConnectionReview(graph, graph.digest === this.connectionGraphDigest ? this.options.connectionReview : undefined);
  }

  private async performConfiguredConnections(): Promise<void> {
    const review = this.options.connectionReview, graph = this.state.graph;
    if (!review || !graph || graph.digest !== this.connectionGraphDigest) return;
    await runConnectionReview({ ...review, graph, directory: this.options.directory,
      update: connections => { this.state.connections = connections; this.publish(); } });
    this.refreshRevisionVerification();
  }

  private async performIdentity(): Promise<void> {
    if (!this.options.identityReview) return;
    if (this.identityGraphDigest !== undefined && this.state.graph?.digest !== this.identityGraphDigest) return;
    await runIdentityReview({ ...this.options.identityReview, directory: this.options.directory,
      update: identity => { this.state.identity = identity; this.publish(); } });
    this.refreshRevisionVerification();
  }

  private refreshRevisionVerification(): void {
    const revision = this.state.revisionReview;
    if (revision?.status !== 'applied') return;
    const checks = [this.options.connectionReview && this.state.connections, this.options.identityReview && this.state.identity].filter(Boolean);
    if (checks.some(check => check && (check.status === 'failed' || check.report?.captureError))) {
      this.state.revisionReview = { ...revision, error: verificationAttention };
    } else if (checks.every(check => check && check.status === 'passed') && revision.error === verificationAttention) {
      const { error: _error, ...recovered } = revision;
      this.state.revisionReview = recovered;
    }
  }

  private async openNeo(neo: NeoTarget): Promise<void> {
    this.state.appAccess = { status: 'checking' }; this.state.neoUrl = undefined; this.publish();
    try {
      if (this.neoForward?.context === neo.context) {
        try { this.neoForward.checkedAt = await checkNeoForward(this.neoForward); }
        catch { this.neoForward.stop(); this.neoForward = undefined; }
      }
      if (!this.neoForward || this.neoForward.context !== neo.context) {
        this.neoForward = await startNeoForward({ context: neo.context, kubeconfig: neo.kubeconfig, directory: this.options.directory });
      }
      this.state.neoUrl = this.neoForward.baseUrl + '/?test';
      this.state.appAccess = { status: 'ready', checkedAt: this.neoForward.checkedAt };
    } catch (error) {
      this.state.appAccess = { status: 'failed', message: error instanceof Error ? error.message : String(error) };
    }
    this.publish();
  }
}
