import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { checkIdentityAccess, createIdentityRecorder, type AccessCheckAdapter, type IdentityCheckRequest } from 'footprint-iac/identity';
import { untestedIdentity } from '../core/identity.ts';
import type { IdentityProgress, IdentityRun } from '../core/types.ts';

/** Trusted server composition. Credentials stay inside the adapter, outside the dashboard protocol. */
export interface IdentityReviewOptions {
  stack: string; checks: readonly IdentityCheckRequest[]; adapter: AccessCheckAdapter; label?: string;
  resourceBindings?: Readonly<Record<string, readonly string[]>>;
}

/** The host declares associations explicitly; recorded observations still own every verdict. */
export function readIdentityResourceBindings(options: Pick<IdentityReviewOptions, 'checks' | 'resourceBindings'>,
  knownResourceIds?: readonly string[]): IdentityReviewOptions['resourceBindings'] {
  const bindings = options.resourceBindings;
  if (bindings === undefined) return;
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) throw Error('Identity resource bindings must be a check-to-resource map');
  const checkIds = new Set(options.checks.map(check => check.id));
  const resources = knownResourceIds && new Set(knownResourceIds);
  const entries = Object.entries(bindings);
  for (const [checkId, ids] of entries) {
    if (!checkIds.has(checkId) || !Array.isArray(ids) || new Set(ids).size !== ids.length
      || ids.some(id => typeof id !== 'string' || !id || (resources && !resources.has(id)))) {
      throw Error('Identity resource bindings must name configured checks and declared resources');
    }
  }
  return Object.freeze(Object.fromEntries(entries.map(([checkId, ids]) => [checkId, Object.freeze([...ids])])));
}

function bindResources<T extends IdentityProgress>(check: T, bindings: IdentityReviewOptions['resourceBindings']): T {
  const ids = bindings && Object.hasOwn(bindings, check.checkId) ? bindings[check.checkId] : undefined;
  return ids ? { ...check, resourceIds: [...ids] } : check;
}

export function pendingIdentity(options: IdentityReviewOptions): IdentityRun {
  const bindings = readIdentityResourceBindings(options);
  const pending = untestedIdentity(options.checks.map(({ id, label, kind, expected }) => ({ checkId: id, label, kind, expected })), options.label);
  return { ...pending, checks: pending.checks.map(check => bindResources(check, bindings)) };
}

/** The native chart owns verdicts; the viewer only projects and stores its safe events. */
export async function runIdentityReview(options: IdentityReviewOptions & {
  directory: string; update(state: IdentityRun): void;
}): Promise<IdentityRun> {
  const resourceBindings = readIdentityResourceBindings(options);
  const review = { ...options, resourceBindings };
  let state = pendingIdentity(review);
  const recorder = createIdentityRecorder();
  const publish = () => options.update(structuredClone(state));
  state.status = 'checking'; publish();
  const unsubscribe = recorder.subscribe(event => {
    const projection = recorder.getSnapshot();
    state = { ...state, id: event.runId,
      checks: state.checks.map(check => bindResources(projection.checks[check.checkId] ?? check, resourceBindings)),
      events: projection.events.map(event => bindResources(event, resourceBindings)) };
    publish();
  });
  try {
    const result = await checkIdentityAccess({ stack: options.stack, checks: options.checks, adapter: options.adapter,
      recorders: [recorder], traceDirectory: resolve(options.directory, 'identity-traces') });
    const terminal = new Map(result.events.map(event => [event.checkId, event]));
    const checks = pendingIdentity(review).checks.map(check => bindResources(terminal.get(check.checkId) ?? check, resourceBindings));
    const complete = checks.every(check => check.status === 'passed' || check.status === 'failed');
    state = { ...state, id: result.runId, status: result.ok ? 'passed' : 'failed', checkedAt: Date.now(), checks,
      events: result.events.map(event => bindResources(event, resourceBindings)),
      recording: { snapshot: result.snapshot, structure: result.structure, narrativeEntries: Array.isArray(result.narrative) ? result.narrative : [] },
      report: { tracePath: result.tracePath, traceStatus: result.traceStatus } };
    if (result.traceStatus && (result.traceStatus.failed > 0 || result.traceStatus.flushed === false)) {
      state.report!.captureError = 'The native JSONL trace is incomplete. The captured snapshot remains available; trace replay may have gaps.';
    }
    if (!complete) {
      state.status = 'failed'; state.report!.captureError = 'Native identity capture is incomplete; missing terminal outcomes remain untested.';
      state.checks = state.checks.map(check => check.status === 'checking' ? { ...check, status: 'untested', message: 'No terminal outcome was captured.' } : check);
    }
    try {
      const directory = resolve(options.directory, 'identity');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const evidencePath = resolve(directory, result.runId + '.json');
      await writeFile(evidencePath, JSON.stringify({ ...result, ...(resourceBindings ? { resourceBindings } : {}) }, null, 2) + '\n', { mode: 0o600 });
      state.report!.evidencePath = evidencePath;
    } catch { state.report!.captureError = [state.report!.captureError, 'Identity evidence could not be persisted.'].filter(Boolean).join(' '); }
  } catch {
    state = { ...state, status: 'failed', checkedAt: Date.now(),
      checks: state.checks.map(check => check.status === 'checking' ? { ...check, status: 'untested', message: 'No terminal outcome was captured.' } : check),
      report: { error: 'Identity checks could not start or capture evidence. Check the trusted local configuration.' } };
  } finally { unsubscribe(); publish(); }
  return state;
}
