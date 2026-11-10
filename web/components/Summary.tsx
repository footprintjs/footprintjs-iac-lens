import { statusCounts } from '../../src/core/model.ts';
import type { DashboardState } from '../../src/core/types.ts';
import { Icon } from './Icon.tsx';

export function Summary({ state }: { state: DashboardState }) {
  const counts = statusCounts(state);
  const cards = [{ label: 'Resources', value: state.graph?.resources.length ?? 0, className: 'total', detail: 'in the desired graph', icon: 'graph' },
    { label: 'Ready', value: counts.ready, className: 'ready', detail: state.mode === 'simulator' ? 'simulator confirmed' : 'provider confirmed', icon: 'check' },
    { label: 'Deploying', value: counts.deploying, className: 'deploying', detail: 'reconciliation started', icon: 'clock' },
    { label: 'Waiting', value: counts.pending, className: 'pending', detail: counts.skipped ? `${counts.skipped} skipped after failure` : 'not started in this run', icon: 'clock' }];
  if (counts.failed) cards[3] = { label: 'Failed', value: counts.failed, className: 'failed', detail: `${counts.pending} pending · ${counts.skipped} skipped`, icon: 'close' };
  return <div className="summary-grid">{cards.map(card => <div className={`summary-card summary-${card.className}`} key={card.label}><div><span className="summary-label">{card.label}</span><strong>{card.value}<small>{card.detail}</small></strong></div><span className="summary-icon"><Icon name={card.icon} size={21}/></span></div>)}</div>;
}
