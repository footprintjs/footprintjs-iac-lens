import { lazy, Suspense, useState } from 'react';
import { deliveryPhases, type DeliveryAction, type DeliveryView } from '../../src/core/delivery.ts';
import { DetailsPanel } from './DetailsPanel.tsx';
import { Icon } from './Icon.tsx';
import './delivery.css';
const EvidenceView = lazy(() => import('./EvidenceView.tsx'));

export function DeliveryDetails({ view }: { view: DeliveryView }) {
  const [recording,setRecording] = useState(false);
  const changed = view.changes.filter(change => change.action !== 'noop');
  return <div className="delivery-details"><dl><dt>Repository</dt><dd>{view.repository.startsWith('https://') ? <a href={view.repository} target="_blank" rel="noreferrer">{view.repository}</a> : view.repository}</dd>
    <dt>Requested version</dt><dd>{view.ref}</dd><dt>Pinned commit</dt><dd><code>{view.source?.commit ?? 'Resolved when the delivery starts'}</code></dd>
    {view.source && <><dt>Source tree</dt><dd><code>{view.source.tree}</code></dd></>}
    <dt>Delivery</dt><dd>{view.executionId ?? 'Not started'} · {view.status}</dd></dl>
    <h3>Changes</h3><p>{changed.length} affected · {view.changes.length - changed.length} unchanged</p>
    {!!view.changes.length && <table><thead><tr><th>Resource</th><th>Planned action</th></tr></thead><tbody>{view.changes.map(change => <tr key={change.resourceId}><td>{change.resourceId}</td><td>{change.action}</td></tr>)}</tbody></table>}
    {!!view.artifacts.length && <><h3>Packages</h3>{view.artifacts.map(artifact => <div key={artifact.id}><strong>{artifact.id}</strong><p><code>{artifact.reference}</code><br/><code>{artifact.digest}</code></p></div>)}</>}
    {!!view.checks.length && <><h3>Acceptance checks</h3><ul>{view.checks.map(check => <li key={check.id}>{check.id}: {check.passed ? 'Passed' : 'Failed'}</li>)}</ul></>}
    <h3>Recorded delivery</h3><p>Stage progress comes from FootPrint. Provider deployment and access checks retain their own native recordings.</p>
    {view.recordings.length ? <ul>{view.recordings.map(run => <li key={run.runId}><code>{run.runId}</code> · {run.status}</li>)}</ul> : <p>The native delivery recording becomes available when this run finishes.</p>}
    {view.error && <p role="status" className="delivery-error">{view.error}</p>}
    {view.recording && <><button className="simple-button simple-secondary" onClick={() => setRecording(!recording)}>{recording ? 'Hide recording' : 'Show recording'}</button>
      {recording && <Suspense fallback={<p>Opening the recording…</p>}><EvidenceView recording={view.recording} running={false} title="Application delivery"/></Suspense>}</>}
  </div>;
}
export function DeliveryStrip({ view,disabled,onDeploy }: { view: DeliveryView; disabled: boolean; onDeploy?(input: DeliveryAction): void }) {
  const [details,setDetails] = useState(false);
  const phases = deliveryPhases(view), active = phases.find(phase => phase.status === 'running');
  const affected = view.changes.filter(change => change.action !== 'noop').length;
  const repositoryName = view.repository.startsWith('https://') ? new URL(view.repository).pathname.replace(/^\//,'').replace(/\.git$/,'') : view.repository;
  const message = view.status === 'passed' ? 'Update verified' : view.status === 'failed' || view.status === 'incomplete' ? 'Update needs attention'
    : view.status === 'running' ? `${active?.label ?? 'Working'}…` : 'Ready to deploy this version';
  return <section className={`delivery-strip delivery-${view.status}`} aria-label="Application delivery">
    <div className="delivery-summary"><strong>{view.label}</strong><span className="delivery-source" title={view.repository}>{repositoryName} · {view.ref}</span>{view.source && <code title={view.source.commit}>{view.source.commit.slice(0,8)}</code>}<span role="status">{message}</span>
      {!!view.changes.length && <span>{affected} affected · {view.changes.length - affected} unchanged</span>}
      <button className="delivery-details-button" onClick={() => setDetails(true)}>Delivery details</button>
      <button className="simple-button simple-primary" disabled={disabled || view.status !== 'idle' || !onDeploy} onClick={() => onDeploy?.({ deliveryId: view.id })}><Icon name="play" size={14}/>{view.status === 'passed' ? 'Deployed' : view.status === 'running' ? 'Deploying…' : view.status === 'failed' || view.status === 'incomplete' ? 'Delivery stopped' : view.buttonLabel}</button>
    </div>
    <ol className="delivery-phases" aria-label="Recorded delivery stages">{phases.map((phase,index) => <li key={phase.id} className={`delivery-phase phase-${phase.status}`} aria-label={`${phase.label}: ${phase.status}`}><span>{phase.status === 'passed' ? '✓' : phase.status === 'failed' ? '!' : index + 1}</span>{phase.label}</li>)}</ol>
    {view.error && <p className="delivery-error" role="status">{view.error}</p>}
    {details && <DetailsPanel title="Delivery details" onClose={() => setDetails(false)}><DeliveryDetails view={view}/></DetailsPanel>}
  </section>;
}
