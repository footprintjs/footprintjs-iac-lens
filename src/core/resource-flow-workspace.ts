import type { InfraGraph } from 'footprint-iac';
import type { ConnectionRun, DashboardRun, DashboardState, IdentityRun, ResourceProgress } from './types.ts';
import type { ResourceFlowState } from './resource-flow.ts';
import { projectNativeDeploymentChart } from './native-deployment-chart.ts';

export type ResourceFlowChildPhase = 'acquire' | 'connect';
export interface ResourceFlowChildRun {
  phase: ResourceFlowChildPhase;
  graphDigest: string;
  run: DashboardRun;
  origin?: 'live' | 'evidence';
}
/** A measured read of an existing object. It is not an apply event or deployment run. */
export interface ResourceFlowFoundResource {
  resourceId: string; physicalId: string; timestamp: number;
  parentRunId?: string; runtimeStageId?: string;
}
/** Safe viewer projection supplied by a fixed trusted host, never by an HTTP request. */
export interface ResourceFlowWorkspaceFrame {
  flowId: string; executionId: string | null; definitionDigest: string; targetId: string;
  graphDigest: string; sequence: number;
  children: ResourceFlowChildRun[];
  found?: ResourceFlowFoundResource[];
  connections?: ConnectionRun; identity?: IdentityRun;
  error?: string;
}
export interface ResourceFlowWorkspaceState extends Omit<ResourceFlowWorkspaceFrame, 'children'> {
  /** Fixed host declarations for planned positions; these do not establish progress or a run. */
  phaseGraphs?: Partial<Record<ResourceFlowChildPhase, InfraGraph>>;
  /** Each native chart is admitted against its exact configured child graph. */
  children: (ResourceFlowChildRun & { graph: InfraGraph })[];
}

/** Re-admit browser data before using a child graph to join physical resources. */
export function readResourceFlowWorkspace(value: unknown, graph: InfraGraph | null, parent: ResourceFlowState | undefined): ResourceFlowWorkspaceState {
  const state = structuredClone(value) as ResourceFlowWorkspaceState;
  require(!!state && !!graph && !!parent && state.flowId === parent.id && state.executionId === parent.executionId
    && state.definitionDigest === parent.definitionDigest && state.targetId === parent.target.id
    && state.graphDigest === graph.digest && Number.isSafeInteger(state.sequence) && state.sequence >= 0
    && Array.isArray(state.children) && state.children.length <= 16);
  const ids = new Set(graph.resources.map(resource => resource.id)), runIds = new Set<string>(), phases = new Set<string>();
  if (state.phaseGraphs !== undefined) {
    require(!!state.phaseGraphs && typeof state.phaseGraphs === 'object' && !Array.isArray(state.phaseGraphs));
    for (const [phase, phaseGraph] of Object.entries(state.phaseGraphs)) {
      require(['acquire', 'connect'].includes(phase)); admitGraph(phaseGraph, graph, ids);
    }
  }
  for (const child of state.children) {
    require(child && ['acquire', 'connect'].includes(child.phase) && !phases.has(child.phase)
      && (child.origin === undefined || child.origin === 'live' || child.origin === 'evidence'));
    phases.add(child.phase);
    // Cryptographic graph admission is owned by the server's fixed phaseGraphs. This
    // browser-safe reader checks their binding without importing Node crypto.
    const childGraph = child.graph, run = child.run;
    admitGraph(childGraph, graph, ids);
    require(child.graphDigest === childGraph.digest && (state.phaseGraphs?.[child.phase] === undefined
      || JSON.stringify(state.phaseGraphs[child.phase]) === JSON.stringify(childGraph)));
    require(run && typeof run.id === 'string' && (!run.id || !runIds.has(run.id))
      && ['idle', 'running', 'passed', 'failed'].includes(run.status)
      && Array.isArray(run.resources) && Array.isArray(run.events));
    if (run.id) runIds.add(run.id);
    else require(run.status === 'idle' && run.events.length === 0 && run.chart === undefined);
    const childIds = new Set(childGraph.resources.map(resource => resource.id));
    require(run.resources.length <= childIds.size && new Set(run.resources.map(resource => resource.resourceId ?? resource.id)).size === run.resources.length);
    for (const resource of run.resources) require(childIds.has(resource.resourceId ?? resource.id)
      && ['pending', 'deploying', 'ready', 'failed', 'skipped', 'deleted'].includes(resource.status));
    let sequence = 0;
    for (const event of run.events) {
      const native = event as typeof event & { runId?: string };
      require(!!event.resourceId && childIds.has(event.resourceId) && native.runId === run.id
        && Number.isSafeInteger(event.sequence) && event.sequence! > sequence
        && typeof event.runtimeStageId === 'string' && event.runtimeStageId.length > 0
        && typeof event.timestamp === 'number' && Number.isFinite(event.timestamp)
        && ['pending', 'deploying', 'ready', 'failed', 'skipped', 'deleted'].includes(event.status ?? ''));
      sequence = event.sequence!;
    }
    // A ready snapshot without its native finish event remains unconfirmed.
    for (const resource of run.resources) {
      if (resource.status === 'pending') continue;
      const event = run.events.findLast(event => event.resourceId === (resource.resourceId ?? resource.id));
      require(event?.status === resource.status);
    }
    if (run.chart !== undefined) require(!!projectNativeDeploymentChart({ revision: 0, busy: false, graph: childGraph, run }).chart);
    if (run.recording !== undefined) {
      require(run.recording.provenance?.runId === run.id && run.recording.provenance.stack === childGraph.name
        && run.recording.provenance.graphDigest === childGraph.digest
        && typeof (run.recording.snapshot as { runId?: unknown })?.runId === 'string'
        && !!(run.recording.snapshot as { runId?: unknown }).runId);
    }
    if (parent.mode === 'existing') require(child.phase !== 'acquire');
  }
  const foundIds = new Set<string>();
  for (const found of state.found ?? []) {
    require(parent.mode === 'existing' && ['running', 'passed'].includes(parent.stages.find(stage => stage.id === 'acquire')?.status ?? '')
      && !!found && ids.has(found.resourceId) && !foundIds.has(found.resourceId)
      && typeof found.physicalId === 'string' && found.physicalId.length > 0
      && Number.isFinite(found.timestamp) && found.timestamp > 0
      && (found.parentRunId === undefined || (typeof found.parentRunId === 'string' && found.parentRunId.length > 0
        && (parent.segments.length === 0 || parent.segments.some(segment => segment.runId === found.parentRunId))))
      && (found.runtimeStageId === undefined || parent.events.some(event => event.stageId === 'acquire'
        && ['running', 'passed'].includes(event.status) && event.runtimeStageId === found.runtimeStageId)));
    foundIds.add(found.resourceId);
  }
  if (state.connections) {
    const checks = new Map<string, InfraGraph['relations'][number]>(graph.relations.flatMap((relation, index) => relation.kind === 'communicatesWith'
      ? [[`communication:${index}`, relation] as const] : []));
    require(typeof state.connections.id === 'string' && (state.connections.id.length > 0 || state.connections.status === 'idle')
      && ['idle', 'checking', 'passed', 'failed'].includes(state.connections.status)
      && Array.isArray(state.connections.checks) && Array.isArray(state.connections.events));
    for (const check of state.connections.checks) {
      const relation = checks.get(check.connectionId);
      require(relation && relation.from === check.from && relation.to === check.to
        && ['untested', 'checking', 'connected', 'failed'].includes(check.status));
      if (check.status !== 'untested') {
        const event = state.connections.events.findLast(event => event.connectionId === check.connectionId);
        require(event?.status === check.status && event.from === check.from && event.to === check.to);
        if (check.status === 'connected') require(!!check.observation && Number.isFinite(check.observation.observedAt)
          && Number.isFinite(check.observation.latencyMs) && check.observation.latencyMs >= 0);
      }
    }
    sequenceEvents(state.connections.events, state.connections.id);
    if (state.connections.recording) require(state.connections.recording.provenance?.runId === state.connections.id
      && state.connections.recording.provenance.graphDigest === graph.digest && state.connections.recording.provenance.stack === graph.name);
  }
  if (state.identity) {
    require(typeof state.identity.id === 'string' && (state.identity.id.length > 0 || state.identity.status === 'idle')
      && ['idle', 'checking', 'passed', 'failed'].includes(state.identity.status)
      && Array.isArray(state.identity.checks) && Array.isArray(state.identity.events));
    for (const check of state.identity.checks) {
      require(typeof check.checkId === 'string' && ['untested', 'checking', 'passed', 'failed'].includes(check.status)
        && (check.resourceIds === undefined || check.resourceIds.every(id => ids.has(id)))
        && (check.status !== 'passed' || check.observation?.verdict === check.expected));
      if (check.status !== 'untested') {
        const event = state.identity.events.findLast(event => event.checkId === check.checkId);
        require(event?.status === check.status && event.kind === check.kind && event.expected === check.expected
          && (check.status !== 'passed' || event.observation?.verdict === check.observation?.verdict));
      }
    }
    sequenceEvents(state.identity.events, state.identity.id);
    if (state.identity.recording) require(state.identity.recording.provenance?.runId === state.identity.id
      && state.identity.recording.provenance.stack === graph.name);
  }
  require(state.error === undefined || (typeof state.error === 'string' && state.error.length <= 4000));
  return state;
}

