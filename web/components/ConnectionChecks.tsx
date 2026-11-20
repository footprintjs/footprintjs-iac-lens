import { CONNECTION_LABELS, declaredConnection } from '../../src/core/connections.ts';
import { eventTime } from '../../src/core/model.ts';
import type { DashboardState } from '../../src/core/types.ts';
import { ConnectionDetails } from './ConnectionDetails.tsx';
import { DetailsPanel } from './DetailsPanel.tsx';
import { Icon } from './Icon.tsx';

export function ConnectionChecks({ state, selected, compact = false, onSelect, onCheck, onEvidence }: {
  state: DashboardState; selected?: string; compact?: boolean;
  onSelect(id?: string): void; onCheck(): void; onEvidence(): void;
}) {
  const run = state.connections;
  if (!run?.checks.length) return null;
  const focused = run.checks.find(check => check.connectionId === selected);
  const available = state.resourceFlow ? state.connectionReviewAvailable === true : state.connectionReviewAvailable || (state.neoAvailable && state.mode === 'kubernetes');
  const name = (id: string) => {
    const resource = state.graph?.resources.find(resource => resource.id === id);
    const metadata = resource?.spec.metadata as { name?: string } | undefined;
    return `${resource?.spec.kind ?? 'Resource'} ${metadata?.name ?? id}`;
  };
  const label = (id: string, from: string, to: string) => {
    return declaredConnection(state.graph, { connectionId: id, from, to })?.label ?? `${name(from)} → ${name(to)}`;
  };
  const details = focused && <ConnectionDetails details={declaredConnection(state.graph, focused)?.details} check={focused} run={run} onEvidence={onEvidence}/>;
  return <section className={`connection-checks${compact ? ' checks-compact' : ''}`} aria-label="Connection checks">
    <div className="connection-checks-bar"><div className="connection-checks-heading"><Icon name="network" size={16}/>
      <strong>{compact ? 'Connections' : run.label ?? 'Connection checks'}</strong>
      <span className="connection-checks-time">{run.status === 'checking' ? 'Checking' : run.checkedAt ? eventTime(run.checkedAt) : 'Not checked'}</span>
    </div>
      <button className="button button-secondary" disabled={state.busy || !available || (state.resourceFlow ? state.resourceFlow.status !== 'passed' : state.run?.status !== 'passed')}
        title={run.scopeDescription ?? 'Run the configured connection probes'} onClick={onCheck}>
        {run.status === 'checking' ? 'Checking connections…' : 'Check connections'}
      </button>
    </div>
    <div className="connection-check-list">{run.checks.map(check => <button key={check.connectionId}
      className={`connection-check-row connection-${check.status}`} aria-expanded={focused?.connectionId === check.connectionId}
      onClick={() => onSelect(focused?.connectionId === check.connectionId ? undefined : check.connectionId)}>
      <i className={`connection-dot connection-${check.status}`}/><span>{label(check.connectionId, check.from, check.to)}</span>
      <strong>{CONNECTION_LABELS[check.status]}</strong><Icon name="chevron" size={13}/>
    </button>)}</div>
    {run.report?.error && <p className="connection-run-error" role="status">{run.report.error}</p>}
    {focused && compact ? <DetailsPanel title={label(focused.connectionId, focused.from, focused.to)} onClose={() => onSelect(undefined)}>{details}</DetailsPanel> : details}
  </section>;
}
