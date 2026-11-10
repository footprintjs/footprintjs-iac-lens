import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { checkIdentityAccess, createIdentityRecorder, type AccessCheckAdapter, type IdentityCheckRequest } from 'footprint-iac/identity';
import { untestedIdentity } from '../core/identity.ts';
import type { IdentityRun } from '../core/types.ts';

/** Trusted server composition. Credentials stay inside the adapter, outside the dashboard protocol. */
export interface IdentityReviewOptions {
  stack: string; checks: readonly IdentityCheckRequest[]; adapter: AccessCheckAdapter; label?: string;
}

export function pendingIdentity(options: IdentityReviewOptions): IdentityRun {
  return untestedIdentity(options.checks.map(({ id, label, kind, expected }) => ({ checkId: id, label, kind, expected })), options.label);
}

/** The native chart owns verdicts; the viewer only projects and stores its safe events. */
export async function runIdentityReview(options: IdentityReviewOptions & {
  directory: string; update(state: IdentityRun): void;
}): Promise<IdentityRun> {
  let state = pendingIdentity(options);
  const recorder = createIdentityRecorder();
  const publish = () => options.update(structuredClone(state));
  state.status = 'checking'; publish();
  const unsubscribe = recorder.subscribe(event => {
    const projection = recorder.getSnapshot();
    state = { ...state, id: event.runId,
      checks: state.checks.map(check => projection.checks[check.checkId] ?? check), events: [...projection.events] };
    publish();
  });
  try {
    const result = await checkIdentityAccess({ stack: options.stack, checks: options.checks, adapter: options.adapter,
      recorders: [recorder], traceDirectory: resolve(options.directory, 'identity-traces') });
    const terminal = new Map(result.events.map(event => [event.checkId, event]));
    const checks = pendingIdentity(options).checks.map(check => terminal.get(check.checkId) ?? check);
    const complete = checks.every(check => check.status === 'passed' || check.status === 'failed');
    state = { ...state, id: result.runId, status: result.ok ? 'passed' : 'failed', checkedAt: Date.now(), checks, events: [...result.events],
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
      await writeFile(evidencePath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
      state.report!.evidencePath = evidencePath;
    } catch { state.report!.captureError = [state.report!.captureError, 'Identity evidence could not be persisted.'].filter(Boolean).join(' '); }
  } catch {
    state = { ...state, status: 'failed', checkedAt: Date.now(),
      checks: state.checks.map(check => check.status === 'checking' ? { ...check, status: 'untested', message: 'No terminal outcome was captured.' } : check),
      report: { error: 'Identity checks could not start or capture evidence. Check the trusted local configuration.' } };
  } finally { unsubscribe(); publish(); }
  return state;
}
