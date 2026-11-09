import { CONNECTION_LABELS } from '../../src/core/connections.ts';
import { eventTime } from '../../src/core/model.ts';
import type { DashboardState } from '../../src/core/types.ts';
import { Icon } from './Icon.tsx';

export function ConnectionChecks({ state, selected, onSelect, onCheck, onEvidence }: {
  state: DashboardState; selected?: string; onSelect(id?: string): void; onCheck(): void; onEvidence(): void;
}) {
  const run = state.connections;
  if (!run?.checks.length) return null;
  const focused = run.checks.find(check => check.connectionId === selected);
  const name = (id: string) => {
    const resource = state.graph?.resources.find(resource => resource.id === id);
    const metadata = resource?.spec.metadata as { name?: string } | undefined;
    return `${resource?.spec.kind ?? 'Resource'} ${metadata?.name ?? id}`;
  };
  return <section className="connection-checks" aria-label="Connection checks">
    <div className="connection-checks-bar"><div className="connection-checks-heading"><Icon name="network" size={16}/><strong>Connection checks</strong>
      <span className="connection-checks-time">Point-in-time{run.checkedAt ? ` · checked ${eventTime(run.checkedAt)}` : ' · not checked yet'}</span></div>
      <button className="button button-secondary" disabled={state.busy || state.mode !== 'kubernetes' || state.run?.status !== 'passed'}
        title="Check the admitted Neo Service from its running pod through in-cluster DNS and HTTP" onClick={onCheck}>
        {run.status === 'checking' ? 'Checking connections…' : 'Check connections'}</button></div>
    <div className="connection-check-list">{run.checks.map(check => <button key={check.connectionId} className={`connection-check-row connection-${check.status}`}
      aria-expanded={focused?.connectionId === check.connectionId} onClick={() => onSelect(focused?.connectionId === check.connectionId ? undefined : check.connectionId)}>
      <i className={`connection-dot connection-${check.status}`}/><span>{name(check.from)} <span aria-hidden="true">→</span> {name(check.to)}</span><strong>{CONNECTION_LABELS[check.status]}</strong><Icon name="chevron" size={13}/></button>)}</div>
    {run.report?.error && <p className="connection-run-error" role="status">Connection check could not complete: {run.report.error}</p>}
    {focused && <div className="connection-details"><div className="connection-details-heading"><strong>{CONNECTION_LABELS[focused.status]}</strong>
      <button className="text-button" onClick={onEvidence} disabled={!run.recording}>Inspect connection recording</button></div>
      {focused.message && <p role="status">{focused.message}</p>}
      {focused.observation && <dl><dt>Method</dt><dd>{focused.observation.method}</dd><dt>Target</dt><dd><code>{focused.observation.target}</code></dd>
        <dt>Observation</dt><dd>{eventTime(focused.observation.observedAt)} · {Math.round(focused.observation.latencyMs)} ms</dd></dl>}
      <p className="connection-scope">Checks run from a ready deployment pod through the Service’s in-cluster DNS and HTTP route. This observes that path at check time; it does not monitor traffic or prove reachability from every client.</p>
      {(focused.observation?.details || focused.details) && <details><summary>Recorded probe details</summary><pre>{JSON.stringify(focused.observation?.details ?? focused.details, null, 2)}</pre></details>}
      {run.report?.captureError && <p>Evidence persistence failed: {run.report.captureError}</p>}
    </div>}
  </section>;
}
