import { lazy, Suspense, useState } from 'react';
import { onboardingNextAction, type OnboardingAction } from '../../../src/core/onboarding.ts';
import { onboardingVersionAllowsReadiness, type OnboardingVersionAction } from '../../../src/core/onboarding-versions.ts';
import type { DashboardState } from '../../../src/core/types.ts';
import { DetailsPanel } from '../../components/DetailsPanel.tsx';
import { Icon } from '../../components/Icon.tsx';
import { OnboardingCheckList, OnboardingCheckDetails } from './OnboardingChecks.tsx';
import { OnboardingVersionSlot } from './versions/OnboardingVersionSlot.tsx';
import onboardingStyles from './onboarding.css' with { type: 'text' };

const EvidenceView = lazy(() => import('../../components/EvidenceView.tsx'));
const statuses = { pending: 'Waiting', running: 'Working', passed: 'Ready', failed: 'Needs attention', unknown: 'Not confirmed' };
const changes = { create: 'Create', update: 'Update', noop: 'Unchanged', replace: 'Replace', delete: 'Remove', blocked: 'Needs attention' };

export default function OnboardingPanel({ state, posting, technical = false, onAction, onVersionAction }: {
  state: DashboardState; posting: boolean; technical?: boolean; onAction?(input: OnboardingAction): void; onVersionAction?(input: OnboardingVersionAction): void;
}) {
  const view = state.onboarding!, next = onboardingNextAction(view);
  const [panel, setPanel] = useState<'details' | 'recording'>();
  const disabled = posting || state.busy || view.busy;
  const current = view.stages.find(stage => stage.status === 'running');
  const currentVersionReady = onboardingVersionAllowsReadiness(state.onboardingRegistry);
  const ready = currentVersionReady && !view.busy && view.status === 'ready' && view.deployment?.promoted;
  const headline = ready ? 'Your app is ready' : current ? `${current.label}…` : view.busy ? 'Reading setup…' : !currentVersionReady ? 'Inspect the setup update' : view.status === 'incomplete' ? 'Inspect the recorded outcome' : view.status === 'failed' ? 'Setup needs attention' : view.status === 'reviewed' ? 'Ready for your review' : 'Connect your application';
  const affected = view.review?.changes.filter(change => change.action !== 'noop').length;
  const applicationChecks = view.deployment?.checks;
  const checks = applicationChecks ?? view.checks;
  return <>
    <section className="onboarding-panel" aria-label="Application onboarding">
      <style>{onboardingStyles}</style>
      <header><div><span className="onboarding-eyebrow">Application setup</span><h2 aria-live="polite">{headline}</h2><p>{technical ? `${view.strategyId} · ${view.targetId}` : 'One recorded flow, from existing setup to a verified deployment.'}</p></div><div className="onboarding-tools"><button type="button" onClick={() => setPanel('details')}>Details</button><button type="button" aria-label="Inspect onboarding recording" disabled={!state.onboardingRecording} onClick={() => setPanel('recording')}><Icon name="evidence" size={16}/></button></div></header>
      <OnboardingVersionSlot state={state} posting={posting} technical={technical} onAction={onVersionAction}/>
      <ol className="onboarding-stages" aria-label="Recorded setup progress">{view.stages.map((stage, index) => <li key={stage.id} className={'onboarding-stage-' + stage.status} aria-label={`${stage.label}: ${statuses[stage.status]}`}><span className="onboarding-stage-number">{stage.status === 'passed' ? <Icon name="check" size={14}/> : index + 1}</span><strong>{stage.label}</strong><small>{statuses[stage.status]}</small></li>)}</ol>
      <OnboardingCheckList checks={checks} application={applicationChecks !== undefined} technical={technical}/>
      {view.review && <div className="onboarding-review"><strong>{affected ?? 0} {(affected ?? 0) === 1 ? 'change' : 'changes'}</strong><span>{view.review.changes.filter(change => change.action === 'noop').length} unchanged</span><button type="button" onClick={() => setPanel('details')}>Review details</button></div>}
      {(view.error || state.onboardingError) && <p className="onboarding-error" role="status">{view.error ?? state.onboardingError}</p>}
      {view.status === 'incomplete' && <p className="onboarding-error">The last result is unconfirmed. Inspect its outcome before another deployment.</p>}
      <footer><span>{ready ? 'Deployment and application checks passed.' : view.status === 'verified' ? 'Setup checks passed. Review changes before deployment.' : view.status === 'reviewed' ? 'Only this reviewed change will be deployed.' : 'Progress comes from native FootPrint records.'}</span><button type="button" className="simple-button simple-secondary" disabled={disabled || !onAction} onClick={() => onAction?.({ action: 'refresh' })}>Read status</button><button type="button" className="simple-button simple-primary" disabled={disabled || !next.action || !onAction} onClick={() => { if (next.action) onAction?.(next.action); }}>{next.label}</button></footer>
    </section>
    {panel && <DetailsPanel title={panel === 'recording' ? 'Onboarding execution recording' : 'Application setup details'} onClose={() => setPanel(undefined)}>{panel === 'recording' ? <Suspense fallback={<p>Opening recording…</p>}><EvidenceView recording={state.onboardingRecording} running={view.busy} title="Onboarding execution"/></Suspense> : <div className="onboarding-details"><dl><dt>Preset</dt><dd>{view.id}</dd><dt>Strategy</dt><dd>{view.strategyId}</dd><dt>Target</dt><dd>{view.targetId}</dd><dt>Configuration identity</dt><dd><code>{view.configurationDigest}</code></dd>{view.profileId && <><dt>Saved connection</dt><dd>{view.profileId}</dd></>}{view.review?.reviewId && <><dt>Sealed review</dt><dd><code>{view.review.reviewId}</code></dd></>}{view.recording && <><dt>Native run</dt><dd><code>{view.recording.runId}</code></dd></>}</dl>{view.review && <table><thead><tr><th>Resource</th><th>Action</th></tr></thead><tbody>{view.review.changes.map(change => <tr key={change.resourceId}><td>{change.label}<small>{change.resourceId}</small></td><td>{changes[change.action]}</td></tr>)}</tbody></table>}{view.deployment && <p>Deployment outcome: {view.deployment.status}</p>}<OnboardingCheckDetails checks={checks} application={applicationChecks !== undefined}/><p>Verify checks the registered setup. Deployment readiness additionally requires the application's configured checks. A diagram is declared structure; the native recording supplies observed execution.</p></div>}</DetailsPanel>}
  </>;
}
