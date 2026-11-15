import { neoIdentityChecks } from 'footprintjs-iac/integration/identity';
import type { NeoResourceFlowObservation } from 'footprintjs-iac/integration/identity/resource-flow-view';
import type { InfraGraph } from 'footprintjs-iac';
import { untestedConnections } from '../../src/core/connections.ts';
import { untestedIdentity } from '../../src/core/identity.ts';
import type { ConnectionRun, IdentityRun } from '../../src/core/types.ts';

const bindings: Record<string, readonly string[]> = {
  'directory-available': ['identity-directory'],
  'login-alice': ['identity-provider', 'identity-directory'],
  'login-wrong-password': ['identity-provider', 'identity-directory'],
  'anonymous-refused': ['neo-app'],
  'reader-allowed': ['neo-app', 'neo-access-policy', 'identity-provider'],
  'guest-denied': ['neo-app', 'neo-access-policy', 'identity-provider'],
  'tampered-token-refused': ['neo-app'],
};

/** These are actual native check runs, independent of resource readiness and the parent verdict. */
export function neoWorkspaceConnections(graph: InfraGraph, feed: NeoResourceFlowObservation): ConnectionRun {
  const pending = untestedConnections(graph), current = feed.connections.at(-1);
  if (!current) return pending;
  const snapshot = current.snapshot, result = current.result;
  return { ...pending, id: snapshot.runId ?? '',
    status: result ? result.ok ? 'passed' : 'failed' : snapshot.runId ? 'checking' : 'idle',
    checks: pending.checks.map(check => snapshot.connections[check.connectionId] ?? check),
    events: [...snapshot.events],
    ...(result ? { checkedAt: Math.max(0, ...snapshot.events.map(event => event.timestamp)),
      report: { evidencePath: result.evidencePath, tracePath: result.tracePath,
        ...(!result.traceFlushed ? { captureError: 'The native connection trace is incomplete.' } : {}) } } : {}),
  };
}

export function neoWorkspaceIdentity(feed: NeoResourceFlowObservation): IdentityRun {
  const pending = untestedIdentity(neoIdentityChecks.map(({ id, label, kind, expected }) => ({ checkId: id, label, kind, expected })), 'Sign-in & access');
  const current = feed.identities.at(-1);
  const bind = <T extends { checkId: string }>(check: T) => ({ ...check, resourceIds: [...bindings[check.checkId] ?? []] });
  if (!current) return { ...pending, checks: pending.checks.map(bind) };
  const snapshot = current.snapshot, result = current.result;
  return { ...pending, id: snapshot.runId ?? '',
    status: result ? result.ok ? 'passed' : 'failed' : snapshot.runId ? 'checking' : 'idle',
    checks: pending.checks.map(check => bind(snapshot.checks[check.checkId] ?? check)),
    events: snapshot.events.map(bind),
    ...(result ? { checkedAt: Math.max(0, ...snapshot.events.map(event => event.timestamp)),
      report: { evidencePath: result.evidencePath, tracePath: result.tracePath,
        ...(!result.traceFlushed ? { captureError: 'The native access trace is incomplete.' } : {}) } } : {}),
  };
}
