import { lazy, Suspense, useState } from 'react';
import type { DashboardState } from '../../src/core/types.ts';
import { projectResourceFlow, resourceFlowRecordings, type ResourceFlowAction } from '../../src/core/resource-flow.ts';
import { DetailsPanel } from './DetailsPanel.tsx';
import { Icon } from './Icon.tsx';
import './resource-flow.css';

const EvidenceView = lazy(() => import('./EvidenceView.tsx'));
const glyphs = { acquire: 'graph', details: 'file', connect: 'network', verify: 'identity' };

/** Separate resource lifecycle and connection tasks, projected only from the native recorder. */
export function ResourceFlowDashboard({ state, posting, error, neoUrl, technical, onAction, onDismissError }: {
  state: DashboardState; posting: boolean; error?: string; neoUrl?: string; technical: boolean;
  onAction(input: ResourceFlowAction): void; onDismissError(): void;
}) {
  const view = projectResourceFlow(state)!;
  const [profile, setProfile] = useState<string>();
  const [details, setDetails] = useState<'summary' | 'recording'>();
  const [segmentId, setSegmentId] = useState<string>();
  const recordings = resourceFlowRecordings(state);
  const selectedRecording = recordings.find(item => item.segment.runId === segmentId && item.recording)
    ?? recordings.findLast(item => item.recording);
  const pause = view.state.pause;
  const profiles = pause?.profiles ?? [];
  const selected = profiles.some(item => item.id === profile) ? profile : profiles[0]?.id;
  const disabled = state.busy || posting;
  return <main className="simple-dashboard resource-flow-dashboard">
    <section className="simple-heading"><div><div className="simple-eyebrow">{view.origin}</div><h1>{view.state.label}</h1></div>
      <div className="simple-actions"><button className="simple-button simple-secondary" onClick={() => setDetails('summary')}>Details</button>
        {neoUrl && <a href={neoUrl} target="_blank" rel="noreferrer" className="simple-button simple-secondary">Open Neo<Icon name="external" size={16}/></a>}
        {view.state.status === 'idle' && <button className="simple-button simple-primary" disabled={disabled || !view.canStart} onClick={() => onAction({ action: 'start' })}><Icon name="play" size={16}/>Start workflow</button>}
      </div>
    </section>
    {error && <div className="simple-error" role="alert"><span>{error}</span><button onClick={onDismissError} aria-label="Dismiss error"><Icon name="close" size={17}/></button></div>}
    <section className={`simple-stage resource-flow-stage flow-${view.state.status}`} aria-label="Resource and connection workflow">
      <div className="simple-stage-heading"><div><h2 aria-live="polite">{view.headline}</h2><p>{view.state.mode === 'existing' ? 'Find the resource, connect your application, then check it.' : 'Create the resource, connect your application, then check it.'}</p></div>
        <span className="simple-count">{view.completed}<span> / {view.total} complete</span></span>
      </div>
      <ol className="resource-flow-pipeline" aria-label="Native workflow stages">{view.stages.map((stage, index) => <li key={stage.id}
        className={`resource-flow-node flow-node-${stage.status}`} aria-label={`${stage.label}: ${stage.caption}`}>
        {index > 0 && <span className="resource-flow-arrow" aria-hidden="true"><Icon name="arrow" size={28}/></span>}
        <span className="resource-flow-number">0{index + 1}</span>
        <span className="resource-flow-glyph"><Icon name={glyphs[stage.id]} size={56}/>{stage.status === 'passed' && <span className="resource-flow-mark"><Icon name="check" size={16}/></span>}</span>
        <strong>{stage.label}</strong><span className="resource-flow-caption">{stage.caption}</span>
      </li>)}</ol>
      {pause && <section className="resource-flow-pause" aria-label="Connection details needed"><div><strong>{pause.prompt}</strong><p>Choose an approved connection profile to continue.</p></div>
        <label>Connection profile<select value={selected ?? ''} disabled={disabled || !view.canResume} onChange={event => setProfile(event.target.value)}>
          {!profiles.length && <option value="">No profiles configured</option>}{profiles.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label><button className="simple-button simple-primary" disabled={disabled || !view.canResume || !selected}
          onClick={() => { if (selected) onAction({ action: 'resume', pauseToken: pause.token, profileId: selected }); }}><Icon name="play" size={15}/>Continue</button>
      </section>}
      {(view.state.error || state.resourceFlowError) && <div className="simple-warning" role="status"><span>{state.resourceFlowError ?? view.state.error}</span><button onClick={() => setDetails('summary')}>Inspect details<Icon name="arrow" size={14}/></button></div>}
      {technical && <div className="resource-flow-technical"><span>Mode <code>{view.state.mode}</code></span><span>Target <code>{view.state.target.id}</code></span><span>Execution <code>{view.state.executionId ?? 'not started'}</code></span></div>}
      <div className="resource-flow-key"><span><i/>Waiting</span><span><i className="key-active"/>Working</span><span><i className="key-passed"/>Confirmed</span></div>
    </section>
    <footer className="resource-flow-footer"><span>{view.state.mode === 'existing' ? 'Existing resource · lifecycle stays with its owner' : 'Managed resource · lifecycle belongs to its configured adapter'}</span>
      <button onClick={() => setDetails('recording')} disabled={!selectedRecording}>Inspect recording<Icon name="evidence" size={15}/></button><span className="simple-recorded"><span/>FootPrint</span></footer>
    {details && <DetailsPanel title={details === 'recording' ? 'Native resource workflow recording' : 'Resource workflow details'} onClose={() => setDetails(undefined)}>
      {details === 'recording' ? <><label className="resource-flow-recording-choice">Recorded segment<select value={selectedRecording?.segment.runId ?? ''} onChange={event => setSegmentId(event.target.value)}>{recordings.filter(item => item.recording).map(item => <option key={item.segment.runId} value={item.segment.runId}>{item.segment.status} · {item.segment.runId}</option>)}</select></label>
        <Suspense fallback={<p>Opening Flow Lens…</p>}><EvidenceView title="Create or Find → Connect → Verify" recording={selectedRecording?.recording} running={view.state.status === 'running'}/></Suspense></>
        : <div className="resource-flow-details"><p>Each stage follows the native FootPrint execution. Connection details are references; private credentials stay with the configured adapters.</p>
          <dl><dt>Workflow</dt><dd><code>{view.state.id}</code></dd><dt>Definition</dt><dd><code>{view.state.definitionDigest}</code></dd><dt>Target scope</dt><dd><code>{view.state.target.scope}</code></dd></dl>
          <h3>Recorded segments</h3>{recordings.length ? <ol>{recordings.map(({ segment, recording }) => <li key={segment.runId}><button disabled={!recording} onClick={() => { setSegmentId(segment.runId); setDetails('recording'); }}>{segment.status} · Inspect segment</button><code>{segment.runId}</code><span>{segment.evidencePath}</span>{segment.resumedFromRunId && <span>Resumed from {segment.resumedFromRunId}</span>}</li>)}</ol> : <p>No native segment has completed yet.</p>}
          <h3>Recorded resource and connection outcomes</h3><pre>{JSON.stringify({ resource: view.state.resource, details: view.state.details, connection: view.state.connection, verification: view.state.verification, failure: view.state.failure }, null, 2)}</pre>
          {!!state.artifacts?.length && <details><summary>Host-provided artifacts</summary>{state.artifacts.map(artifact => <section key={artifact.id}><h4>{artifact.path}</h4><pre>{artifact.content}</pre></section>)}</details>}
        </div>}
    </DetailsPanel>}
  </main>;
}
