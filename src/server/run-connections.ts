import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { InfraGraph } from 'footprint-iac';
import { checkConnections, createConnectionRecorder, type ConnectionAdapter } from 'footprint-iac/connections';
import { untestedConnections } from '../core/connections.ts';
import type { ConnectionProgress, ConnectionRun } from '../core/types.ts';

/** Probe configuration belongs to the trusted host, independent of viewer requests. */
export interface ConnectionReviewOptions {
  adapter: ConnectionAdapter;
  label?: string;
  description?: string;
  scopes?: Readonly<Record<string, string>>;
}

export function readConnectionReview(options: ConnectionReviewOptions, graph: InfraGraph): ConnectionReviewOptions {
  if (!options.adapter || typeof options.adapter.check !== 'function') throw Error('A connection review needs a configured adapter');
  const validText = (value: unknown) => typeof value === 'string' && value.trim().length > 0
    && value.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(value);
  if ((options.label !== undefined && !validText(options.label))
    || (options.description !== undefined && !validText(options.description))) throw Error('Invalid connection review description');
  const ids = new Set(untestedConnections(graph).checks.map(check => check.connectionId));
  if (options.scopes !== undefined && (!options.scopes || typeof options.scopes !== 'object' || Array.isArray(options.scopes))) {
    throw Error('Connection scopes must name declared communication checks');
  }
  const scopes = Object.entries(options.scopes ?? {});
  if (scopes.some(([id, scope]) => !ids.has(id) || !validText(scope))) throw Error('Connection scopes must name declared communication checks');
  return Object.freeze({
    adapter: Object.freeze({ check: options.adapter.check.bind(options.adapter) }),
    ...(options.label !== undefined && { label: options.label }),
    ...(options.description !== undefined && { description: options.description }),
    ...(options.scopes !== undefined && { scopes: Object.freeze(Object.fromEntries(scopes)) }),
  });
}

function withScope<T extends ConnectionProgress>(check: T, options: Pick<ConnectionReviewOptions, 'scopes'>): T {
  const scopeDescription = options.scopes && Object.hasOwn(options.scopes, check.connectionId) ? options.scopes[check.connectionId] : undefined;
  return scopeDescription ? { ...check, scopeDescription } : check;
}

export function pendingConnectionReview(graph: InfraGraph, options: Partial<ConnectionReviewOptions> = {}): ConnectionRun {
  const pending = untestedConnections(graph);
  return { ...pending, checks: pending.checks.map(check => withScope(check, options)),
    ...(options.label !== undefined && { label: options.label }),
    ...(options.description !== undefined && { scopeDescription: options.description }) };
}

/** Native recorder events are the single source for connection status sent to viewers. */
export async function runConnectionReview(options: ConnectionReviewOptions & {
  graph: InfraGraph; directory: string; update(state: ConnectionRun): void;
}): Promise<ConnectionRun> {
  let state = pendingConnectionReview(options.graph, options);
  const recorder = createConnectionRecorder();
  const publish = () => options.update(structuredClone(state));
  state.status = 'checking'; publish();
  const unsubscribe = recorder.subscribe(event => {
    const projection = recorder.getSnapshot();
    state = { ...state, id: event.runId,
      checks: state.checks.map(check => withScope(projection.connections[check.connectionId] ?? check, options)),
      events: projection.events.map(event => withScope(event, options)) };
    publish();
  });
  try {
    const result = await checkConnections({ graph: options.graph, adapter: options.adapter, recorders: [recorder], traceDirectory: resolve(options.directory, 'connection-traces') });
    const finalEvents = new Map(result.events.map(event => [event.connectionId, event]));
    const checks = pendingConnectionReview(options.graph, options).checks.map(check => withScope(finalEvents.get(check.connectionId) ?? check, options));
    const complete = checks.every(check => check.status === 'connected' || check.status === 'failed');
    state = { ...state, id: result.runId, status: result.ok ? 'passed' : 'failed', checkedAt: Date.now(),
      checks, events: result.events.map(event => withScope(event, options)),
      recording: { snapshot: result.snapshot, structure: result.structure, narrativeEntries: Array.isArray(result.narrative) ? result.narrative : [] },
      report: { tracePath: result.tracePath, traceStatus: result.traceStatus } };
    if (result.traceStatus && (result.traceStatus.failed > 0 || result.traceStatus.flushed === false)) {
      state.report!.captureError = 'The native JSONL trace is incomplete. The captured snapshot remains available; trace replay may have gaps.';
    }
    if (!complete) {
      state.status = 'failed';
      state.report!.captureError = 'Native connection capture is incomplete; missing terminal outcomes remain untested.';
      state.checks = state.checks.map(check => check.status === 'checking' ? { ...check, status: 'untested', message: 'No terminal outcome was captured.' } : check);
    }
    try {
      const directory = resolve(options.directory, 'connections');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const evidencePath = resolve(directory, result.runId + '.json');
      await writeFile(evidencePath, JSON.stringify({ ...result,
        ...(options.label !== undefined && { label: options.label }),
        ...(options.description !== undefined && { scopeDescription: options.description }),
        ...(options.scopes !== undefined && { scopes: options.scopes }) }, null, 2) + '\n', { mode: 0o600 });
      state.report!.evidencePath = evidencePath;
    } catch { state.report!.captureError = [state.report!.captureError, 'Connection evidence could not be persisted.'].filter(Boolean).join(' '); }
  } catch {
    state = { ...state, status: 'failed', checkedAt: Date.now(),
      checks: state.checks.map(check => check.status === 'checking' ? { ...check, status: 'untested', message: 'No terminal outcome was captured.' } : check),
      report: { error: 'Connection checks could not start or capture evidence. Check the trusted local configuration.' } };
  } finally { unsubscribe(); publish(); }
  return state;
}
