import type { DashboardState } from '../../src/core/types.ts';
import { resourceFlowRecordings } from '../../src/core/resource-flow.ts';

export function ResourceFlowDetails({ state, onInspect }: { state: DashboardState; onInspect(runId: string): void }) {
  const flow = state.resourceFlow!;
  const recordings = resourceFlowRecordings({ ...state, recording: state.resourceFlowRecording ?? state.recording });
  return <div className="resource-flow-details">
    <p>The workflow orchestrates the resource deployments, connection checks and access checks shown in this workspace. Each recording retains its own native run identity.</p>
    <dl><dt>Workflow</dt><dd><code>{flow.id}</code></dd><dt>Definition</dt><dd><code>{flow.definitionDigest}</code></dd><dt>Target scope</dt><dd><code>{flow.target.scope}</code></dd></dl>
    <h3>Workflow segments</h3>{recordings.length ? <ol>{recordings.map(({ segment, recording }) => <li key={segment.runId}>
      <button disabled={!recording} onClick={() => onInspect(segment.runId)}>{segment.status} · Inspect segment</button><code>{segment.runId}</code><span>{segment.evidencePath}</span>
      {segment.resumedFromRunId && <span>Resumed from {segment.resumedFromRunId}</span>}
    </li>)}</ol> : <p>No native workflow segment has completed yet.</p>}
    <h3>Recorded handoff and verification</h3><pre>{JSON.stringify({ resource: flow.resource, details: flow.details, connection: flow.connection, verification: flow.verification, failure: flow.failure }, null, 2)}</pre>
  </div>;
}
