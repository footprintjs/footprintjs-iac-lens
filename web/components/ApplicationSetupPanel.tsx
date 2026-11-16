import { lazy, Suspense, useEffect, useState } from 'react';
import type { ApplicationAction, ApplicationView } from '../../src/core/application.ts';
import type { DashboardState } from '../../src/core/types.ts';
import { applicationAppUrl, applicationHeadline, applicationNextAction, applicationProfiles, applicationSelectionAction, applicationSetupSteps, applicationTarget, sameApplicationSelection } from '../lib/application-setup.ts';
import { ConnectionProfilesControl, type ConnectionProfileHandler } from './ConnectionProfilesControl.tsx';
import { DetailsPanel } from './DetailsPanel.tsx';
import { Icon } from './Icon.tsx';
import { ApplicationSourceDetails, ApplicationSourceProgress } from './ApplicationSourceProgress.tsx';
import './application-setup.css';

const EvidenceView = lazy(() => import('./EvidenceView.tsx'));
export type ApplicationActionHandler = (input: ApplicationAction) => void;
const changeLabels = { create: 'Create', update: 'Update', noop: 'Unchanged', replace: 'Replace', delete: 'Remove', blocked: 'Needs attention' };
const checkLabels = { passed: 'Passed', failed: 'Failed', unknown: 'Not confirmed' };

export function ApplicationSetupDetails({ state }: { state: DashboardState }) {
  const view = state.application;
  if (!view) return null;
  const strategy = view.strategies.find(strategy => strategy.id === view.selection?.strategyId);
  const target = strategy?.targets.find(target => target.id === view.selection?.targetId);
  return <div className="application-details">
    <dl><div><dt>Application</dt><dd>{view.label}</dd></div><div><dt>Deployment</dt><dd>{strategy?.label ?? 'Not selected'}</dd></div><div><dt>Target</dt><dd>{target?.label ?? 'Not selected'}</dd></div>
      {view.selection?.profileId && <div><dt>Saved connection</dt><dd>{state.connectionProfiles?.profiles.find(profile => profile.id === view.selection?.profileId)?.label ?? view.selection.profileId}</dd></div>}
      {view.review?.reviewId && <div><dt>Sealed review</dt><dd><code>{view.review.reviewId}</code></dd></div>}
      <div><dt>Current setup status</dt><dd>{view.phase}</dd></div>
      {view.deployment && <div><dt>Last deployment result</dt><dd>{view.deployment.status}</dd></div>}
      {view.reconciliation && <div><dt>Outcome inspection</dt><dd>{view.reconciliation.status === 'reconciled-failed' ? 'Failure confirmed' : 'Available'}<small>Review <code>{view.reconciliation.reviewId}</code></small>
        {view.reconciliation.status === 'reconciled-failed' && <small>Native recording <code>{view.reconciliation.recording.runId}</code></small>}</dd></div>}
    </dl>
    {view.description && <p>{view.description}</p>}
    {state.source && <ApplicationSourceDetails source={state.source}/>}
    {view.inspection && <section><h3>Setup checks</h3><CheckResults checks={view.inspection.checks}/></section>}
    {view.review && <section><h3>Reviewed changes</h3>{view.review.changes.length ? <table><thead><tr><th>Resource</th><th>Action</th></tr></thead><tbody>{view.review.changes.map(change => <tr key={change.resourceId}><td>{change.label}<small>{change.resourceId}</small></td><td>{changeLabels[change.action]}</td></tr>)}</tbody></table> : <p>No resource changes were reported.</p>}</section>}
    {view.deployment?.checks && <section><h3>Application verification</h3><CheckResults checks={view.deployment.checks}/></section>}
    {view.error && <p className="application-issue" role="status">{view.error}</p>}
    {!state.recording && <p>Native recording is not available in this view yet.</p>}
  </div>;
}

function CheckResults({ checks }: { checks: NonNullable<ApplicationView['inspection']>['checks'] }) {
  return <ul className="application-check-results">{checks.map(check => <li key={check.id} className={'application-check-' + check.status}><span>{check.label}<small>{check.id}</small></span><strong>{checkLabels[check.status]}</strong></li>)}</ul>;
}

