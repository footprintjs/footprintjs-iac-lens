import { readFile, lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadEvidence, type InfraGraph } from 'footprintjs-iac';
import type { DeliveryState } from 'footprintjs-iac/delivery';
import type { ConnectionRunResult, ConnectionSnapshot } from 'footprintjs-iac/connections';
import type { IdentityRunResult, IdentitySnapshot } from 'footprintjs-iac/identity';
import type { DeliveryPublication } from '../../src/server/delivery.ts';
import { neoDeliveryConnections, neoDeliveryIdentity } from './projection.ts';

/** Reopening Lens restores measured terminal outcomes from their fixed native receipt files. */
export async function hydrateNeoDeliveryChecks(state: DeliveryState, directory: string, graph: InfraGraph): Promise<DeliveryPublication> {
  if (!state.results.verification) return {};
  const receipts = state.results.verification.metadata?.receipts;
  if (!Array.isArray(receipts) || receipts.length !== 2) throw Error('Neo verification receipts are incomplete');
  const patch: DeliveryPublication = {};
  for (const [kind, id] of [['connections', 'neo-connections'], ['identity', 'neo-access']] as const) {
    const receipt = receipts.find(value => value && typeof value === 'object' && !Array.isArray(value) && value.id === id);
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || typeof receipt.runId !== 'string'
      || !/^[a-zA-Z0-9-]{1,128}$/.test(receipt.runId) || typeof receipt.evidencePath !== 'string') throw Error('Neo verification receipt is invalid');
    const path = join(directory, kind, receipt.runId + '.json');
    const info = await lstat(path);
    if (resolve(receipt.evidencePath) !== path || !info.isFile() || info.isSymbolicLink()
      || info.size > 16 * 1024 * 1024 || await realpath(path) !== path) throw Error('Neo verification receipt is outside its fixed directory');
    const result = JSON.parse(await readFile(path, 'utf8')) as ConnectionRunResult | IdentityRunResult;
    const evidence = await loadEvidence(path);
    if (result.runId !== receipt.runId || evidence.runId !== receipt.runId || result.stack !== graph.name
      || !evidence.structure || !result.traceStatus?.flushed || result.traceStatus.failed !== 0
      || ('graph' in result && result.graph.digest !== graph.digest)) throw Error('Neo verification evidence does not match this delivery');
    const native = evidence.snapshot.sharedState as Record<string, { status?: string; runId?: string }>;
    if (kind === 'connections') {
      const record = result as ConnectionRunResult;
      if (Object.keys(record.checks).length !== 3 || Object.values(record.checks).some(check =>
        native['progress:' + check.connectionId]?.status !== check.status || native['progress:' + check.connectionId]?.runId !== record.runId)) {
        throw Error('Neo connection outcomes differ from their native recording');
      }
      const snapshot: ConnectionSnapshot = { version: 1, runId: record.runId, sequence: record.events.at(-1)?.sequence ?? 0,
        connections: Object.fromEntries(record.events.map(event => [event.connectionId, event])), events: record.events,
        ignoredEvents: 0, subscriberFailures: 0 };
      patch.connections = neoDeliveryConnections(graph, snapshot, record);
    } else {
      const record = result as IdentityRunResult;
      if (Object.keys(record.checks).length !== 7 || Object.values(record.checks).some(check =>
        native['progress:' + check.checkId]?.status !== check.status || native['progress:' + check.checkId]?.runId !== record.runId)) {
        throw Error('Neo access outcomes differ from their native recording');
      }
      const snapshot: IdentitySnapshot = { version: 1, runId: record.runId, sequence: record.events.at(-1)?.sequence ?? 0,
        checks: Object.fromEntries(record.events.map(event => [event.checkId, event])), events: record.events,
        ignoredEvents: 0, subscriberFailures: 0 };
      patch.identity = neoDeliveryIdentity(snapshot, record);
    }
  }
  return patch;
}
