import type { IdentityProgress, IdentityRun } from './types.ts';

export const IDENTITY_LABELS = Object.freeze({ untested: 'Not checked', checking: 'Checking', passed: 'Passed', failed: 'Failed' });
export const IDENTITY_VERDICT_LABELS = Object.freeze({ authenticated: 'Authenticated', rejected: 'Login rejected', allowed: 'Allowed', denied: 'Denied', available: 'Available', unavailable: 'Unavailable' });

/** An expected denial passes only when the recorded verdict actually says denied. */
export function identityOutcomeLabel(check: IdentityProgress): string {
  if (check.status === 'passed' && check.observation) return `${IDENTITY_VERDICT_LABELS[check.observation.verdict]} · expected`;
  if (check.status === 'failed' && check.observation) return `${IDENTITY_VERDICT_LABELS[check.observation.verdict]} · failed check`;
  return IDENTITY_LABELS[check.status];
}

export function untestedIdentity(checks: readonly Pick<IdentityProgress, 'checkId' | 'label' | 'kind' | 'expected'>[], label = 'Identity and access'): IdentityRun {
  return { id: '', label, status: 'idle', checks: checks.map(check => ({ ...check, status: 'untested' })), events: [] };
}
