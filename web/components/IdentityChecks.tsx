import { useState } from 'react';
import { identityOutcomeLabel, IDENTITY_VERDICT_LABELS } from '../../src/core/identity.ts';
import { eventTime } from '../../src/core/model.ts';
import type { DashboardState } from '../../src/core/types.ts';
import { DetailsPanel } from './DetailsPanel.tsx';
import { Icon } from './Icon.tsx';

export function IdentityChecks({ state, compact = false, onCheck, onEvidence }: {
  state: DashboardState; compact?: boolean; onCheck(): void; onEvidence(): void;
}) {
  const [selected, setSelected] = useState<string>();
  const [open, setOpen] = useState(false);
  const run = state.identity;
  if (!run) return null;
  const focused = run.checks.find(check => check.checkId === selected);
  const passed = run.checks.filter(check => check.status === 'passed').length;
  const failed = run.checks.filter(check => check.status === 'failed').length;
  const inspectRecording = () => { setOpen(false); onEvidence(); };
  const checks = <>
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
    </div>}
    {run.report?.captureError && <p className="identity-run-error" role="status">{run.report.captureError}</p>}
  </>;
  const checkButton = <button className="button button-secondary"
    disabled={state.busy || (state.resourceFlow ? state.identityReviewAvailable !== true || state.resourceFlow.status !== 'passed' : state.managedReviewAvailable && state.run?.status !== 'passed')} onClick={onCheck}>
    {run.status === 'checking' ? 'Checking access…' : compact ? 'Check access' : 'Check identity and access'}
  </button>;
  return <section className={`identity-checks${compact ? ' identity-compact' : ''}`} aria-label="Identity and access checks">
    {compact ? <div className="identity-compact-bar">
      <button className="identity-summary" onClick={() => setOpen(true)} aria-label={`${run.label}, ${passed} passed, ${failed} failed`}>
        <Icon name="identity" size={16}/><strong>Access checks</strong><span>{passed}/{run.checks.length} passed{failed ? ` · ${failed} failed` : ''}</span>
        <span className="identity-marks" aria-hidden="true">{run.checks.map(check => <i key={check.checkId} className={`identity-dot identity-${check.status}`}/>)}</span>
        <Icon name="chevron" size={12}/>
      </button>
      <span className="identity-checks-time">{run.status === 'checking' ? 'Checking' : run.checkedAt ? eventTime(run.checkedAt) : 'Not checked'}</span>
      {checkButton}
    </div> : <div className="identity-checks-bar"><div className="identity-checks-heading"><Icon name="identity" size={17}/><strong>{run.label}</strong>
      <span className="identity-checks-time">{run.status === 'checking' ? 'Checking actual access' : run.checkedAt ? `Checked ${eventTime(run.checkedAt)}` : 'Not checked yet'}</span></div>
      <div className="identity-checks-actions"><button className="text-button" disabled={!run.recording} onClick={inspectRecording}>Inspect identity recording</button>{checkButton}</div>
    </div>}
    {compact ? open && <DetailsPanel title={run.label} onClose={() => setOpen(false)}>
      <div className="identity-checks-actions"><button className="text-button" disabled={!run.recording} onClick={inspectRecording}>Inspect identity recording</button></div>{checks}
    </DetailsPanel> : checks}
  </section>;
}
