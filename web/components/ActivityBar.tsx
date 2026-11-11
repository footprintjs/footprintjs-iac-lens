import { CONNECTION_LABELS } from '../../src/core/connections.ts';
import { eventTime, STATUS_LABELS } from '../../src/core/model.ts';
import type { DashboardState } from '../../src/core/types.ts';
import { Icon } from './Icon.tsx';

/** A bounded display of recent recorded observations; the native chart owns execution order. */
export function ActivityBar({ state, onSelect }: { state: DashboardState; onSelect(id: string): void }) {
  const events = [
    ...(state.run?.events.slice(-3).map(event => ({ id: event.resourceId, label: event.resourceId,
      status: event.status ? STATUS_LABELS[event.status] : 'Event', timestamp: event.timestamp })) ?? []),
    ...(state.connections?.events.slice(-3).map(event => ({ id: undefined,
      label: `${event.from} → ${event.to}`, status: CONNECTION_LABELS[event.status], timestamp: event.timestamp })) ?? []),
    ...(state.identity?.events.slice(-2).map(event => ({ id: undefined,
      label: event.label, status: event.status === 'checking' ? 'Checking' : event.status === 'passed' ? 'Passed' : 'Failed', timestamp: event.timestamp })) ?? []),
  ].filter(event => event.timestamp !== undefined)
    .sort((a, b) => new Date(b.timestamp!).getTime() - new Date(a.timestamp!).getTime()).slice(0, 2);
  return <section className="activity-bar" aria-label="Recent recorded activity"><Icon name="evidence" size={14}/>
    {events.length ? events.map((event, index) => <button key={`${event.timestamp}:${index}`} disabled={!event.id}
      onClick={() => event.id && onSelect(event.id)} title={`${event.status} ${event.label} at ${eventTime(event.timestamp)}`}>
      <strong>{event.status}</strong><span>{event.label}</span><time>{eventTime(event.timestamp)}</time>
    </button>) : <span>Waiting for recorded progress</span>}
  </section>;
}
