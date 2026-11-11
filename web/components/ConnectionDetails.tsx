import { CONNECTION_LABELS } from '../../src/core/connections.ts';
import { eventTime } from '../../src/core/model.ts';
import type { ConnectionProgress, ConnectionRun } from '../../src/core/types.ts';

export function ConnectionDetails({ check, run, onEvidence }: {
  check: ConnectionProgress;
  run: ConnectionRun;
  onEvidence(): void;
}) {
  const observedScope = check.observation?.details.scope;
  const scope = check.scopeDescription ?? (typeof observedScope === 'string' ? observedScope : run.scopeDescription);
  return <div className="connection-details">
    <div className="connection-details-heading"><strong>{CONNECTION_LABELS[check.status]}</strong>
      <button className="text-button" onClick={onEvidence} disabled={!run.recording}>Inspect connection recording</button>
    </div>
    {check.message && <p role="status">{check.message}</p>}
    <dl><dt>From</dt><dd><code>{check.from}</code></dd><dt>To</dt><dd><code>{check.to}</code></dd>
      {check.runtimeStageId && <><dt>Recorded stage</dt><dd><code>{check.runtimeStageId}</code></dd></>}
      {check.observation && <><dt>Method</dt><dd>{check.observation.method}</dd>
        <dt>Target</dt><dd><code>{check.observation.target}</code></dd>
        <dt>Observation</dt><dd>{eventTime(check.observation.observedAt)} · {Math.round(check.observation.latencyMs)} ms</dd></>}
    </dl>
    {scope && <p className="connection-scope">{scope}</p>}
    {(check.observation?.details || check.details) && <details><summary>Recorded probe details</summary>
      <pre>{JSON.stringify(check.observation?.details ?? check.details, null, 2)}</pre>
    </details>}
    {run.report?.captureError && <p role="status">{run.report.captureError}</p>}
  </div>;
}
