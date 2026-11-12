import type { DashboardState, Scenario } from './types.ts';
import { readSystemViewDefinition } from './capabilities.ts';
import { projectDeploymentSchedulePreview } from './native-deployment-chart.ts';
import { readRevisionReview } from './revision-review.ts';
import { readResourceFlowAction, readResourceFlowState, type ResourceFlowAction } from './resource-flow.ts';
import { readResourceFlowWorkspace } from './resource-flow-workspace.ts';

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
  if (state.systemView !== undefined) readSystemViewDefinition(state.systemView);
  if (state.revisionReview !== undefined) readRevisionReview(state.revisionReview);
  if (state.resourceFlow !== undefined) readResourceFlowState(state.resourceFlow);
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
  return { getState, run, resourceFlow, subscribe };
}
