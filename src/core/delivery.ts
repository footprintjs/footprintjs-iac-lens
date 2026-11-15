import type { DeliveryState, DeliveryStageId, DeliveryStageStatus } from 'footprintjs-iac/delivery';
import type { Recording } from './types.ts';
import { readHostActionReceipt, hostActionId } from './host-actions.ts';

export interface DeliveryAction { deliveryId: string }
export interface DeliveryView {
  id: string; label: string; buttonLabel: string; repository: string; ref: string;
  executionId: string | null; status: DeliveryState['status'];
  stages: { id: DeliveryStageId; label: string; status: DeliveryStageStatus }[];
  source?: { commit: string; tree: string };
  artifacts: { id: string; digest: string; reference: string }[];
  changes: { resourceId: string; action: 'create' | 'update' | 'verify' | 'delete' | 'noop' }[];
  checks: { id: string; passed: boolean }[];
  recordings: { runId: string; status: 'passed' | 'failed' | 'incomplete' }[];
  recording?: Recording; error?: string;
}
const stageIds = ['resolve','fetch','build','publish','plan','deploy','verify'];
function record(input: unknown, fields: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype,null].includes(Object.getPrototypeOf(input))
    || Object.getOwnPropertySymbols(input).length) throw Error('Invalid delivery view');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Object.entries(descriptors).some(([key,value]) => !fields.includes(key) || !value.enumerable || !('value' in value))) throw Error('Invalid delivery view');
  return input as Record<string,unknown>;
}
function text(input: unknown, max = 512): string {
  if (typeof input !== 'string' || !input.trim() || input.length > max || /[\x00-\x1f\x7f]/.test(input)) throw Error('Invalid delivery text');
  return input;
}
function list(input: unknown, max: number): unknown[] { if (!Array.isArray(input) || input.length > max) throw Error('Invalid delivery list'); return input; }
function repository(input: unknown): string {
  const value = text(input, 2048);
  if (value === 'Configured repository') return value;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('Invalid delivery repository');
  return value;
}
function hex(input: unknown, length: number): string { const value = text(input, length); if (!new RegExp(`^[a-f0-9]{${length}}$`).test(value)) throw Error('Invalid delivery identity'); return value; }
function gitIdentity(input: unknown): string { const value = text(input,64); if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value)) throw Error('Invalid source identity'); return value; }
export function readDeliveryAction(input: unknown): DeliveryAction {
  const row = record(input, ['deliveryId']); return { deliveryId: hostActionId(row.deliveryId) };
}
/** Browser-safe receipt projection. Adapter metadata and host source/evidence paths never enter this view. */
export function projectDeliveryState(state: DeliveryState, buttonLabel = 'Deploy version'): DeliveryView {
  let repositoryLabel = 'Configured repository';
  try { repositoryLabel = repository(state.definition.source.repository); } catch { /* Local host paths are not browser metadata. */ }
  return readDeliveryView({ id: state.definition.id, label: state.definition.label, buttonLabel,
    repository: repositoryLabel, ref: state.definition.source.ref,
    executionId: state.executionId, status: state.status, stages: state.stages,
    ...(state.results.revision ? { source: { commit: state.results.revision.commit, tree: state.results.revision.tree } } : {}),
    artifacts: state.results.publication?.artifacts ?? state.results.build?.artifacts ?? [],
    changes: state.results.plan?.changes ?? [], checks: state.results.verification?.checks ?? [],
    recordings: state.recordings.map(({ runId,status }) => ({ runId,status })),
    ...(state.error ? { error: 'This delivery needs attention. Its completed stages and evidence are retained.' } : {}) });
}
export function readDeliveryView(input: unknown): DeliveryView {
  const row = record(input, ['id','label','buttonLabel','repository','ref','executionId','status','stages','source','artifacts','changes','checks','recordings','recording','error']);
  const id = hostActionId(row.id), label = text(row.label,160), buttonLabel = text(row.buttonLabel,80), sourceRepository = repository(row.repository), ref = text(row.ref,256);
  if (!['idle','running','passed','failed','incomplete'].includes(String(row.status))) throw Error('Invalid delivery status');
  const executionId = row.executionId === null ? null : text(row.executionId,256);
  const stages = list(row.stages,7).map((input,index) => {
    const stage = record(input,['id','label','status']);
    if (stage.id !== stageIds[index] || !['pending','running','passed','failed'].includes(String(stage.status))) throw Error('Invalid delivery stage');
    return { id: stage.id as DeliveryStageId, label: text(stage.label,160), status: stage.status as DeliveryStageStatus };
  });
  if (stages.length !== 7 || (row.status === 'passed' && stages.some(stage => stage.status !== 'passed'))) throw Error('Invalid completed delivery');
  let source: DeliveryView['source'];
  if (row.source !== undefined) { const value = record(row.source,['commit','tree']); source = { commit: gitIdentity(value.commit), tree: gitIdentity(value.tree) }; }
  const artifacts = list(row.artifacts,128).map(input => { const value = record(input,['id','digest','reference']);
    const digest = text(value.digest,71);if (!/^(?:sha256:)?[a-f0-9]{64}$/.test(digest)) throw Error('Invalid artifact digest');
    return { id: text(value.id,128), digest, reference: text(value.reference,4096) }; });
  const changes = list(row.changes,4096).map(input => { const value = record(input,['resourceId','action']);
    if (!['create','update','verify','delete','noop'].includes(String(value.action))) throw Error('Invalid delivery change');
    return { resourceId: text(value.resourceId,256), action: value.action as DeliveryView['changes'][number]['action'] }; });
  const checks = list(row.checks,4096).map(input => { const value = record(input,['id','passed']); if (typeof value.passed !== 'boolean') throw Error('Invalid delivery check'); return { id: text(value.id,256), passed: value.passed }; });
  const recordings = list(row.recordings,64).map(input => { const value = record(input,['runId','status']);
    if (!['passed','failed','incomplete'].includes(String(value.status))) throw Error('Invalid delivery recording');
    return { runId: text(value.runId,256), status: value.status as DeliveryView['recordings'][number]['status'] }; });
  const recording = row.recording === undefined ? undefined : readHostActionReceipt({ ok: true, recording: row.recording }).recording;
  return { id,label,buttonLabel,repository:sourceRepository,ref,executionId,status:row.status as DeliveryView['status'],stages,
    ...(source ? { source } : {}),artifacts,changes,checks,recordings,...(recording ? { recording } : {}),...(row.error !== undefined ? { error: text(row.error,1000) } : {}) };
}
export function deliveryPhases(view: DeliveryView) {
  const groups = [ ['source','Get code',['resolve','fetch']], ['build','Build',['build']], ['publish','Store package',['publish']],
    ['plan','Review changes',['plan']], ['deploy','Deploy',['deploy']], ['verify','Check',['verify']] ] as const;
  return groups.map(([id,label,ids]) => {
    const statuses = view.stages.filter(stage => (ids as readonly string[]).includes(stage.id)).map(stage => stage.status);
    const status = statuses.includes('failed') ? 'failed' : statuses.every(status => status === 'passed') ? 'passed'
      : statuses.some(status => status === 'running' || status === 'passed') ? 'running' : 'pending';
    return { id,label,status };
  });
}
