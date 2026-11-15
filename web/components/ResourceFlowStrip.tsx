import { useState } from 'react';
import type { DashboardState } from '../../src/core/types.ts';
import { projectResourceFlow, type ResourceFlowAction } from '../../src/core/resource-flow.ts';
import { DetailsPanel } from './DetailsPanel.tsx';
import { ResourceFlowDetails } from './ResourceFlowDetails.tsx';
import { ResourceFlowEvidence } from './ResourceFlowEvidence.tsx';
import { Icon } from './Icon.tsx';
import './resource-flow.css';
import { ConnectionProfilesControl, type ConnectionProfileHandler } from './ConnectionProfilesControl.tsx';

/** Orchestration controls compose with the resource canvas instead of replacing it. */
export function ResourceFlowStrip({ state, posting, onAction, onProfileAction }: {
  state: DashboardState; posting: boolean; onAction(input: ResourceFlowAction): void;
  onProfileAction?: ConnectionProfileHandler;
}) {
  const view = projectResourceFlow(state)!;
  const [profile, setProfile] = useState<string>();
  const [panel, setPanel] = useState<{ kind: 'details' | 'recording'; segmentId?: string }>();
  const pause = view.state.pause, profiles = pause?.profiles ?? [];
  const pinned = view.state.selectedProfileId;
  const chosen = pinned ?? (state.connectionProfiles?.profiles.some(item => item.id === profile) ? profile : undefined);
  const selected = profiles.some(item => item.id === (pinned ?? profile)) ? pinned ?? profile : profiles[0]?.id;
  const disabled = state.busy || posting || state.connectionProfiles?.busy === true;
  const labels = { acquire: view.state.mode === 'create' ? 'Create' : 'Find', details: 'Details', connect: 'Connect', verify: 'Verify' };
  return <>
    <section className={`resource-flow-strip workflow-${view.state.status}`} aria-label="Resource workflow orchestration">
      <div className="resource-flow-strip-main">
        <ol className="resource-flow-steps" aria-label="Native workflow stages">{view.stages.map((stage, index) => <li key={stage.id}
          className={`workflow-step workflow-step-${stage.status}`} aria-label={`${stage.label}: ${stage.caption}`}>
          <span className="workflow-step-mark">{stage.status === 'passed' ? <Icon name="check" size={12}/> : index + 1}</span>
          <span>{labels[stage.id]}</span>{index < view.stages.length - 1 && <Icon name="chevron" size={13}/>}</li>)}</ol>
        <span className="resource-flow-strip-status" aria-live="polite">{view.state.status === 'passed' ? 'Workflow complete' : view.headline}</span>
        <div className="resource-flow-strip-actions"><button onClick={() => setPanel({ kind: 'details' })}>Workflow details</button>
          <button disabled={!view.state.segments.length} onClick={() => setPanel({ kind: 'recording' })} aria-label="Inspect workflow recording"><Icon name="evidence" size={15}/></button>
          {view.state.status === 'idle' && <button className="simple-button simple-primary" disabled={disabled || !view.canStart || !!state.connectionProfiles?.requiredAtStart && !chosen}
            onClick={() => onAction({ action: 'start', ...(chosen ? { profileId: chosen } : {}) })}><Icon name="play" size={14}/>Start workflow</button>}
        </div>
      </div>
      {state.connectionProfiles && <ConnectionProfilesControl view={state.connectionProfiles} selected={chosen} locked={view.state.status !== 'idle'} disabled={disabled}
        onSelect={setProfile} onAction={onProfileAction}/>}
      {pause && <div className="resource-flow-handoff" aria-label="Connection details needed"><div><strong>{pause.prompt}</strong><span>Choose an approved connection profile.</span></div>
        <label><span className="sr-only">Connection profile</span><select value={selected ?? ''} disabled={disabled || !view.canResume || !!pinned} onChange={event => setProfile(event.target.value)}>
          {!profiles.length && <option value="">No profiles configured</option>}{profiles.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label><button className="simple-button simple-primary" disabled={disabled || !view.canResume || !selected}
          onClick={() => { if (selected) onAction({ action: 'resume', pauseToken: pause.token, profileId: selected }); }}><Icon name="play" size={14}/>Continue</button>
      </div>}
      {(view.state.error || state.resourceFlowError) && <div className="resource-flow-strip-error" role="status">{state.resourceFlowError ?? view.state.error}</div>}
    </section>
    {panel && <DetailsPanel title={panel.kind === 'recording' ? 'Workflow execution evidence' : 'Resource workflow details'} onClose={() => setPanel(undefined)}>
      {panel.kind === 'recording' ? <ResourceFlowEvidence state={state} initialSegmentId={panel.segmentId}/>
        : <ResourceFlowDetails state={state} onInspect={segmentId => setPanel({ kind: 'recording', segmentId })}/>}
    </DetailsPanel>}
  </>;
}
