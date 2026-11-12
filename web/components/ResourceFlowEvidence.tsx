import { lazy, Suspense, useState } from 'react';
import type { DashboardState } from '../../src/core/types.ts';
import { resourceFlowRecordings } from '../../src/core/resource-flow.ts';

const EvidenceView = lazy(() => import('./EvidenceView.tsx'));

/** Parent workflow segments stay separate from the actual resource deployment recordings. */
export function ResourceFlowEvidence({ state, initialSegmentId }: { state: DashboardState; initialSegmentId?: string }) {
  const [segmentId, setSegmentId] = useState(initialSegmentId);
  const recordings = resourceFlowRecordings({ ...state, recording: state.resourceFlowRecording ?? state.recording });
  const selected = recordings.find(item => item.segment.runId === segmentId && item.recording)
    ?? recordings.findLast(item => item.recording);
  return <>
    <label className="resource-flow-recording-choice">Workflow segment<select value={selected?.segment.runId ?? ''} onChange={event => setSegmentId(event.target.value)}>
      {!selected && <option value="">No completed native segment</option>}
      {recordings.filter(item => item.recording).map(item => <option key={item.segment.runId} value={item.segment.runId}>{item.segment.status} · {item.segment.runId}</option>)}
    </select></label>
    {selected?.segment.resumedFromRunId && <p className="resource-flow-segment-parent">Resumed from <code>{selected.segment.resumedFromRunId}</code></p>}
    <Suspense fallback={<p>Opening Flow Lens…</p>}><EvidenceView title="Create or Find → Connect → Verify" recording={selected?.recording} running={state.resourceFlow?.status === 'running'}/></Suspense>
  </>;
}
