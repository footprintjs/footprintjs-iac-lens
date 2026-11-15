import {ReleaseAutomationReview,type ReleaseAutomationReviewOptions} from './release-automation.ts';
import type {ReleaseAutomationAction} from '../core/release-automation.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDeploymentRecorder, readDeploymentSchedulePreview } from 'footprintjs-iac/progress';
import type { InfraGraph } from 'footprintjs-iac';
import { validateInfraGraph } from 'footprintjs-iac/graph';
import type { DashboardRun, DashboardState, Scenario } from '../core/types.ts';
import { readSystemViewDefinition, type SystemViewDefinition } from '../core/capabilities.ts';
import { graphArtifacts, cloudFormationExample } from './artifacts.ts';
import { demoGraph } from './graphs.ts';
import { ReviewSimulator, executeRun } from './execute-run.ts';
import type { NeoTarget } from './neo.ts';
import { checkNeoForward, startNeoForward, type NeoForward } from './neo-forward.ts';
import { KubernetesConnectionAdapter } from 'footprintjs-iac/connections';
import { untestedConnections } from '../core/connections.ts';
import { pendingConnectionReview, readConnectionReview, runConnectionReview, type ConnectionReviewOptions } from './run-connections.ts';
import { pendingIdentity, readIdentityResourceBindings, runIdentityReview, type IdentityReviewOptions } from './run-identity.ts';
import { executeManagedReview, pendingManagedResources, type ManagedReviewOptions } from './execute-managed-review.ts';
import { projectDeploymentSchedulePreview } from '../core/native-deployment-chart.ts';
import { readRevisionReview, type RevisionReviewState } from '../core/revision-review.ts';
import { readRevisionPreparation, type RevisionWorkflowOptions, type RevisionPreparation } from './revision-workflow.ts';
import type { ResourceFlowAction } from '../core/resource-flow.ts';
import { ResourceFlowReview, ResourceFlowRequestError, type ResourceFlowReviewOptions } from './resource-flow.ts';
import { readWorkspaceOptions } from './resource-flow-workspace.ts';
import { ConnectionProfilesReview } from './connection-profiles.ts';
import { readConnectionProfileAction, type ConnectionProfileActionResult } from '../core/connection-profiles.ts';
import { RecordedDiagnosticHistory } from './recorded-diagnostics.ts';
import { HostActionReview, HostActionRequestError } from './host-actions.ts';
import type { HostActionInput } from '../core/host-actions.ts';
import { readDashboardState } from '../core/client.ts';
import { MigrationReview,MigrationRequestError,type MigrationReviewOptions } from './migration.ts';
import type { MigrationAction } from '../core/migration.ts';
import type { PipelineAction } from '../core/pipeline.ts';
import { PipelineReview, PipelineRequestError, type PipelineReviewOptions } from './pipeline.ts';
import type { DeliveryAction } from '../core/delivery.ts';
import { DeliveryReview, DeliveryRequestError, type DeliveryReviewOptions, type DeliveryPublication } from './delivery.ts';
import { ApplicationReview, ApplicationRequestError } from './application.ts';
import type { ApplicationHost } from './application-host.ts';
import type { ApplicationAction } from '../core/application.ts';
import { readApplicationPublication } from './application-publication.ts';
import type { AgentPlatformHostProvider, AgentPlatformContext } from './agent-platform-host.ts';
import type { AgentPlatformReview } from './agent-platform-review.ts';
import type { AgentPlatformAction } from '../core/agent-platform.ts';
import { projectAgentPlatformView } from '../core/agent-platform-project.ts';

const verificationAttention = 'The version was applied. Connection or access checks need attention; recorded results are available.';

/** Already-recorded infrastructure supplied by the host; this server does not acquire its mutation credentials. */
export interface InitialReview {
  graph: InfraGraph; run: DashboardRun; target?: DashboardState['target']; neoUrl?: string;
}
export interface ControllerOptions {
  applicationHost?: ApplicationHost;
  agentPlatform?: AgentPlatformHostProvider;
  directory: string; neo?: NeoTarget; initialScenario?: 'neo'; readinessDelay?: number;
  identityReview?: IdentityReviewOptions; initialReview?: InitialReview;
  managedReview?: ManagedReviewOptions; systemView?: SystemViewDefinition;
  connectionReview?: ConnectionReviewOptions;
  revisionWorkflow?: RevisionWorkflowOptions;
  resourceFlow?: ResourceFlowReviewOptions;
  delivery?: DeliveryReviewOptions;
  pipeline?: PipelineReviewOptions;
  migration?: MigrationReviewOptions;
  releaseAutomation?: ReleaseAutomationReviewOptions;
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
  private connectionProfilesReview?: ConnectionProfilesReview;
  private profileCompletion: Promise<unknown> = Promise.resolve();
  private diagnosticHistory?: RecordedDiagnosticHistory;
  private hostActionReview?: HostActionReview;
  private deliveryReview?: DeliveryReview;
  private pipelineReview?: PipelineReview;
  private migrationReview?:MigrationReview;
  private releaseAutomationReview?:ReleaseAutomationReview;
  private applicationReview?: ApplicationReview;
  private agentReview?: AgentPlatformReview;
  private agentActivation?: Promise<void>;
  private agentBusy = false;

