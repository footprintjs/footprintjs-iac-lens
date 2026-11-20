import type { InfraGraph } from 'footprintjs-iac';
import type { ConnectionProgress, ConnectionRun, ConnectionStatus, DashboardState } from './types.ts';

export const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  untested: 'Not checked', checking: 'Checking', connected: 'Connected', failed: 'Failed',
};
export const CONNECTION_COLORS: Record<ConnectionStatus, string> = {
  untested: '#8e9eb3', checking: '#3478db', connected: '#31866a', failed: '#c74b4b',
};
export function untestedConnections(graph: InfraGraph): ConnectionRun {
  return { id: '', status: 'idle', events: [], checks: graph.relations.flatMap((relation, index) =>
    relation.kind === 'communicatesWith' ? [{ connectionId: `communication:${index}`, from: relation.from, to: relation.to, status: 'untested' as const }] : []) };
}
/** Only native connection events can colour a communication edge; node readiness is separate. */
export function connectionProgress(state: DashboardState, connectionId: string, from: string, to: string): ConnectionProgress {
  return state.connections?.checks.find(check => check.connectionId === connectionId && check.from === from && check.to === to)
    ?? { connectionId, from, to, status: 'untested' };
}

/** Connection indices are scoped to the graph. Check both endpoints before joining metadata. */
export function declaredConnection(graph: InfraGraph | null | undefined, check: Pick<ConnectionProgress, 'connectionId' | 'from' | 'to'>) {
  const match = /^communication:(0|[1-9][0-9]*)$/.exec(check.connectionId);
  const edge = match && graph?.relations[Number(match[1])];
  return edge && edge.kind === 'communicatesWith' && edge.from === check.from && edge.to === check.to ? edge : undefined;
}
