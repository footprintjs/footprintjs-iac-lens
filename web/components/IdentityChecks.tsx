import { useState } from 'react';
import { identityOutcomeLabel, IDENTITY_VERDICT_LABELS } from '../../src/core/identity.ts';
import { eventTime } from '../../src/core/model.ts';
import type { DashboardState } from '../../src/core/types.ts';
import { Icon } from './Icon.tsx';

export function IdentityChecks({ state, onCheck, onEvidence }: {
  state: DashboardState; onCheck(): void; onEvidence(): void;
}) {
  const [selected, setSelected] = useState<string>();
  const run = state.identity;
  if (!run) return null;
  const focused = run.checks.find(check => check.checkId === selected);
  return <section className="identity-checks" aria-label="Identity and access checks">
    <div className="identity-checks-bar"><div className="identity-checks-heading"><Icon name="identity" size={17}/><strong>{run.label}</strong>
      <span className="identity-checks-time">{run.status === 'checking' ? 'Checking actual access' : run.checkedAt ? `Checked ${eventTime(run.checkedAt)}` : 'Not checked yet'}</span></div>
      <div className="identity-checks-actions"><button className="text-button" disabled={!run.recording} onClick={onEvidence}>Inspect identity recording</button>
        <button className="button button-secondary" disabled={state.busy || (state.managedReviewAvailable && state.run?.status !== 'passed')} onClick={onCheck}>{run.status === 'checking' ? 'Checking identity and access…' : 'Check identity and access'}</button></div></div>
    <p className="identity-checks-scope">Expected rejection or denial passes only when it is observed. An unavailable identity service fails the check.</p>
    <div className="identity-check-list">{run.checks.map(check => <button key={check.checkId}
      className={`identity-check-row identity-${check.status}`} aria-expanded={focused?.checkId === check.checkId}
      onClick={() => setSelected(focused?.checkId === check.checkId ? undefined : check.checkId)}>
      <i className={`identity-dot identity-${check.status}`}/><span>{check.label}</span><strong>{identityOutcomeLabel(check)}</strong><Icon name="chevron" size={12}/>
    </button>)}</div>
    {run.report?.error && <p className="identity-run-error" role="status">{run.report.error}</p>}
    {focused && <div className="identity-details"><div className="identity-details-heading"><strong>{focused.label}</strong><span>{identityOutcomeLabel(focused)}</span></div>
      <dl><dt>Expected</dt><dd>{IDENTITY_VERDICT_LABELS[focused.expected]}</dd><dt>Observed</dt><dd>{focused.observation ? IDENTITY_VERDICT_LABELS[focused.observation.verdict] : 'Not observed'}</dd>
        {focused.observation && <><dt>Checked</dt><dd>{eventTime(focused.observation.observedAt)} · {Math.round(focused.observation.latencyMs)} ms</dd></>}</dl>
      {focused.message && <p role="status">{focused.message}</p>}
      {focused.observation?.details && <details><summary>Recorded access details</summary><pre>{JSON.stringify(focused.observation.details, null, 2)}</pre></details>}
      <p className="identity-checks-scope">Point-in-time verification against the configured identity and application adapters. Resource readiness and successful authentication do not imply authorization.</p>
    </div>}
    {run.report?.captureError && <p className="identity-run-error" role="status">{run.report.captureError}</p>}
  </section>;
}