/** Generic setup controls; only host-registered identities cross the browser boundary. */
export function ApplicationSetupPanel({ state, posting, onAction, onProfileAction, technical = false }: {
  state: DashboardState; posting: boolean; onAction?: ApplicationActionHandler; onProfileAction?: ConnectionProfileHandler; technical?: boolean;
}) {
  const view = state.application!;
  const [strategyId, setStrategyId] = useState(view.selection?.strategyId ?? '');
  const [targetId, setTargetId] = useState(view.selection?.targetId ?? '');
  const [profileId, setProfileId] = useState(view.selection?.profileId);
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState<'details' | 'recording'>();
  useEffect(() => {
    setStrategyId(view.selection?.strategyId ?? ''); setTargetId(view.selection?.targetId ?? ''); setProfileId(view.selection?.profileId);
  }, [view.id, view.selection?.strategyId, view.selection?.targetId, view.selection?.profileId]);
  useEffect(() => { if (view.inspection?.ok || view.busy) setEditing(false); }, [view.inspection?.ok, view.busy]);
  const strategy = view.strategies.find(strategy => strategy.id === strategyId);
  const target = applicationTarget(view, strategyId, targetId);
  const profiles = applicationProfiles(state.connectionProfiles, target);
  const draft = target ? { strategyId, targetId, ...(profileId ? { profileId } : {}) } : undefined;
  const current = sameApplicationSelection(view.selection, draft);
  const uncertain = view.phase === 'incomplete';
  const showOutcome = current || uncertain;
  const compactSelection = !technical && current && !editing && (view.busy || view.inspection?.ok === true || view.phase === 'ready' && view.deployment?.promoted === true);
  const disabled = posting || state.busy || view.busy || state.connectionProfiles?.busy === true;
  const selectionDisabled = disabled || uncertain;
  const next = applicationNextAction(view);
  const choose = (nextStrategy: string, nextTarget: string, nextProfile?: string) => {
    setStrategyId(nextStrategy); setTargetId(nextTarget); setProfileId(nextProfile);
    const action = applicationSelectionAction(view, nextStrategy, nextTarget, nextProfile);
    if (action) onAction?.(action);
  };
  const changes = current ? view.review?.changes : undefined;
  const affected = changes?.filter(change => change.action !== 'noop').length ?? 0;
  const unchanged = changes?.filter(change => change.action === 'noop').length ?? 0;
  const checks = current ? view.deployment?.checks ?? view.inspection?.checks : undefined;
  const appUrl = current ? applicationAppUrl(view) : undefined;
  return <>
    <section className={'application-setup application-phase-' + view.phase} aria-label="Application setup">
      <header className="application-setup-heading"><div><span>Application setup</span><h2>{showOutcome ? applicationHeadline(view) : 'Choose where your app will run'}</h2>{view.description && <p>{view.description}</p>}</div>
        <div className="application-setup-tools"><button type="button" onClick={() => setPanel('details')}>{technical ? 'Setup details' : 'Details'}</button>
          <button type="button" disabled={!state.recording} onClick={() => setPanel('recording')} aria-label="Inspect application recording"><Icon name="evidence" size={15}/>{technical && 'View recording'}</button></div>
      </header>
      <ol className="application-setup-steps" aria-label="Setup progress">{applicationSetupSteps(view).map((step, index) => <li key={step.id} className={'application-step-' + (showOutcome || step.id === 'choose' ? step.status : 'pending')} aria-label={step.label + ': ' + (showOutcome || step.id === 'choose' ? step.status : 'pending')}>
        <span>{step.status === 'passed' && current ? <Icon name="check" size={12}/> : index + 1}</span><strong>{step.label}</strong></li>)}</ol>
      {current && state.source && <ApplicationSourceProgress source={state.source}/>}
      {compactSelection ? <div className="application-selected-summary"><span>{strategy?.label}</span><span>{target?.label}</span>{profileId && <span>{profiles?.profiles.find(profile => profile.id === profileId)?.label ?? 'Saved connection'}</span>}
        <button type="button" disabled={selectionDisabled} onClick={() => setEditing(true)}>Change setup</button></div> : <><div className="application-setup-fields"><label>Run on<select aria-label="Deployment strategy" value={strategyId} disabled={selectionDisabled} onChange={event => {
        const selected = view.strategies.find(item => item.id === event.target.value);
        if (selected) choose(selected.id, selected.targets.length === 1 ? selected.targets[0]!.id : '');
      }}><option value="">Choose a deployment</option>{view.strategies.map(strategy => <option value={strategy.id} key={strategy.id}>{strategy.label}</option>)}</select></label>
        <label>Target<select aria-label="Deployment target" value={targetId} disabled={selectionDisabled || !strategy} onChange={event => choose(strategyId, event.target.value)}>
          <option value="">Choose a target</option>{strategy?.targets.map(target => <option value={target.id} key={target.id}>{target.label}</option>)}</select></label>
        <div className="application-target-note">{target?.description ?? strategy?.description ?? 'Choose a registered target, then check its setup.'}</div>
      </div>
      {profiles && (profiles.schemas.length > 0 || profiles.profiles.length > 0) && <ConnectionProfilesControl view={profiles} selected={profileId} locked={view.busy || uncertain} disabled={selectionDisabled}
        onSelect={id => choose(strategyId, targetId, id)} onAction={onProfileAction}/>}
      {target?.requiresProfile && (!profiles || (!profiles.schemas.length && !profiles.profiles.length)) && <p className="application-issue">This target needs a saved connection. Its host has not provided a connection setup form.</p>}</>}
      {current && changes && <div className="application-change-summary" aria-label="Changes ready for review"><strong>{affected} {affected === 1 ? 'change' : 'changes'}</strong><span>{unchanged} unchanged</span><button type="button" onClick={() => setPanel('details')}>Review details<Icon name="arrow" size={13}/></button></div>}
      {checks && checks.length > 0 && <div>{view.phase === 'incomplete' && <small className="application-recorded-note">Last recorded checks</small>}<ul className="application-quick-checks" aria-label={view.phase === 'incomplete' ? 'Last recorded checks' : view.deployment ? 'Application checks' : 'Setup checks'}>{checks.map(check => <li key={check.id} className={'application-check-' + check.status}><span/>{check.label}<strong>{checkLabels[check.status]}</strong></li>)}</ul></div>}
      {showOutcome && view.error && <p className="application-issue" role="status">{view.error}</p>}
      {uncertain && <p className="application-issue">The last operation has an unconfirmed result. {view.reconciliation?.status === 'available' ? 'Inspect its outcome before continuing.' : 'Refresh its recorded status before deciding what to do next.'}</p>}
      {current && view.reconciliation?.status === 'reconciled-failed' && <p className="application-issue">Failure confirmed. Check setup and review a new change to recover.</p>}
      <footer className="application-setup-footer"><span>{uncertain ? 'Inspect the last record before continuing' : !target ? 'Choose a target to continue' : !current ? 'Waiting for this selection to be confirmed' : target.requiresProfile && !profileId ? 'Choose a saved connection before checking' : view.phase === 'ready' && view.deployment?.promoted ? 'Deployment and application checks passed' : 'Changes are applied only after you review them'}</span>
        {appUrl && <a className="simple-button simple-secondary" href={appUrl} target="_blank" rel="noreferrer">Open app<Icon name="external" size={14}/></a>}
        <button type="button" className="simple-button simple-primary" disabled={disabled || !onAction || !next.enabled || (!current && next.action?.action !== 'refresh')} onClick={() => { if (next.action) onAction?.(next.action); }}>{next.label}</button>
      </footer>
    </section>
    {panel && <DetailsPanel title={panel === 'recording' ? 'Application execution recording' : 'Application setup details'} onClose={() => setPanel(undefined)}>
      {panel === 'recording' ? <Suspense fallback={<p>Opening recorded execution…</p>}><EvidenceView recording={state.recording} running={view.busy} title="Application execution"/></Suspense> : <ApplicationSetupDetails state={state}/>}
    </DetailsPanel>}
  </>;
}
