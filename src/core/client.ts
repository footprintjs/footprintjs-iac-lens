import { readReleaseAutomationAction,readReleaseAutomationView,type ReleaseAutomationAction } from './release-automation.ts';
import { readChangeAssessmentView } from './change-assessment.ts';
import { readApplicationAction, readApplicationView, type ApplicationAction } from './application.ts';
import { applicationSourceMatches, readApplicationSourceView } from './application-source.ts';
import { readAgentPlatformAction, readAgentPlatformView } from './agent-platform-read.ts';
import type { AgentPlatformAction } from './agent-platform.ts';
import type { DashboardState, Scenario } from './types.ts';
import { readSystemViewDefinition } from './capabilities.ts';
import { projectDeploymentSchedulePreview } from './native-deployment-chart.ts';
import { readRevisionReview } from './revision-review.ts';
import { readResourceFlowAction, readResourceFlowState, type ResourceFlowAction } from './resource-flow.ts';
import { readResourceFlowWorkspace } from './resource-flow-workspace.ts';
import { readRecordedDiagnostics } from './recorded-diagnostics.ts';
import { readHostActionInput, readHostActionsView, type HostActionInput } from './host-actions.ts';
import { readMigrationAction,readMigrationView,type MigrationAction } from './migration.ts';
import { readPipelineAction, readPipelineView, type PipelineAction } from './pipeline.ts';
import { readDeliveryAction, readDeliveryView, type DeliveryAction } from './delivery.ts';
import { readConnectionProfileAction, readConnectionProfilesView, readConnectionProfileTestResult,
  type ConnectionProfileAction, type ConnectionProfileActionResult } from './connection-profiles.ts';

export interface JsonResponse { ok: boolean; status: number; json(): Promise<unknown> }
export interface RequestOptions { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }
export type JsonFetch = (url: string, options?: RequestOptions) => Promise<JsonResponse>;
export interface StreamCallbacks { state(data: string): void; connected(value: boolean): void }
/** A browser, framework or test supplies its own streaming transport. */
export type OpenStateStream = (url: string, callbacks: StreamCallbacks) => () => void;
export interface ClientObserver { state(value: DashboardState): void; connected?(value: boolean): void; error?(error: Error): void }

