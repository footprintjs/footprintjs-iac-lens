import type { OnboardingSnapshot } from '../../../src/core/onboarding.ts';

const statuses = { passed: 'Passed', failed: 'Failed', unknown: 'Not confirmed' };
export type OnboardingChecks = OnboardingSnapshot['checks'];
/** Check identities and outcomes are supplied by the native workflow, never inferred from resource readiness. */
export function OnboardingCheckList({ checks, application, technical = false }: { checks: OnboardingChecks; application: boolean; technical?: boolean }) {
  if (!checks.length) return null;
  return <section className="onboarding-observations" aria-label={application ? 'Recorded application checks' : 'Recorded setup checks'}><h3>{application ? 'App checks' : 'Setup checks'}</h3>
    <ul className="onboarding-checks">{checks.map(check => <li key={check.id} data-check-id={check.id} className={'onboarding-check-' + check.status}><span/><span>{check.label}{technical && <small>{check.id}</small>}</span><strong>{statuses[check.status]}</strong></li>)}</ul>
  </section>;
}
export function OnboardingCheckDetails({ checks, application }: { checks: OnboardingChecks; application: boolean }) {
  if (!checks.length) return null;
  return <section><h3>{application ? 'Application checks' : 'Setup checks'}</h3><table><thead><tr><th>Check</th><th>Recorded result</th></tr></thead><tbody>{checks.map(check => <tr key={check.id}><td>{check.label}<small>{check.id}</small></td><td>{statuses[check.status]}</td></tr>)}</tbody></table></section>;
}