  constructor(options: ControllerOptions) {
    if (options.applicationHost && (options.releaseAutomation || options.migration || options.pipeline || options.delivery || options.resourceFlow
      || options.revisionWorkflow || options.managedReview || options.neo || options.initialScenario || options.initialReview || options.identityReview || options.connectionReview)) throw Error('Choose one registered application host');
    if(options.releaseAutomation&&(options.pipeline||options.delivery||options.migration||options.resourceFlow||options.revisionWorkflow||options.managedReview||options.neo||options.initialScenario))throw Error('Choose one configured release automation host');
    if(options.migration&&(options.pipeline||options.delivery||options.resourceFlow||options.revisionWorkflow||options.managedReview||options.neo||options.initialScenario))throw Error('Choose one configured migration host and its recorded system');
    if (options.pipeline && (options.delivery || options.resourceFlow || options.revisionWorkflow || options.managedReview || options.neo || options.initialScenario)) throw Error('Choose one configured pipeline host and its recorded system');
    if (options.delivery && (options.resourceFlow || options.revisionWorkflow || options.managedReview || options.neo || options.initialScenario)) {
      throw Error('Choose one configured delivery host and its existing recorded system');
    }
    if (options.resourceFlow?.workspace) options = { ...options, resourceFlow: { ...options.resourceFlow,
      workspace: readWorkspaceOptions(options.resourceFlow.workspace) } };
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
    const workspace = options.resourceFlow?.workspace;
    const graph = workspace?.graph ?? initialReview?.graph ?? managedReview?.graph ?? neo?.binding.graph ?? (options.applicationHost || options.resourceFlow || options.delivery || options.pipeline || options.migration || options.releaseAutomation ? null : demoGraph());
    if (options.connectionReview) {
      validateInfraGraph(graph!);
      this.options.connectionReview = readConnectionReview(options.connectionReview, graph!);
      this.connectionGraphDigest = graph!.digest;
    }
    if (identityReview) {
      identityReview.resourceBindings = readIdentityResourceBindings(identityReview, graph!.resources.map(resource => resource.id));
      if (Object.values(identityReview.resourceBindings ?? {}).some(ids => ids.length > 0)) this.identityGraphDigest = graph!.digest;
    }
    if (options.agentPlatform && options.applicationHost?.agentPlatform) throw Error('Choose one registered agent host');
    this.state = { revision: 0, graph, busy: false, mode: initialReview?.run.mode ?? managedReview?.mode ?? (options.applicationHost || managedReview || options.resourceFlow || options.delivery || options.pipeline || options.migration || options.releaseAutomation ? 'managed' : neo ? 'kubernetes' : 'simulator'), neoAvailable: !!options.neo,
      ...((options.agentPlatform || options.applicationHost?.agentPlatform) ? { agentPlatformAvailable: true } : {}),
      ...(managedReview ? { managedReviewAvailable: true, managedReviewLabel: managedReview.label ?? 'Configured system deployment' } : {}),
      ...(this.options.connectionReview || workspace ? { connectionReviewAvailable: !!this.options.connectionReview } : {}),
      ...(identityReview || workspace || options.delivery || options.pipeline || options.migration || options.releaseAutomation ? { identityReviewAvailable: !!identityReview } : {}),
      ...(workspace?.systemView || this.options.systemView ? { systemView: workspace?.systemView ?? this.options.systemView } : {}),
      ...(workspace?.schedulePreview || managedReview?.schedulePreview ? { schedulePreview: workspace?.schedulePreview ?? managedReview?.schedulePreview } : {}),
      ...(workspace?.design ? { design: workspace.design } : {}), ...(workspace?.binding ? { binding: workspace.binding } : {}),
      ...(workspace?.revisionReview ? { revisionReview: workspace.revisionReview } : {}),
      ...(initialReview && !options.revisionWorkflow && !options.resourceFlow && !options.delivery && !options.pipeline && !options.migration && !options.releaseAutomation ? { deploymentReadOnly: true } : {}),
      ...(neo ? { design: neo.design, binding: neo.binding } : {}),
      ...(initialReview?.neoUrl ? { neoUrl: initialReview.neoUrl } : options.neo?.url ? { neoUrl: options.neo.url } : {}),
      target: options.resourceFlow?.target ?? initialReview?.target ?? managedReview?.target ?? (managedReview ? { id: 'managed-review', label: managedReview.label ?? 'Configured local providers' } : neo ? { id: neo.binding.targetId, context: neo.context, namespace: 'footprint-iac-neo-test', label: 'Fresh local Neo Kubernetes target' }
        : options.applicationHost ? { id: options.applicationHost.id, label: options.applicationHost.label } : options.releaseAutomation ? {id:'release-automation',label:'Release deployment'} : options.migration ? {id:options.migration.id,label:options.migration.label} : options.pipeline ? { id: options.pipeline.catalog.id, label: options.pipeline.catalog.label } : options.delivery ? { id: options.delivery.id, label: 'Configured deployment target' } : { id: 'local-simulator', label: 'Local simulator · no cloud resources' }),
      run: options.resourceFlow ? undefined : initialReview?.run ?? (graph ? { id: '', status: 'idle', mode: managedReview?.mode ?? (managedReview ? 'managed' : neo ? 'kubernetes' : 'simulator'), resources: this.pending(graph), events: [] } : undefined),
      connections: graph ? this.pendingConnections(graph) : undefined, ...(identityReview ? { identity: pendingIdentity(identityReview) } : {}), artifacts: [] };
  }

