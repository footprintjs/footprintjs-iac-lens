import type { DashboardState, Scenario } from './types.ts';

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
  if (state.connections) {
    const connections = state.connections;
    if (!['idle', 'checking', 'passed', 'failed'].includes(connections.status) || !Array.isArray(connections.checks) || !Array.isArray(connections.events)
      || connections.checks.some(check => !check || !['untested', 'checking', 'connected', 'failed'].includes(check.status)
        || typeof check.connectionId !== 'string' || typeof check.from !== 'string' || typeof check.to !== 'string')
      || connections.events.some(event => !event || !['checking', 'connected', 'failed'].includes(event.status))) {
      throw new Error('Connection progress has an unsupported shape');
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
  async function run(scenario: Scenario): Promise<void> {
    const response = await request(endpoint('/api/run'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario }) });
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: string; message?: string };
      throw new Error(result.error ?? result.message ?? `Run was refused (${response.status})`);
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
  return { getState, run, subscribe };
}
