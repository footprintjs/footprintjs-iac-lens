import { eventTime, STATUS_LABELS } from '../../src/core/model.ts';
import type { DashboardState } from '../../src/core/types.ts';
import { Icon } from './Icon.tsx';

export function RunFeed({ state, onSelect }: { state: DashboardState; onSelect: (id: string) => void }) {
  const events = state.run?.events.filter(event => event.status !== 'pending').slice(-5).reverse() ?? [];
  return <section className="run-feed" aria-label="Recorded activity"><div className="section-heading"><span><Icon name="evidence" size={17}/> Recorded activity</span><small>{state.run?.id ? <code className="full-identifier">{state.run.id}</code> : 'Waiting for a run'}</small></div>
    {events.length ? <div className="activity-list">{events.map((event, index) => <button key={`${event.sequence ?? event.seq ?? index}:${event.resourceId}`} className="activity-item" onClick={() => event.resourceId && onSelect(event.resourceId)} disabled={!event.resourceId}>
      <span className={`event-marker mark-${event.status ?? 'pending'}`}/><strong>{event.status ? STATUS_LABELS[event.status] : 'Event'}</strong><span className="activity-resource full-identifier">{event.resourceId ?? event.message ?? 'Deployment event'}</span><time>{eventTime(event.timestamp)}</time><Icon name="chevron" size={13}/></button>)}</div>
      : <div className="activity-placeholder"><span className="event-marker mark-pending"/>Select a deployment to see its recorded progress here.</div>}
  </section>;
}
