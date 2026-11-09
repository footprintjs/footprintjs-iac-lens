import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { InfraGraph } from 'footprint-iac';
import { checkConnections, createConnectionRecorder, type ConnectionAdapter } from 'footprint-iac/connections';
import { untestedConnections } from '../core/connections.ts';
import type { ConnectionRun } from '../core/types.ts';

/** Native recorder events are the single source for connection status sent to viewers. */
export async function runConnectionReview(options: {
  graph: InfraGraph; adapter: ConnectionAdapter; directory: string; update(state: ConnectionRun): void;
}): Promise<ConnectionRun> {
  let state = untestedConnections(options.graph);
  const recorder = createConnectionRecorder();
  const publish = () => options.update(structuredClone(state));
  state.status = 'checking'; publish();
  const unsubscribe = recorder.subscribe(event => {
    const projection = recorder.getSnapshot();
    state = { ...state, id: event.runId, checks: state.checks.map(check => projection.connections[check.connectionId] ?? check), events: [...projection.events] };
    publish();
  });
  try {
    const result = await checkConnections({ graph: options.graph, adapter: options.adapter, recorders: [recorder], traceDirectory: resolve(options.directory, 'connection-traces') });
    const finalEvents = new Map(result.events.map(event => [event.connectionId, event]));
    const checks = untestedConnections(options.graph).checks.map(check => finalEvents.get(check.connectionId) ?? check);
    const complete = checks.every(check => check.status === 'connected' || check.status === 'failed');
    state = { ...state, id: result.runId, status: result.ok ? 'passed' : 'failed', checkedAt: Date.now(),
      checks, events: [...result.events],
      recording: { snapshot: result.snapshot, structure: result.structure, narrativeEntries: Array.isArray(result.narrative) ? result.narrative : [] },
      report: { tracePath: result.tracePath, traceStatus: result.traceStatus } };
    if (!complete) {
      state.status = 'failed';
      state.report!.captureError = 'Native connection capture is incomplete; missing terminal outcomes remain untested.';
      state.checks = state.checks.map(check => check.status === 'checking' ? { ...check, status: 'untested', message: 'No terminal outcome was captured.' } : check);
    }
    try {
      const directory = resolve(options.directory, 'connections');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const evidencePath = resolve(directory, result.runId + '.json');
      await writeFile(evidencePath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
      state.report!.evidencePath = evidencePath;
    } catch (error) { state.report!.captureError = error instanceof Error ? error.message : String(error); }
  } catch (error) {
    state = { ...state, status: 'failed', checkedAt: Date.now(),
      checks: state.checks.map(check => check.status === 'checking' ? { ...check, status: 'untested', message: 'No terminal outcome was captured.' } : check),
      report: { error: error instanceof Error ? error.message : String(error) } };
  } finally { unsubscribe(); publish(); }
  return state;
}