function sequenceEvents(events: { runId: string; sequence: number }[], runId: string): void {
  let sequence = 0;
  for (const event of events) { require(event.runId === runId && Number.isSafeInteger(event.sequence) && event.sequence > sequence); sequence = event.sequence; }
}
function require(condition: unknown): asserts condition { if (!condition) throw Error('Resource workflow workspace does not match its configured evidence'); }
function admitGraph(child: InfraGraph, graph: InfraGraph, ids: Set<string>): void {
  require(child && child.kind === 'infra-graph' && child.version === 1 && /^[a-f0-9]{64}$/.test(child.digest) && child.name === graph.name
    && Array.isArray(child.resources) && child.resources.length > 0
    && new Set(child.resources.map(resource => resource.id)).size === child.resources.length
    && child.resources.every(resource => ids.has(resource.id)));
}

export function resourceFlowWorkspace(state: DashboardState): ResourceFlowWorkspaceState | undefined {
  if (!state.resourceFlowWorkspace) return;
  try { return readResourceFlowWorkspace(state.resourceFlowWorkspace, state.graph, state.resourceFlow); }
  catch { return; }
}
export function workspaceResourceProgress(state: DashboardState, resourceId: string): ResourceProgress | undefined {
  const workspace = resourceFlowWorkspace(state);
  if (!workspace) return;
  for (const child of [...workspace.children].reverse()) {
    const progress = child.run.resources.find(resource => (resource.resourceId ?? resource.id) === resourceId);
    if (progress) return progress;
  }
  const found = workspace.found?.find(resource => resource.resourceId === resourceId);
  return found && { id: resourceId, resourceId, status: 'ready', action: 'find', timestamp: found.timestamp,
    ...(found.runtimeStageId ? { runtimeStageId: found.runtimeStageId } : {}) };
}
