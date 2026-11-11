import { projectBuildScene } from '../../src/core/build-scene.ts';
import { projectRevisionReview } from '../../src/core/revision-review.ts';
import type { DashboardState, Scenario } from '../../src/core/types.ts';
import { BuildScene } from './BuildScene.tsx';
import { Icon } from './Icon.tsx';
import { ChangeReview } from './ChangeReview.tsx';
import './simple-dashboard.css';

function checkLabel(status: string | undefined, passed: number, total: number) {
  if (status === 'checking') return 'Checking…';
  if (status === 'failed') return 'Needs attention';
  if (status === 'passed') return `${passed}/${total} passed`;
  return 'Not checked';
}

export function SimpleDashboard({ state, posting, error, neoUrl, onRun, onDismissError, onDetails }: {
  state: DashboardState; posting: boolean; error?: string; neoUrl?: string;
  onRun: (scenario: Scenario, reviewId?: string) => void; onDismissError: () => void; onDetails: () => void;
}) {
  const scene = projectBuildScene(state);
  const revision = projectRevisionReview(state);
  const disabled = state.busy || posting;
  const checksDisabled = disabled || Boolean((state.managedReviewAvailable || state.revisionReview) && state.run?.status !== 'passed');
  const scenario: Scenario | undefined = state.managedReviewAvailable ? 'review'
    : state.mode === 'kubernetes' && state.neoAvailable ? 'neo' : scene.simulation ? 'demo' : undefined;
  const connectionChecks = state.connections?.checks ?? [];
  const identityChecks = state.identity?.checks ?? [];
  const connectionText = checkLabel(state.connections?.status, connectionChecks.filter(check => check.status === 'connected').length, connectionChecks.length);
  const accessText = checkLabel(state.identity?.status, identityChecks.filter(check => check.status === 'passed').length, identityChecks.length);
  return <main className="simple-dashboard">
    <section className="simple-heading"><div><div className="simple-eyebrow">{scene.simulation ? 'Simulation' : state.deploymentReadOnly ? 'Recorded view' : 'Your system'}</div><h1>{state.design?.name ?? (state.managedReviewAvailable || revision ? state.target?.label : undefined) ?? (neoUrl ? 'Neo' : 'Your system')}</h1></div><div className="simple-actions">
      {neoUrl && <a href={neoUrl} target="_blank" rel="noreferrer" className="simple-button simple-secondary">Open Neo<Icon name="external" size={16}/></a>}
      {!revision && !state.deploymentReadOnly && scenario && <button className="simple-button simple-primary" disabled={disabled} onClick={() => onRun(scenario)}><Icon name="play" size={16}/>{disabled ? 'Working…' : state.run?.status === 'passed' ? 'Check setup' : 'Build system'}</button>}
    </div></section>
    {revision && <ChangeReview view={revision} disabled={disabled}
      onReview={() => onRun('revision-review')} onApply={() => onRun('revision-apply', revision.state.reviewId)}/>}
    {error && <div className="simple-error" role="alert"><span>That didn’t finish. <button onClick={onDetails}>See details</button></span><button onClick={onDismissError} aria-label="Dismiss error"><Icon name="close" size={17}/></button></div>}
    <section className={`simple-stage phase-${scene.phase}`}>
      <div className="simple-stage-heading"><div><h2 aria-live="polite">{scene.headline}</h2>{scene.subline && <p>{scene.subline}</p>}</div><span className="simple-count">{scene.counts.ready}<span> / {scene.counts.total} ready</span></span></div>
      <BuildScene scene={scene} execution={state.run?.status} changes={revision?.resources}/>
      {scene.warnings.length > 0 && <div className="simple-warning"><span>Some results need a closer look.</span><button onClick={onDetails}>Details<Icon name="arrow" size={14}/></button></div>}
    </section>
    <footer className="simple-checks">
      {(state.connectionReviewAvailable || state.connections) && <div className={`simple-check check-${state.connections?.status ?? 'idle'}`}><span className="simple-check-symbol"><Icon name="network" size={20}/></span><div><strong>Connections</strong><span aria-live="polite">{connectionText}</span></div>{state.connectionReviewAvailable && <button aria-label="Check connections" disabled={checksDisabled} onClick={() => onRun('connections')}>Check</button>}</div>}
      {state.identity && <div className={`simple-check check-${state.identity.status}`}><span className="simple-check-symbol"><Icon name="identity" size={20}/></span><div><strong>Sign-in & access</strong><span aria-live="polite">{accessText}</span></div><button aria-label="Check sign-in and access" disabled={checksDisabled} onClick={() => onRun('identity')}>Check</button></div>}
      <span className="simple-recorded"><span/>FootPrint</span>
    </footer>
  </main>;
}