  async initialize(): Promise<void> {
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    this.state.artifacts = this.state.graph ? [...await graphArtifacts(this.state.graph), ...await cloudFormationExample()] : [];
    if (this.options.applicationHost) {
      const host = this.options.applicationHost;
      if (host.connectionProfiles) {
        this.connectionProfilesReview = new ConnectionProfilesReview(host.connectionProfiles, false, view => { this.state.connectionProfiles = view; this.publish(); });
        await this.connectionProfilesReview.initialize();
      }
      this.applicationReview = new ApplicationReview(host, (view, publication) => {
        if (publication) {
          const patch = readApplicationPublication(publication, this.state);
          const admitted = readDashboardState({ ...this.state, ...patch, application: view, busy: view.busy || this.agentBusy });
          if (admitted.graph) validateInfraGraph(admitted.graph);
          this.state = admitted;
        } else { this.state.application = view; this.state.busy = view.busy || this.agentBusy; }
        this.publish();
      }, () => this.state.connectionProfiles?.profiles ?? []);
      await this.applicationReview.initialize();
    }
    if (this.options.resourceFlow?.connectionProfiles) {
      this.connectionProfilesReview = new ConnectionProfilesReview(this.options.resourceFlow.connectionProfiles,
        this.options.resourceFlow.connectionProfileRequiredAtStart ?? this.options.resourceFlow.workflow.requiresProfileAtStart ?? false,
        view => { this.state.connectionProfiles = view; this.publish(); });
      await this.connectionProfilesReview.initialize();
    }
    if (this.options.resourceFlow) {
      const options = this.options.resourceFlow;
      const workspaceArtifacts = options.workspace ? this.state.artifacts : undefined;
      this.resourceFlowReview = new ResourceFlowReview(options, publication => {
        this.state.resourceFlow = publication.state; this.state.busy = publication.busy || this.hostActionReview?.isBusy === true;
        this.state.resourceFlowError = publication.error;
        if (options.workspace) {
          const available = publication.state.status === 'passed' && !publication.busy && !publication.error;
          this.state.connectionReviewAvailable = available && !!options.workspace.recheckConnections;
          this.state.identityReviewAvailable = available && !!options.workspace.recheckIdentity;
        }
        this.state.neoUrl = publication.state.status === 'passed' ? options.neoUrl : undefined;
        if (publication.artifacts) this.state.artifacts = workspaceArtifacts
          ? [...new Map([...workspaceArtifacts, ...publication.artifacts].map(artifact => [artifact.id, artifact])).values()]
          : publication.artifacts;
        if (publication.recording) {
          this.state.resourceFlowRecording = publication.recording;
          if (!options.workspace) this.state.recording = publication.recording;
        }
        if (publication.workspace) {
          this.state.resourceFlowWorkspace = publication.workspace;
          this.state.run = publication.workspace.children.at(-1)?.run;
          this.state.recording = this.state.run?.recording;
          this.state.connections = publication.workspace.connections ?? this.pendingConnections(options.workspace!.graph);
          this.state.identity = publication.workspace.identity;
        }
        this.publish();
      });
      await this.resourceFlowReview.initialize();
      if (options.controls) {
        this.hostActionReview = new HostActionReview(options.controls, view => { this.state.hostActions = view; this.state.busy = view.busy; this.publish(); });
        this.state.hostActions = this.hostActionReview.snapshot();
      }
    }
    if (this.options.revisionWorkflow) {
      this.state.revisionReview = readRevisionReview(await this.options.revisionWorkflow.snapshot());
      if (this.state.revisionReview.current?.graphDigest !== this.state.graph?.digest) throw Error('The recorded deployment does not match the current master revision');
      this.state.artifacts.push(...await this.options.revisionWorkflow.artifacts?.() ?? []);
    }
    if (this.options.delivery) {
      this.deliveryReview = new DeliveryReview(this.options.delivery, view => {
        this.state.delivery = view; this.state.busy = view.status === 'running' || this.deliveryReview?.isBusy === true; this.publish();
      }, patch => this.deliveryPublication(patch));
      await this.deliveryReview.initialize();
    }
    if (this.options.pipeline) {
      this.pipelineReview = new PipelineReview(this.options.pipeline, view => { this.state.pipeline=view; this.state.busy=view.busy; this.publish(); }, patch=>this.deliveryPublication(patch));
      await this.pipelineReview.initialize();
    }
    if(this.options.migration){
      this.migrationReview=new MigrationReview(this.options.migration,view=>{this.state.migration=view;this.state.busy=view.busy;this.publish();},patch=>this.deliveryPublication(patch));
      await this.migrationReview.initialize();
    }
    if(this.options.releaseAutomation){
      this.releaseAutomationReview=new ReleaseAutomationReview(this.options.releaseAutomation,view=>{this.state.releaseAutomation=view;this.state.busy=view.busy;this.publish();},patch=>this.deliveryPublication(patch));
      await this.releaseAutomationReview.initialize();
    }
    this.diagnosticHistory = new RecordedDiagnosticHistory(this.options.directory, () => this.publish());
    await this.diagnosticHistory.initialize(this.state);
    this.publish();
  }
  getSnapshot(): DashboardState {
    const state = structuredClone(this.state);
    if (state.agentPlatform) state.agentPlatform = projectAgentPlatformView(state.agentPlatform, state);
    state.busy ||= this.agentBusy;
    return state;
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async whenIdle(): Promise<void> {
    await Promise.all([this.completion, this.profileCompletion, this.applicationReview?.whenIdle(), this.hostActionReview?.whenIdle(), this.deliveryReview?.whenIdle(), this.pipelineReview?.whenIdle(),this.migrationReview?.whenIdle(),this.releaseAutomationReview?.whenIdle(), this.agentActivation]);
    await this.agentReview?.whenIdle();
    await this.diagnosticHistory?.whenIdle();
  }
  dispose(): void { this.agentReview?.dispose(); this.resourceFlowReview?.dispose(); this.deliveryReview?.dispose(); this.pipelineReview?.dispose();this.migrationReview?.dispose();this.releaseAutomationReview?.dispose(); }
  private agentContext(): AgentPlatformContext {
    return structuredClone({ graph: this.state.graph, application: this.state.application, source: this.state.source, run: this.state.run, target: this.state.target });
  }
  private requireAgentIdle(): void { if (this.agentBusy) throw new RequestError(409, 'Wait for the current agent check'); }
  async agentPlatformAction(input: AgentPlatformAction): Promise<void> {
    const provider = this.options.agentPlatform ?? this.options.applicationHost?.agentPlatform;
    if (!provider) throw new RequestError(409, 'No agent host was registered');
    if (input.action === 'check' && (this.state.busy || this.connectionProfilesReview?.isBusy())) throw new RequestError(409, 'Wait for the current deployment or connection setup');
    const feature = await import('./agent-platform-review.ts');
    if (!this.agentActivation) this.agentActivation = (async () => {
      const { AgentPlatformReview } = feature;
      const review = new AgentPlatformReview(provider, () => this.agentContext(), view => {
        const wasBusy = this.agentBusy; this.agentBusy = view.busy;
        this.state.agentPlatform = view;
        if (this.agentBusy) this.state.busy = true;
        else if (wasBusy && !this.applicationReview?.isBusy) this.state.busy = false;
        this.publish();
      });
      await review.initialize(); this.agentReview = review;
    })();
    try {
      await this.agentActivation;
      // Lazy host loading can yield while another deployment or profile action starts.
      if (input.action === 'check' && (this.state.busy || this.connectionProfilesReview?.isBusy())) {
        throw new feature.AgentPlatformRequestError(409, 'Wait for the current deployment or connection setup');
      }
      await this.agentReview!.action(input);
    }
    catch (error) { throw new RequestError(error instanceof feature.AgentPlatformRequestError ? error.status : 500,
      error instanceof feature.AgentPlatformRequestError ? error.message : 'Agent view could not be loaded. Check its trusted host configuration.'); }
  }
  applicationAction(input: ApplicationAction): void {
    this.requireAgentIdle();
    if (!this.applicationReview) throw new RequestError(409, 'No application host was registered');
    if (this.connectionProfilesReview?.isBusy()) throw new RequestError(409, 'Wait for connection setup to finish');
    try { this.applicationReview.action(input); this.completion = this.applicationReview.whenIdle().then(() => this.persist()); }
    catch (error) { if (error instanceof ApplicationRequestError) throw new RequestError(error.status, error.message); throw error; }
  }
  async releaseAutomationAction(input:ReleaseAutomationAction):Promise<void>{
    this.requireAgentIdle();
    if(!this.releaseAutomationReview)throw new RequestError(409,'No release watcher was configured');
    try{await this.releaseAutomationReview.action(input);}catch(error){if(error&&typeof error==='object'&&'status'in error)throw new RequestError(Number(error.status),'The release action was refused');throw error;}
  }
  async migrationAction(input:MigrationAction):Promise<void>{
    this.requireAgentIdle();
    if(!this.migrationReview)throw new RequestError(409,'No migration was configured by this host');
    if(this.state.busy||this.connectionProfilesReview?.isBusy())throw new RequestError(409,'Wait for the current task');
    try{const action=this.migrationReview.action(input);this.completion=action.then(()=>this.migrationReview!.whenIdle(),()=>{}).finally(async()=>{this.state.busy=false;this.publish();await this.persist();});await action;}
    catch(error){if(error instanceof MigrationRequestError)throw new RequestError(error.status,error.message);throw error;}
  }
  async pipelineAction(input:PipelineAction):Promise<void>{
    this.requireAgentIdle();
    if(!this.pipelineReview)throw new RequestError(409,'No pipeline was configured by this host');
    if(this.state.busy || this.connectionProfilesReview?.isBusy())throw new RequestError(409,'Wait for the current task');
    try {
      const action=this.pipelineReview.action(input);
      this.completion=action.then(()=>this.pipelineReview!.whenIdle(),()=>{}).finally(async()=>{this.state.busy=false;this.publish();await this.persist();});
      await action;
    }catch(error){if(error instanceof PipelineRequestError)throw new RequestError(error.status,error.message);throw error;}
  }
  startDelivery(input: DeliveryAction): void {
    this.requireAgentIdle();
    if (!this.deliveryReview) throw new RequestError(409,'No delivery was configured by this host');
    if (this.state.busy || this.connectionProfilesReview?.isBusy()) throw new RequestError(409,'Wait for the current task to finish');
    try {
      this.deliveryReview.action(input);
      this.state.busy = true; this.publish();
      this.completion = this.deliveryReview.whenIdle().finally(async () => { this.state.busy = false; this.publish(); await this.persist(); });
    } catch (error) { if (error instanceof DeliveryRequestError) throw new RequestError(error.status,error.message); throw error; }
  }
  private deliveryPublication(patch: DeliveryPublication): void {
    const fields = new Set(['graph','design','binding','schedulePreview','run','recording','connections','identity','revisionReview','neoUrl','appAccess','artifacts','target','systemView','changeAssessment']);
    if (!patch || typeof patch !== 'object' || Object.keys(patch).some(key => !fields.has(key))) throw Error('Invalid delivery publication');
    const admitted = readDashboardState({ ...this.state, ...structuredClone(patch) });
    if (admitted.graph) validateInfraGraph(admitted.graph);
    if (admitted.graph?.digest !== this.state.graph?.digest) {
      admitted.connectionReviewAvailable = false; admitted.identityReviewAvailable = false;
    }
    this.state = admitted; this.publish();
  }
  startResourceFlow(input: ResourceFlowAction): void {
    this.requireAgentIdle();
    if (!this.resourceFlowReview) throw new RequestError(409, 'No resource workflow is configured');
    if (this.connectionProfilesReview?.isBusy()) throw new RequestError(409, 'Wait for connection setup to finish');
    if (input.action === 'start' && this.state.connectionProfiles) {
      if (this.state.connectionProfiles.requiredAtStart && !input.profileId) throw new RequestError(409, 'Choose a saved connection before starting');
      if (input.profileId && !this.connectionProfilesReview?.has(input.profileId)) throw new RequestError(409, 'Choose a connection from this host');
    }
    try { this.resourceFlowReview.action(input); this.completion = this.resourceFlowReview.whenIdle().then(() => this.persist()); }
    catch (error) { if (error instanceof ResourceFlowRequestError) throw new RequestError(error.status, error.message); throw error; }
  }

  hostAction(input: HostActionInput): void {
    this.requireAgentIdle();
    if (!this.hostActionReview || this.state.resourceFlow?.status !== 'passed') throw new RequestError(409, 'Configured actions are available after this workflow completes');
    if (this.state.busy || this.connectionProfilesReview?.isBusy()) throw new RequestError(409, 'Wait for the current task to finish');
    try { this.hostActionReview.action(input); this.completion = this.hostActionReview.whenIdle().then(() => this.persist()); }
    catch (error) { if (error instanceof HostActionRequestError) throw new RequestError(error.status, error.message); throw error; }
  }

  async connectionProfileAction(value: unknown): Promise<ConnectionProfileActionResult> {
    this.requireAgentIdle();
    if (!this.connectionProfilesReview) throw new RequestError(409, 'Connection setup was not configured by this host');
    if (this.state.busy || this.applicationReview?.isBusy || this.connectionProfilesReview.isBusy()) throw new RequestError(409, 'Wait for the current task to finish');
    let input;
    try { input = readConnectionProfileAction(value); }
    catch { throw new RequestError(400, 'Supply only the declared connection fields or a saved profile ID'); }
    const completion = this.connectionProfilesReview.action(input);
    this.profileCompletion = completion.catch(() => undefined);
    try { return await completion; }
    catch { throw new RequestError(422, 'The connection was refused. Check the fields and allowed target.'); }
  }

  start(scenario: Scenario, reviewId?: string): void {
    this.requireAgentIdle();
    if (this.options.applicationHost) throw new RequestError(409, 'Use the registered application setup controls');
    if(this.options.releaseAutomation)throw new RequestError(409,'Use the configured release controls');
    if(this.options.migration)throw new RequestError(409,'Use the assessed migration workflow for this system');
    if (this.pipelineReview?.isBusy) throw new RequestError(409,'Wait for the pipeline to finish');
    if (this.options.pipeline && !['connections','identity'].includes(scenario)) throw new RequestError(409,'Use the configured pipeline action');
    if (this.deliveryReview?.isBusy) throw new RequestError(409,'Wait for delivery to finish');
    if (this.options.delivery && !['connections','identity'].includes(scenario)) throw new RequestError(409,'Use the configured delivery action for this system');
    if (this.hostActionReview?.isBusy) throw new RequestError(409, 'Wait for the configured action to finish');
    if (this.connectionProfilesReview?.isBusy()) throw new RequestError(409, 'Wait for connection setup to finish');
    if (this.options.resourceFlow) {
      if (reviewId !== undefined || (scenario !== 'connections' && scenario !== 'identity')) throw new RequestError(409, 'This viewer runs only its configured resource workflow');
      try { this.resourceFlowReview!.recheck(scenario); this.completion = this.resourceFlowReview!.whenIdle().then(() => this.persist()); }
      catch (error) { if (error instanceof ResourceFlowRequestError) throw new RequestError(error.status, error.message); throw error; }
      return;
    }
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
    this.agentReview?.contextChanged();
    if (this.diagnosticHistory) {
      this.diagnosticHistory.update(this.state); this.state.recordedDiagnostics = this.diagnosticHistory.snapshot();
      const history = this.state.recordedDiagnostics;
      if (history?.runs.length) this.state.artifacts = [...(this.state.artifacts ?? []).filter(item => item.id !== 'recorded-diagnostics'), {
        id: 'recorded-diagnostics', path: 'diagnostics/history.json', mediaType: 'application/json', content: JSON.stringify(history, null, 2) + '\n',
      }];
    }
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
