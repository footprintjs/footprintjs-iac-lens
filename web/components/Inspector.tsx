import type { Resource } from 'footprint-iac';
import { CONNECTION_LABELS } from '../../src/core/connections.ts';
import { identityOutcomeLabel } from '../../src/core/identity.ts';
import { eventTime, STATUS_LABELS } from '../../src/core/model.ts';
import { projectResourceEvidence } from '../../src/core/resource-evidence.ts';
import type { DashboardState } from '../../src/core/types.ts';
import type { EvidenceKind } from './EvidenceSource.tsx';
import { Icon } from './Icon.tsx';
import { StatusBadge } from './StatusBadge.tsx';

export function Inspector({ state, resource, onClose, onEvidence }: {
  state: DashboardState;
  resource: Resource;
  onClose(): void;
  onEvidence(kind: EvidenceKind): void;
}) {
  const evidence = projectResourceEvidence(state, resource.id);
  if (!evidence) return null;
  const { description, progress, deployment, verification } = evidence;
  return <aside className="inspector resource-inspector" aria-label="Resource details">
    <div className="inspector-title"><span>RESOURCE EVIDENCE</span>
      <button className="icon-button" onClick={onClose} aria-label="Close resource details"><Icon name="close" size={17}/></button>
    </div>
    <div className="resource-evidence-grid">
      <section aria-label="Declaration and adapter">
        <h3>Declaration and adapter</h3>
        <dl className="detail-list"><dt>Resource</dt><dd><code>{resource.id}</code></dd>
          <dt>Name</dt><dd>{description.name}</dd><dt>Kind</dt><dd>{description.kind}</dd>
          <dt>Provider adapter</dt><dd>{resource.provider}</dd>
          {evidence.bindings.map(binding => <div className="binding-entry" key={binding.capabilityId}>
            <dt>Capability binding</dt><dd>{binding.capabilityPath}</dd>
          </div>)}
          {evidence.declaredDependencies.length > 0 && <><dt>Prerequisites</dt>
            <dd>{evidence.declaredDependencies.map(id => <code className="evidence-id" key={id}>{id}</code>)}</dd></>}
          {description.boundaries.length > 0 && <><dt>Declared boundaries</dt><dd>{description.boundaries.map(boundary => <span className="boundary-tag" key={boundary}>{boundary}</span>)}</dd></>}
        </dl>
        {evidence.capabilities.length > 0 && <ul className="resource-capabilities">
          {evidence.capabilities.map(unit => <li key={`${unit.blockId}:${unit.unitId}`}>
            <strong>{unit.label}</strong><small>{unit.mode === 'embedded' ? 'Embedded in this resource' : unit.resourceIds.length > 1 ? 'Uses multiple resources' : 'Mapped to this resource'}</small>
            {unit.description && <p>{unit.description}</p>}
          </li>)}
        </ul>}
        <details className="spec-details"><summary>Declared specification</summary><pre>{JSON.stringify(resource.spec, null, 2)}</pre></details>
      </section>
      <section aria-label="Recorded operation">
        <h3>Recorded operation</h3><StatusBadge status={progress.status} action={progress.action}/>
        <dl className="detail-list">
          {deployment.runId && <><dt>Run</dt><dd><code>{deployment.runId}</code></dd></>}
          {deployment.nativeStages && <><dt>Native chart stage</dt><dd><code>{deployment.nativeStages.executeStageId}</code></dd></>}
          {progress.runtimeStageId && <><dt>Recorded execution</dt><dd><code>{progress.runtimeStageId}</code></dd></>}
          {deployment.observed && <><dt>Observed start</dt><dd>{eventTime(deployment.observed.startedAt)}</dd>
            {deployment.observed.finishedAt !== undefined && <><dt>Observed finish</dt><dd>{eventTime(deployment.observed.finishedAt)}</dd></>}</>}
        </dl>
        {progress.message && <p className={`resource-message message-${progress.status}`}>{progress.message}</p>}
        {deployment.events.length ? <ol className="resource-events">
          {deployment.events.map((event, index) => <li key={`${event.sequence ?? event.seq ?? index}:${event.status}`}>
            <span className={`event-marker mark-${event.status ?? 'pending'}`}/><div>
              <strong>{event.status ? STATUS_LABELS[event.status] : 'Event'}</strong><time>{eventTime(event.timestamp)}</time>
              {event.message && <p>{event.message}</p>}
            </div>
          </li>)}
        </ol> : <p className="muted small">Waiting for a recorded operation.</p>}
        <button className="text-action" disabled={!deployment.recordingAvailable} onClick={() => onEvidence('deployment')}>Inspect deployment recording <Icon name="arrow" size={16}/></button>
        {deployment.result !== undefined && <details className="spec-details"><summary>Provider result</summary><pre>{JSON.stringify(deployment.result, null, 2)}</pre></details>}
        {deployment.warnings.map(warning => <p key={warning} className="evidence-warning" role="status">{warning}</p>)}
      </section>
      <section aria-label="Recorded verification">
        <h3>Recorded verification</h3>
        {verification.connections.map(check => <article className={`resource-check connection-${check.status}`} key={check.connectionId}>
          <strong>{CONNECTION_LABELS[check.status]}</strong><p><code>{check.from}</code> → <code>{check.to}</code></p>
          {check.observation && <small>{check.observation.method} · {eventTime(check.observation.observedAt)} · {Math.round(check.observation.latencyMs)} ms</small>}
          {check.message && <p>{check.message}</p>}
        </article>)}
        {verification.identity.map(check => <article className={`resource-check identity-${check.status}`} key={check.checkId}>
          <strong>{identityOutcomeLabel(check)}</strong><p>{check.label}</p>
          {check.observation && <small>{eventTime(check.observation.observedAt)} · {Math.round(check.observation.latencyMs)} ms</small>}
        </article>)}
        {!verification.connections.length && !verification.identity.length && <p className="muted small">No resource-scoped verification has been recorded.</p>}
        {verification.connections.length > 0 && <button className="text-action" disabled={!state.connections?.recording} onClick={() => onEvidence('connections')}>Inspect connection recording <Icon name="arrow" size={16}/></button>}
        {verification.identity.length > 0 && <button className="text-action" disabled={!state.identity?.recording} onClick={() => onEvidence('identity')}>Inspect identity recording <Icon name="arrow" size={16}/></button>}
      </section>
    </div>
  </aside>;
}