export function readDashboardState(value: unknown): DashboardState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Deployment state is not an object');
  const state = value as Partial<DashboardState>;
  if (!Number.isSafeInteger(state.revision) || state.revision! < 0 || typeof state.busy !== 'boolean'
    || (state.graph !== null && (!state.graph || !Array.isArray(state.graph.resources)))) {
    throw new Error('Deployment state has an unsupported shape');
  }
  if (state.run) {
    const statuses = new Set(['pending', 'deploying', 'ready', 'failed', 'skipped', 'deleted']);
    if (!['idle', 'running', 'passed', 'failed'].includes(state.run.status)
      || !Array.isArray(state.run.resources) || !Array.isArray(state.run.events)
      || state.run.resources.some(resource => !resource || !statuses.has(resource.status)
        || typeof (resource.resourceId ?? resource.id) !== 'string')
      || state.run.events.some(event => !event || (event.status !== undefined && !statuses.has(event.status)))) {
      throw new Error('Deployment progress has an unsupported shape');
    }
  }
  if(state.target!==undefined){
    const target=state.target;
    if(!target||typeof target!=='object'||Array.isArray(target)||![Object.prototype,null].includes(Object.getPrototypeOf(target))
      ||Object.getOwnPropertySymbols(target).length||Object.entries(Object.getOwnPropertyDescriptors(target)).some(([key,value])=>!['id','context','namespace','label'].includes(key)||!value.enumerable||!('value'in value)||(value.value!==undefined&&(typeof value.value!=='string'||!value.value.trim()||value.value.length>256||/[\x00-\x1f\x7f]/.test(value.value)))))throw Error('Deployment target metadata has an unsupported shape');
  }
  if (state.systemView !== undefined) readSystemViewDefinition(state.systemView);
  if (state.application !== undefined) state.application = readApplicationView(state.application);
  if (state.source !== undefined) {
    state.source = readApplicationSourceView(state.source);
    if (!applicationSourceMatches(state.source, state.application?.selection)) throw Error('Application source belongs to a different selection');
  }
  const applicationTarget = state.application?.strategies.find(strategy => strategy.id === state.application?.selection?.strategyId)?.targets.find(target => target.id === state.application?.selection?.targetId);
  if (state.application?.phase === 'ready' && (applicationTarget?.requiresSource || state.source) && state.source?.status !== 'ready') throw Error('Application source readiness is unconfirmed');
  if (state.agentPlatformAvailable !== undefined && typeof state.agentPlatformAvailable !== 'boolean') throw Error('Invalid agent feature availability');
  if (state.agentPlatform !== undefined) state.agentPlatform = readAgentPlatformView(state.agentPlatform);
  if (state.revisionReview !== undefined) readRevisionReview(state.revisionReview);
  if (state.resourceFlow !== undefined) readResourceFlowState(state.resourceFlow);
  if (state.recordedDiagnostics !== undefined) state.recordedDiagnostics = readRecordedDiagnostics(state.recordedDiagnostics);
  if (state.hostActions !== undefined) state.hostActions = readHostActionsView(state.hostActions);
  if(state.releaseAutomation!==undefined)state.releaseAutomation=readReleaseAutomationView(state.releaseAutomation);
  if(state.changeAssessment!==undefined)state.changeAssessment=readChangeAssessmentView(state.changeAssessment);
  if(state.migration!==undefined)state.migration=readMigrationView(state.migration);
  if (state.pipeline !== undefined) state.pipeline = readPipelineView(state.pipeline);
  if (state.delivery !== undefined) state.delivery = readDeliveryView(state.delivery);
  if (state.connectionProfiles !== undefined) state.connectionProfiles = readConnectionProfilesView(state.connectionProfiles);
  if (state.resourceFlowWorkspace !== undefined) readResourceFlowWorkspace(state.resourceFlowWorkspace, state.graph!, state.resourceFlow);
  if (state.identityReviewAvailable !== undefined && typeof state.identityReviewAvailable !== 'boolean') throw Error('Identity review availability has an unsupported shape');
  if (state.resourceFlowError !== undefined && (typeof state.resourceFlowError !== 'string' || state.resourceFlowError.length > 4000)) throw Error('Workflow display error has an unsupported shape');
  if (state.schedulePreview !== undefined && !projectDeploymentSchedulePreview(state as DashboardState).chart) {
    throw new Error('Deployment schedule preview does not match the resource graph');
  }
  if (state.connections) {
    const connections = state.connections;
    const scopeText = (value: unknown) => value === undefined || (typeof value === 'string' && value.length <= 2000);
    if (!['idle', 'checking', 'passed', 'failed'].includes(connections.status) || !Array.isArray(connections.checks) || !Array.isArray(connections.events)
      || !scopeText(connections.label) || !scopeText(connections.scopeDescription)
      || (state.connectionReviewAvailable !== undefined && typeof state.connectionReviewAvailable !== 'boolean')
      || connections.checks.some(check => !check || !['untested', 'checking', 'connected', 'failed'].includes(check.status)
        || typeof check.connectionId !== 'string' || typeof check.from !== 'string' || typeof check.to !== 'string' || !scopeText(check.scopeDescription))
      || connections.events.some(event => !event || !['checking', 'connected', 'failed'].includes(event.status) || !scopeText(event.scopeDescription))) {
      throw new Error('Connection progress has an unsupported shape');
    }
  }
  if (state.identity) {
    const identity = state.identity;
    const kinds = new Set(['login', 'access', 'directory']);
    const expected = new Set(['authenticated', 'rejected', 'allowed', 'denied', 'available']);
    const verdicts = new Set([...expected, 'unavailable']);
    const resources = new Set(state.graph?.resources.map(resource => resource.id));
    const valid = (check: (typeof identity.checks)[number]) => check && typeof check.checkId === 'string' && typeof check.label === 'string'
      && kinds.has(check.kind) && expected.has(check.expected) && ['untested', 'checking', 'passed', 'failed'].includes(check.status)
      && (check.resourceIds === undefined || (Array.isArray(check.resourceIds) && new Set(check.resourceIds).size === check.resourceIds.length
        && check.resourceIds.every(id => typeof id === 'string' && resources.has(id))))
      && (!check.observation || (verdicts.has(check.observation.verdict) && Number.isFinite(check.observation.observedAt)
        && Number.isFinite(check.observation.latencyMs) && check.observation.latencyMs >= 0))
      && (check.status !== 'passed' || check.observation?.verdict === check.expected);
    if (typeof identity.id !== 'string' || typeof identity.label !== 'string' || !['idle', 'checking', 'passed', 'failed'].includes(identity.status)
      || !Array.isArray(identity.checks) || !Array.isArray(identity.events) || identity.checks.some(check => !valid(check))
      || identity.events.some(event => !valid(event) || !['checking', 'passed', 'failed'].includes(event.status))) {
      throw new Error('Identity progress has an unsupported shape');
    }
  }
  return state as DashboardState;
}
/** A delayed HTTP snapshot must never replace a newer stream update. */
export function newerState(current: DashboardState | undefined, next: DashboardState): DashboardState {
  return current && next.revision < current.revision ? current : next;
}
export function createDashboardClient(options: { baseUrl?: string; fetch?: JsonFetch; openStream?: OpenStateStream } = {}) {
  const endpoint = (path: string) => (options.baseUrl ?? '').replace(/\/$/, '') + path;
  const request: JsonFetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  async function getState(signal?: AbortSignal): Promise<DashboardState> {
    const response = await request(endpoint('/api/state'), { signal });
    if (!response.ok) throw new Error(`Unable to load deployment state (${response.status})`);
    return readDashboardState(await response.json());
  }
  async function run(scenario: Scenario, reviewId?: string): Promise<void> {
    if (scenario === 'revision-apply' && (!reviewId || !/^[a-f0-9]{64}$/.test(reviewId))) throw Error('Apply needs the exact completed revision review');
    if (scenario !== 'revision-apply' && reviewId !== undefined) throw Error('A review ID belongs only to revision-apply');
    const response = await request(endpoint('/api/run'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario, ...(reviewId !== undefined ? { reviewId } : {}) }) });
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: string; message?: string };
      throw new Error(result.error ?? result.message ?? `Run was refused (${response.status})`);
    }
  }
  async function resourceFlow(input: ResourceFlowAction): Promise<void> {
    const body = readResourceFlowAction(input);
    const response = await request(endpoint('/api/resource-flow'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: string };
      throw Error(result.error ?? `Workflow action was refused (${response.status})`);
    }
  }
  async function connectionProfile(input: ConnectionProfileAction): Promise<ConnectionProfileActionResult> {
    const body = readConnectionProfileAction(input);
    const response = await request(endpoint('/api/connection-profiles'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw Error('The connection was refused. Check the fields and allowed target.');
    const result = await response.json() as Partial<ConnectionProfileActionResult>;
    if (body.action === 'test' && result.action === 'test') {
      const tested = readConnectionProfileTestResult(result.result);
      if (tested.profileId !== body.profileId) throw Error('The connection result does not match this profile');
      return { action: 'test', result: tested };
    }
    if (body.action === 'register' && result.action === 'register') {
      const current = await getState();
      const profile = current.connectionProfiles?.profiles.find(profile => profile.id === result.profile?.id);
      if (profile) return { action: 'register', profile };
    }
    throw Error('The saved connection could not be matched to this host');
  }
  async function hostAction(input: HostActionInput): Promise<void> {
    const body = readHostActionInput(input);
    const response = await request(endpoint('/api/host-action'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw Error('The configured action was refused. Check that the workflow has completed and no task is running.');
  }
  async function application(input: ApplicationAction): Promise<void> {
    const body = readApplicationAction(input);
    const response = await request(endpoint('/api/application'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: string };
      throw Error(result.error ?? 'The application step was refused. Review the registered target and current recorded status.');
    }
  }
  async function delivery(input: DeliveryAction): Promise<void> {
    const body = readDeliveryAction(input);
    const response = await request(endpoint('/api/delivery'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw Error('The delivery was refused. Check the configured version and wait for any current task.');
  }
  function subscribe(observer: ClientObserver): () => void {
    const controller = new AbortController();
    let current: DashboardState | undefined;
    const receive = (next: DashboardState) => {
      if (controller.signal.aborted) return;
      const accepted = newerState(current, next);
      if (accepted !== current) { current = accepted; observer.state(accepted); }
    };
    void getState(controller.signal).then(receive).catch(error => {
      if (!controller.signal.aborted) observer.error?.(error instanceof Error ? error : new Error(String(error)));
    });
    const close = options.openStream?.(endpoint('/api/events'), {
      state(data) {
        try { receive(readDashboardState(JSON.parse(data))); }
        catch (error) { observer.error?.(error instanceof Error ? error : new Error(String(error))); }
      },
      connected(value) { if (!controller.signal.aborted) observer.connected?.(value); },
    });
    return () => { controller.abort(); close?.(); };
  }
  async function pipeline(input:PipelineAction):Promise<void>{
    const body=readPipelineAction(input);
    const response=await request(endpoint('/api/pipeline'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok)throw Error('The pipeline settings or action were refused. Review the current preview and recorded state.');
  }
  async function migration(input:MigrationAction):Promise<void>{
    const body=readMigrationAction(input);
    const response=await request(endpoint('/api/migration'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok)throw Error('The migration action was refused. Check the current assessment, review and recorded approval.');
  }
  async function releaseAutomation(input:ReleaseAutomationAction):Promise<void>{
    const body=readReleaseAutomationAction(input);
    const response=await request(endpoint('/api/releases'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok)throw Error('The release action was refused. Check the registered version and retained deployment.');
  }
  async function agentPlatform(input: AgentPlatformAction): Promise<void> {
    const body = readAgentPlatformAction(input);
    const response = await request(endpoint('/api/agent-platform'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw Error('The agent action was refused. Check its deployment and retained native records.');
  }
  return { agentPlatform, application, releaseAutomation, getState, run, resourceFlow, connectionProfile, hostAction, delivery, pipeline, migration, subscribe };
}
