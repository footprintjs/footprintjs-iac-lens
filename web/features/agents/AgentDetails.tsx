import { lazy, Suspense } from 'react';
import type { AgentLayerView, AgentRecordingRef, AgentView } from '../../../src/core/agent-platform.ts';
import type { DashboardState } from '../../../src/core/types.ts';
import { deploymentRecording, statusLabels } from './model.ts';
import { RecordedStages } from './RecordedStages.tsx';

const EvidenceView = lazy(() => import('../../components/EvidenceView.tsx'));
const capabilityNames = { supported: 'Confirmed', unsupported: 'Not supported', unknown: 'Not confirmed' };

export function RecordingSummary({ reference }: { reference?: AgentRecordingRef }) {
  return reference ? <dl><div><dt>{reference.kind === 'deployment' ? 'Deployment run' : 'Native run'}</dt><dd><code>{reference.runId}</code></dd></div>
    <div><dt>Recording</dt><dd>{reference.complete ? 'Complete' : 'Incomplete'}</dd></div>
    <div><dt>Kind</dt><dd>{reference.kind}</dd></div><div><dt>Evidence reference</dt><dd><code>{reference.id}</code></dd></div></dl>
    : <p>No native recording was supplied for this layer.</p>;
}

export function AgentDetails({ agent }: { agent: AgentView }) {
  return <div className="agents-details"><dl><div><dt>Agent</dt><dd>{agent.label}</dd></div><div><dt>Current outcome</dt><dd>{statusLabels[agent.status]}</dd></div>
    <div><dt>Agent identity</dt><dd><code>{agent.id}</code></dd></div><div><dt>Declared revision</dt><dd>{agent.revisionLabel ?? 'No label supplied'}{agent.revisionId && <><br/><code>{agent.revisionId}</code></>}</dd></div></dl>
    {agent.description && <p>{agent.description}</p>}
    {!!agent.resourceIds.length && <section><h3>Infrastructure bindings</h3><p>{agent.resourceIds.map(id => <code key={id}>{id} </code>)}</p></section>}
    <section><h3>Runtime capabilities</h3>{agent.capabilities.length ? <ul className="agents-capability-list">{agent.capabilities.map(capability => <li key={capability.id}><strong>{capability.label}</strong><span>{capabilityNames[capability.status]}</span>
      {capability.proofRef && <span>Native proof: <code>{capability.proofRef.runId}</code></span>}</li>)}</ul> : <p>No runtime capability evidence was supplied.</p>}</section>
    {agent.limitations.map((limitation, index) => <div key={index} className="agents-limitation">{limitation}</div>)}
    <p>Agent revisions, deployment records and conversation ownership are separate facts. A ready app does not establish an unmeasured isolation or restore capability.</p>
  </div>;
}

export function LayerDetails({ agent, layer, state }: { agent: AgentView; layer: AgentLayerView; state: DashboardState }) {
  const recording = deploymentRecording(state, layer.recording);
  return <div className="agents-details"><dl><div><dt>Agent</dt><dd>{agent.label}</dd></div><div><dt>Layer</dt><dd>{layer.label}</dd></div>
    <div><dt>Current outcome</dt><dd>{statusLabels[layer.status]}</dd></div></dl>
    {layer.detail && <p>{layer.detail}</p>}
    {(layer.id !== 'infrastructure' || layer.stages) && <RecordedStages stages={layer.stages ?? []} title="Native subflow" empty="No native stage observations were supplied for this layer."/>}
    <RecordingSummary reference={layer.recording}/>
    {recording ? <Suspense fallback={<p>Opening native Flow Lens…</p>}><EvidenceView title={layer.label} recording={recording} running={layer.status === 'running'}/></Suspense>
      : layer.recording && <p>The native recording is retained by the host. This view contains its admitted summary; it does not load private artifacts.</p>}
  </div>;
}
