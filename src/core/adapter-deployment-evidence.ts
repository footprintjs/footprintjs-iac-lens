import type { DeploymentChart } from 'footprintjs-iac/progress';
import { readLensDeploymentChart } from './deployment-chart-reader.ts';
import type { DashboardState } from './types.ts';
import { buildAdapterTopology } from './adapter-deployment-topology.ts';

interface Instance { started: boolean; completed: boolean; failed: boolean; unknown: boolean }
export interface AdapterObservationIndex {
  nativeRunId: string;
  stages: Map<string, Map<string, Instance>>; decisions: Map<string, Set<string>>;
  providerStages: Set<string>; warnings: string[]; incomplete: boolean;
}
type Row = Record<string, unknown>;
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('Invalid native record');
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string') || Object.keys(fields).length > 20000
    || Object.values(fields).some(field => !('value' in field) || !field.enumerable)) throw Error('Invalid native record fields');
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
}
function list(value: unknown, limit = 50000): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw Error('Invalid native list');
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string') || Object.keys(fields).length !== value.length + 1) throw Error('Invalid native list fields');
  return Array.from({ length: value.length }, (_, index) => {
    const field = fields[String(index)]; if (!field || !('value' in field) || !field.enumerable) throw Error('Invalid native item'); return field.value;
  });
}
const text = (value: unknown): string => { if (typeof value !== 'string' || !value || value.length > 4096) throw Error('Invalid native ID'); return value; };
const stageKey = (runtime: string): string => { const match = /^(.*)#\d+$/.exec(runtime); if (!match?.[1]) throw Error('Invalid runtime stage ID'); return match[1]; };

/** Consume only recorded stage boundaries and decisions, never an observer's elapsed-time guess. */
export function adapterObservations(state: DashboardState, chart: DeploymentChart): AdapterObservationIndex {
  const recording = row(state.run!.recording), proof = row(recording.provenance), snapshot = row(recording.snapshot);
  if (proof.runId !== state.run!.id || proof.stack !== chart.stack || proof.graphDigest !== chart.graphDigest) throw Error('Foreign adapter recording');
  const nativeRunId = text(snapshot.runId);
  const recordedChart = readLensDeploymentChart({ ...chart, structure: recording.structure });
  if (JSON.stringify(recordedChart.structure) !== JSON.stringify(chart.structure)) throw Error('Foreign adapter structure');
  const topology = buildAdapterTopology(chart, undefined, state.run!.mode === 'kubernetes');
  const all = new Map(topology.resources.flatMap(resource => resource.stages.map(stage => [stage.id, stage] as const)));
  const output: AdapterObservationIndex = { nativeRunId, stages: new Map(), decisions: new Map(), providerStages: new Set(), warnings: [], incomplete: false };
  let work = 0;
  const spend = () => { if (++work > 150000) throw Error('Oversized native observation'); };
  const inScope = (id: string, scope: string) => {
    const stage = all.get(id)!;
    return stage.scope === scope || (!scope && stage.scope === stage.id && stage.stageId === stage.id);
  };
  function instance(runtimeInput: unknown, declaredId?: unknown): { id: string; value: Instance } | undefined {
    const runtime = text(runtimeInput), id = stageKey(runtime);
    if (!all.has(id)) return;
    if (declaredId !== undefined && declaredId !== id && declaredId !== all.get(id)!.stageId) throw Error('Mismatched native stage');
    const observations = output.stages.get(id) ?? new Map<string, Instance>(); output.stages.set(id, observations);
    const value = observations.get(runtime) ?? { started: false, completed: false, failed: false, unknown: false }; observations.set(runtime, value);
    return { id, value };
  }
  function outcome(stageId: string, value: unknown): 'failed' | 'unknown' | undefined {
    if (value === undefined) return;
    const writes = row(value);
    for (const key of ['adapterFlowOutcome', 'verificationFlowOutcome', 'adapterFlowProgress']) if (writes[key] !== undefined) {
      const status = row(writes[key]).status;
      if (status === 'failed' || status === 'unknown') return status;
    }
    if (writes.nativeHasError === true) return 'failed';
    if (writes.adapterFlowPassed === false) return 'unknown';
    const progress = writes[`progress:${all.get(stageId)!.resourceId}`];
    if (progress !== undefined && row(progress).status === 'failed') return 'failed';
  }
  function commits(input: unknown, scope = ''): void {
    for (const raw of list(input ?? [])) {
      spend(); const commit = row(raw);
      // A child history's initial mount input is not the parent mount's completion.
      if (scope && commit.stageId === scope) continue;
      if (commit.runtimeStageId === undefined) continue;
      const observed = instance(commit.runtimeStageId, commit.stageId); if (!observed) continue;
      if (!inScope(observed.id, scope)) throw Error('Native commit belongs to another chart scope');
      observed.value.started = true; observed.value.completed = true;
      const result = outcome(observed.id, commit.overwrite); if (result) observed.value[result] = true;
      const writes = commit.overwrite === undefined ? undefined : row(commit.overwrite);
      if (writes?.adapterFlowProgress !== undefined) output.providerStages.add(observed.id);
    }
  }
  function tree(input: unknown, scope = ''): void {
    const pending = input === undefined || input === null ? [] : Array.isArray(input) ? list(input, 20000) : [input];
    const seen = new WeakSet<object>();
    while (pending.length) {
      spend(); const raw = pending.pop()!; if (seen.has(raw as object)) throw Error('Repeated native tree node'); seen.add(raw as object);
      const node = row(raw);
      if (node.runtimeStageId !== undefined) {
        const observed = instance(node.runtimeStageId, node.id);
        if (observed) {
          if (!inScope(observed.id, scope)) throw Error('Native tree belongs to another chart scope');
          observed.value.started = true;
          if (node.errors !== undefined && Object.keys(row(node.errors)).length) observed.value.failed = true;
          const result = outcome(observed.id, node.stageWrites); if (result) observed.value[result] = true;
        }
      }
      if (node.next) pending.push(node.next);
      for (const key of ['children', 'branches']) if (node[key] !== undefined) for (const child of list(node[key], 128)) {
        if (Array.isArray(child)) pending.push(...list(child, 20000)); else pending.push(child);
      }
    }
  }
  function decision(runtimeInput: unknown, chosenInput: unknown): void {
    const runtime = text(runtimeInput), gate = stageKey(runtime), children = topology.children.get(gate);
    if (!children) return;
    const chosen = Array.isArray(chosenInput) ? list(chosenInput, 128).map(text) : [text(chosenInput)];
    const scope = all.get(gate)!.scope;
    const resolved = chosen.map(id => children.includes(id) ? id : `${scope}/${id}`);
    if (resolved.some(id => !children.includes(id))) { output.warnings.push('A recorded branch choice could not be matched to the adapter chart.'); return; }
    const selected = output.decisions.get(gate) ?? new Set<string>(); resolved.forEach(id => selected.add(id)); output.decisions.set(gate, selected);
  }
  tree(snapshot.executionTree); commits(snapshot.commitLog);
  if (snapshot.subflowResults !== undefined) {
    const results = row(snapshot.subflowResults), scopes = new Set(topology.resources.flatMap(resource => resource.scopes.map(scope => scope.id)));
    for (const [key, raw] of Object.entries(results)) {
      spend(); const child = row(raw), scope = text(child.subflowId);
      if (!scopes.has(scope)) continue;
      if (key !== scope && stageKey(key) !== scope) throw Error('Mismatched native subflow');
      const context = row(child.treeContext); tree(context.stageContexts, scope); commits(context.history, scope);
    }
  }
  if (snapshot.sink !== undefined && Number(row(snapshot.sink).failed) > 0) output.incomplete = true;
  for (const raw of list(snapshot.recorders ?? [], 2048)) {
    spend(); const recorder = row(raw), data = recorder.data === undefined ? undefined : row(recorder.data);
    if (!data) continue;
    if (recorder.id === 'iac-native-stage-progress') {
      if (data.version !== 1 || data.runId !== nativeRunId) throw Error('Foreign stage progress');
      if (data.droppedEvents !== 0 || data.observerFailures !== 0) output.incomplete = true;
      const events = list(data.events), admitted = events.map(row); let sequence = 0;
      for (const event of admitted) {
        if (!Number.isSafeInteger(event.sequence) || Number(event.sequence) <= sequence || !['start', 'end', 'decision', 'executed', 'error'].includes(String(event.type))) throw Error('Ambiguous native stage progress');
        sequence = Number(event.sequence); text(event.runtimeStageId);
      }
      for (const event of admitted) {
        const observed = instance(event.runtimeStageId, event.stageId);
        if (observed) {
          if (event.type === 'start') observed.value.started = true;
          if (event.type === 'end') { observed.value.started = true; observed.value.completed = true; }
          if (event.type === 'error') { observed.value.started = true; observed.value.failed = true; }
        }
        if (event.type === 'decision' && event.chosen !== undefined) decision(event.runtimeStageId, event.chosen);
      }
    } else if (recorder.id === 'iac-internal-control-dependencies') {
      for (const input of list(data.decisions ?? [])) {
        spend(); const item = row(input), evidence = item.evidence === undefined ? undefined : row(item.evidence);
        if (evidence?.chosen !== undefined) decision(item.deciderRuntimeStageId, evidence.chosen);
      }
    }
  }
  if (output.incomplete) output.warnings.push('The native stage capture is incomplete; completed steps cannot be confirmed.');
  return output;
}
