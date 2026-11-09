import type { Resource } from 'footprint-iac';
import { describeResource, eventTime, resourceProgress, STATUS_LABELS } from '../../src/core/model.ts';
import type { DashboardState } from '../../src/core/types.ts';
import { Icon } from './Icon.tsx';
import { StatusBadge } from './StatusBadge.tsx';

export function Inspector({ state, resource, onClose, onEvidence }: { state: DashboardState; resource: Resource; onClose: () => void; onEvidence: () => void }) {
  const description = describeResource(state, resource);
  const progress = resourceProgress(state, resource.id);
  const events = state.run?.events.filter(event => event.resourceId === resource.id) ?? [];
  return <aside className="inspector" aria-label="Resource details">
    <div className="inspector-title"><span>RESOURCE DETAILS</span><button className="icon-button" onClick={onClose} aria-label="Close resource details"><Icon name="close" size={17}/></button></div>
    <div className="inspector-identity"><span className={`resource-icon family-${description.family}`}><Icon name={description.family} size={24}/></span><h3>{description.name}</h3><p>{description.kind}</p><StatusBadge status={progress.status} action={progress.action}/></div>
    <dl className="detail-list"><dt>Resource ID</dt><dd className="mono full-identifier">{resource.id}</dd><dt>Provider</dt><dd>{resource.provider}</dd>
      {description.capability && <><dt>Capability</dt><dd className="mono full-identifier">{description.capability}</dd></>}
      {progress.action && <><dt>Planned operation</dt><dd>{progress.action === 'noop' ? 'No change · readiness checked' : progress.action}</dd></>}
      {description.boundaries.length > 0 && <><dt>Declared boundaries</dt><dd>{description.boundaries.map(boundary => <span className="boundary-tag" key={boundary}>{boundary}</span>)}</dd></>}
    </dl>
    {progress.message && <div className={`resource-message message-${progress.status}`}>{progress.message}</div>}
    <div className="inspector-section"><h4>Recorded progress <span>{events.length}</span></h4>{events.length ? <ol className="resource-events">{events.map((event, index) => <li key={`${event.sequence ?? event.seq ?? index}:${event.status}`}><span className={`event-marker mark-${event.status ?? 'pending'}`}/><div><strong>{event.status ? STATUS_LABELS[event.status] : 'Event'}</strong><time>{eventTime(event.timestamp)}</time>{event.message && <p>{event.message}</p>}{event.runtimeStageId && <code className="full-identifier">{event.runtimeStageId}</code>}</div></li>)}</ol> : <p className="muted small">No deployment event has been recorded for this resource.</p>}</div>
    <button className="text-action" onClick={onEvidence}>Inspect execution evidence <Icon name="arrow" size={16}/></button>
    <details className="spec-details"><summary>Declared specification</summary><pre>{JSON.stringify(resource.spec, null, 2)}</pre></details>
  </aside>;
}
