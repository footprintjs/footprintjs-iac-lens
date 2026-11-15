import type { DashboardState, Recording } from './types.ts';
import type { DiagnosticFact, DiagnosticKind, DiagnosticTarget } from './recorded-diagnostics.ts';
import { readDiagnosticFact } from './recorded-diagnostics.ts';
import { projectBuildScene } from './build-scene.ts';
export interface DiagnosticCandidate {
  id: string; kind: DiagnosticKind; runId: string; label: string; outcome: 'passed' | 'failed';
  recording?: Recording; targets: Omit<DiagnosticTarget, 'trace'>[]; limitations: string[];
}
const outcome = (status: string): DiagnosticTarget['outcome'] => ['passed','ready','connected'].includes(status) ? 'passed' : status === 'failed' ? 'failed' : 'unknown';
function facts(status: string, observation?: { verdict?: string; latencyMs?: number; details?: unknown }, action?: string): DiagnosticFact[] {
  const values: unknown[] = [{ code: 'status', value: status }];
  if (action) values.push({ code: 'operation', value: action });
  if (observation?.verdict) values.push({ code: 'verdict', value: observation.verdict });
  if (observation?.latencyMs !== undefined) values.push({ code: 'latency-ms', value: observation.latencyMs });
  const details = observation?.details as { code?: unknown; httpStatus?: unknown; status?: unknown; probe?: { httpStatus?: unknown } } | undefined;
  if (details?.code !== undefined) values.push({ code: 'reason', value: details.code });
  const httpStatus = details?.httpStatus ?? details?.probe?.httpStatus ?? details?.status;
  if (typeof httpStatus === 'number') values.push({ code: 'http-status', value: httpStatus });
  return values.flatMap(value => { try { return [readDiagnosticFact(value)]; } catch { return []; } });
}
/** Only already-admitted native runs and safe numeric/enum facts feed the history. */
export function diagnosticCandidates(state: DashboardState): DiagnosticCandidate[] {
  const result: DiagnosticCandidate[] = [];
  const labels = new Map(projectBuildScene(state).nodes.map(node => [node.id, node.title]));
  const label = (id: string) => labels.get(id) ?? id;
  for (const [kind, run] of [['connections', state.connections], ['identity', state.identity]] as const) {
    if (!run?.id || !['passed','failed'].includes(run.status)) continue;
    const targets = run.checks.slice(0,16).map(check => {
      const id = 'connectionId' in check ? check.connectionId : check.checkId;
      const title = 'connectionId' in check ? `${label(check.from)} → ${label(check.to)}` : check.label;
      return { id, key: 'progress:' + id, label: title, outcome: outcome(check.status), facts: facts(check.status, check.observation) };
    });
    result.push({ id: kind + ':' + run.id, kind, runId: run.id, label: kind === 'connections' ? 'Connections' : 'Sign-in and access', outcome: run.status as 'passed' | 'failed', recording: run.recording, targets,
      limitations: run.report?.captureError ? ['The native recording may be incomplete.'] : [] });
  }
  const children = state.resourceFlowWorkspace?.children ?? [];
  const runs = [...children.map(child => child.run), ...(state.run ? [state.run] : [])];
  for (const run of runs) {
    if (!run.id || !['passed','failed'].includes(run.status) || result.some(item => item.id === 'deployment:' + run.id)) continue;
    result.push({ id: 'deployment:' + run.id, kind: 'deployment', runId: run.id, label: 'Resources', outcome: run.status as 'passed' | 'failed', recording: run.recording,
      targets: run.resources.slice(0,16).map(resource => ({ id: resource.resourceId ?? resource.id, key: 'progress:' + (resource.resourceId ?? resource.id), label: label(resource.resourceId ?? resource.id),
        outcome: outcome(resource.status), facts: facts(resource.status, undefined, resource.action) })), limitations: [] });
  }
  const parent = state.resourceFlow, segment = parent?.segments.at(-1);
  if (parent && segment && ['passed','failed'].includes(parent.status)) result.push({ id: 'workflow:' + segment.runId, kind: 'workflow', runId: segment.runId, label: 'Workflow', outcome: parent.status as 'passed' | 'failed',
    recording: state.resourceFlowRecording ?? (!state.resourceFlowWorkspace ? state.recording : undefined), limitations: [],
    targets: parent.stages.map(stage => ({ id: stage.id, key: 'progress:' + stage.id, label: stage.label, outcome: outcome(stage.status), facts: facts(stage.status) })) });
  for (const run of state.hostActions?.history ?? []) {
    if (run.status === 'running' || !run.receipt?.runId) continue;
    const resourceId = run.receipt.resourceId;
    result.push({ id: 'action:' + run.receipt.runId, kind: 'action', runId: run.receipt.runId, label: run.label, outcome: run.status,
      recording: run.receipt.recording, limitations: run.receipt.captureError ? ['The native action recording may be incomplete.'] : [],
      targets: resourceId ? [{ id: resourceId, key: 'progress:' + resourceId, label: label(resourceId), outcome: run.status, facts: [{ code: 'status', value: run.status }] }] : [] });
  }
  return result;
}
