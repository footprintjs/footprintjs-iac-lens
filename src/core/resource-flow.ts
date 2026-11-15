import { readResourceFlowState, type ResourceFlowState } from 'footprintjs-iac/resource-flow';
import type { DashboardState, Recording } from './types.ts';

export { readResourceFlowState };
export type { ResourceFlowState };
export type ResourceFlowAction = { action: 'start'; profileId?: string } | { action: 'resume'; pauseToken: string; profileId: string };
export interface ResourceFlowStageView {
  id: ResourceFlowState['stages'][number]['id']; label: string;
  status: ResourceFlowState['stages'][number]['status']; caption: string;
}
export interface ResourceFlowView {
  state: ResourceFlowState; headline: string; origin: string; stages: ResourceFlowStageView[];
  canStart: boolean; canResume: boolean; completed: number; total: number;
}

/** A presentation of the native workflow state, with no scheduler, effects or synthetic progress. */
export function projectResourceFlow(input: Pick<DashboardState, 'resourceFlow' | 'resourceFlowError' | 'busy'>): ResourceFlowView | undefined {
  if (!input.resourceFlow) return;
  const state = readResourceFlowState(input.resourceFlow);
  const current = state.stages.find(stage => stage.status === 'running');
  const running = (id: string) => id === 'acquire' ? state.mode === 'create' ? 'Creating' : 'Finding'
    : id === 'details' ? 'Getting details' : id === 'connect' ? 'Connecting' : 'Checking';
  const passed = (id: string) => id === 'acquire' ? state.mode === 'create' ? 'Ready' : 'Found'
    : id === 'details' ? 'Details available' : id === 'connect' ? 'Connected' : 'Verified';
  const captions = { pending: 'Waiting', running: '', waiting: 'Waiting for you', passed: '', failed: 'Needs attention' };
  const stages = state.stages.map(stage => ({ ...stage,
    caption: stage.status === 'running' ? running(stage.id) : stage.status === 'passed' ? passed(stage.id) : captions[stage.status] }));
  const headline = input.resourceFlowError ? 'Workflow needs attention'
    : state.status === 'paused' ? 'Connection details needed'
      : state.status === 'passed' ? 'Connected and verified'
        : state.status === 'failed' ? 'Connection needs attention'
          : state.status === 'incomplete' ? 'Recording needs attention'
            : state.status === 'running' ? current ? `${running(current.id)}${current.id === 'acquire' ? ' resource' : ''}` : 'Working'
              : 'Ready to connect';
  return { state, stages, headline, origin: state.mode === 'create' ? 'Manage resource' : 'Use existing resource',
    canStart: !input.busy && !input.resourceFlowError && state.status === 'idle',
    canResume: !input.busy && !input.resourceFlowError && state.status === 'paused' && !!state.pause?.token && !!state.pause.profiles.length,
    completed: stages.filter(stage => stage.status === 'passed').length, total: stages.length };
}

export function readResourceFlowAction(input: unknown): ResourceFlowAction {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Choose a resource workflow action');
  if (![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Object.getOwnPropertySymbols(input).length
    || Object.values(Object.getOwnPropertyDescriptors(input)).some(property => !('value' in property) || !property.enumerable)) {
    throw Error('Workflow actions must be plain JSON values');
  }
  const row = input as Record<string, unknown>;
  const profile = typeof row.profileId === 'string' && row.profileId.length > 0 && row.profileId.length <= 200
    && !/[\x00-\x20\x7f]/.test(row.profileId);
  if (row.action === 'start' && Object.keys(row).every(key => ['action', 'profileId'].includes(key))
    && (row.profileId === undefined || profile)) return { action: 'start', ...(row.profileId !== undefined ? { profileId: row.profileId as string } : {}) };
  if (row.action === 'resume' && Object.keys(row).length === 3
    && typeof row.pauseToken === 'string' && /^[a-f0-9]{64}$/.test(row.pauseToken)
    && typeof row.profileId === 'string' && row.profileId.length > 0 && row.profileId.length <= 200
    && !/[\x00-\x20\x7f]/.test(row.profileId)
    && Object.keys(row).every(key => ['action', 'pauseToken', 'profileId'].includes(key))) {
    return { action: 'resume', pauseToken: row.pauseToken, profileId: row.profileId };
  }
  throw Error('Resume needs the current pause token and a configured connection profile');
}

/** Only host-provided, run/definition-bound artifacts can supply an earlier native segment. */
export function resourceFlowRecordings(input: Pick<DashboardState, 'resourceFlow' | 'recording' | 'artifacts'>): {
  segment: ResourceFlowState['segments'][number]; recording?: Recording;
}[] {
  if (!input.resourceFlow) return [];
  const state = readResourceFlowState(input.resourceFlow);
  const records = new Map<string, Recording>();
  for (const artifact of input.artifacts ?? []) {
    if (artifact.mediaType !== 'application/json' || artifact.content.length > 16 * 1024 * 1024) continue;
    try {
      const value = JSON.parse(artifact.content);
      if (value?.definitionDigest !== state.definitionDigest || value.executionId !== state.executionId
        || value.definition?.resourceId !== state.resourceId || value.definition?.target?.id !== state.target.id
        || value.definition?.target?.scope !== state.target.scope || value.snapshot?.runId !== value.runId
        || !value.structure || !state.segments.some(segment => segment.runId === value.runId)) continue;
      records.set(value.runId, { snapshot: value.snapshot, structure: value.structure,
        ...(value.controlDeps && typeof value.controlDeps === 'object' && !Array.isArray(value.controlDeps) ? { controlDeps: value.controlDeps } : {}),
        ...(Array.isArray(value.narrative) ? { narrativeEntries: value.narrative } : {}) });
    } catch { /* A non-recording artifact cannot become workflow execution evidence. */ }
  }
  const latest = state.segments.at(-1);
  const snapshot = input.recording?.snapshot as { runId?: unknown; sharedState?: {
    definitionDigest?: unknown; context?: { executionId?: unknown }; definition?: { target?: { id?: unknown; scope?: unknown } };
  } } | undefined;
  if (latest && snapshot?.runId === latest.runId && snapshot.sharedState?.definitionDigest === state.definitionDigest
    && snapshot.sharedState.context?.executionId === state.executionId
    && snapshot.sharedState.definition?.target?.id === state.target.id && snapshot.sharedState.definition.target.scope === state.target.scope
    && !records.has(latest.runId)) records.set(latest.runId, input.recording!);
  return state.segments.map(segment => ({ segment, ...(records.has(segment.runId) ? { recording: records.get(segment.runId)! } : {}) }));
}
