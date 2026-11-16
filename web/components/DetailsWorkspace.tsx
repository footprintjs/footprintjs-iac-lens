import {ReleaseAutomationPanel} from './ReleaseAutomationPanel.tsx';
import type {ReleaseAutomationAction} from '../../src/core/release-automation.ts';
import { ChangeAssessmentStrip } from './ChangeAssessmentStrip.tsx';
import type { DashboardState, Scenario } from '../../src/core/types.ts';
import { projectResourceFlow, type ResourceFlowAction } from '../../src/core/resource-flow.ts';
import { projectRevisionReview } from '../../src/core/revision-review.ts';
import { Sidebar, type View } from './Sidebar.tsx';
import { Icon } from './Icon.tsx';
import { AppAccess } from './AppAccess.tsx';
import { RunControls } from './RunControls.tsx';
import { Summary } from './Summary.tsx';
import { InfrastructureWorkspace } from './InfrastructureWorkspace.tsx';
import { ConnectionChecks } from './ConnectionChecks.tsx';
import { IdentityChecks } from './IdentityChecks.tsx';
import { ActivityBar } from './ActivityBar.tsx';
import { RunFeed } from './RunFeed.tsx';
import { ChangeReview } from './ChangeReview.tsx';
import { ResourceFlowStrip } from './ResourceFlowStrip.tsx';
import type { EvidenceKind } from './EvidenceSource.tsx';
import type { ConnectionProfileHandler } from './ConnectionProfilesControl.tsx';
import { RecordedTraceButton } from './RecordedTraceButton.tsx';
import { HostActionButtons } from './HostActionButtons.tsx';
import type { HostActionInput } from '../../src/core/host-actions.ts';
import type { DeliveryAction } from '../../src/core/delivery.ts';
import { MigrationPanel } from './MigrationPanel.tsx';
import type { MigrationAction } from '../../src/core/migration.ts';
import { PipelinePanel } from './PipelinePanel.tsx';
import type { PipelineAction } from '../../src/core/pipeline.ts';
import { DeliveryStrip } from './DeliveryStrip.tsx';
import { ApplicationSetupPanel, type ApplicationActionHandler } from './ApplicationSetupPanel.tsx';
import { OnboardingSlot } from '../features/onboarding/OnboardingSlot.tsx';
import type { OnboardingAction } from '../../src/core/onboarding.ts';
import type { OnboardingVersionAction } from '../../src/core/onboarding-versions.ts';

/** One full workspace for standalone deployments and orchestrated resource workflows. */
export function DetailsWorkspace({ state, posting, error, neoUrl, fitWindow, view, selectedResource,
  selectedConnection, evidenceKind, setView, selectResource, selectConnection, setEvidenceKind,
  selectActivity, run, resourceFlow, profileAction, hostAction, delivery, pipeline, migration, releaseAutomation, application, onboarding, onboardingVersion, dismissError }: {
  state: DashboardState; posting: boolean; error?: string; neoUrl?: string; fitWindow: boolean; view: View;
  selectedResource?: string; selectedConnection?: string; evidenceKind: EvidenceKind;
  setView(view: View): void; selectResource(id?: string): void; selectConnection(id?: string): void;
  setEvidenceKind(kind: EvidenceKind): void; selectActivity(id: string): void;
  run(scenario: Scenario, reviewId?: string): void; resourceFlow(input: ResourceFlowAction): void; dismissError(): void;
  profileAction?: ConnectionProfileHandler;
  hostAction?(input: HostActionInput): void;
  releaseAutomation?(input:ReleaseAutomationAction):void;
  migration?(input:MigrationAction):void;
  pipeline?(input:PipelineAction):void;
  delivery?(input: DeliveryAction): void;
  application?: ApplicationActionHandler;
  onboarding?(input: OnboardingAction): void;
  onboardingVersion?(input: OnboardingVersionAction): void;
}) {
  const revision = projectRevisionReview(state);
  return <div className="app-layout"><Sidebar state={state} view={view} onView={setView}/><main className="main-content">
      <section className="page-heading"><div><div className="eyebrow">INFRASTRUCTURE OVERVIEW</div><h1>{state.onboarding?.label ?? state.application?.label ?? state.design?.name ?? state.resourceFlow?.label ?? state.graph?.name ?? 'Your system'}</h1>{!state.application && <AppAccess state={state} neoUrl={neoUrl}/>}</div><div className="page-actions"><RecordedTraceButton state={state} technical/><HostActionButtons state={state} posting={posting} onAction={hostAction}/>{neoUrl && !state.application && <a className="button button-secondary" href={neoUrl} target="_blank" rel="noreferrer">{state.resourceFlow || state.onboarding ? 'Open app' : 'Open Neo'}<Icon name="external" size={15}/></a>}<span className={`run-status run-${state.resourceFlow?.status ?? state.run?.status ?? 'idle'}`}><span/>{state.application ? state.application.phase === 'ready' ? 'Application verified' : state.application.busy ? 'Setup in progress' : 'Application setup' : state.resourceFlow ? state.resourceFlow.status === 'passed' ? 'Workflow complete' : projectResourceFlow(state)?.headline : state.run?.status === 'running' ? 'Deployment in progress' : state.run?.status === 'passed' ? 'Deployment complete' : state.run?.status === 'failed' ? 'Deployment failed' : 'Ready to deploy'}</span></div></section>
      {error && <div className="error-banner" role="alert"><Icon name="close" size={17}/><span>{error}</span><button className="icon-button" onClick={dismissError} aria-label="Dismiss error"><Icon name="close" size={15}/></button></div>}
      <div className="target-row"><div className="target-description"><span className={`mode-pill ${state.mode === 'simulator' ? 'mode-simulation' : 'mode-real'}`}>{state.mode === 'kubernetes' ? 'LOCAL KUBERNETES' : state.mode === 'simulator' ? 'SIMULATION' : 'CONFIGURED PROVIDERS'}</span><span className="target-name">{state.target?.context ?? state.target?.label ?? state.target?.id ?? (state.application ? 'Choose an application target' : 'Local simulator')}</span></div>{!state.onboarding && !state.application && !state.delivery && !state.pipeline && !state.migration && !state.releaseAutomation && <RunControls state={state} posting={posting} onRun={scenario => { void run(scenario); }}/>}</div>
      {state.systemTopology ? <details className="system-setup-details"><summary>Setup controls & recorded checks</summary><OnboardingSlot state={state} posting={posting} technical onAction={onboarding} onVersionAction={onboardingVersion}/></details> : <OnboardingSlot state={state} posting={posting} technical onAction={onboarding} onVersionAction={onboardingVersion}/>}
      {state.application && <ApplicationSetupPanel state={state} posting={posting} onAction={application} onProfileAction={profileAction} technical/>}
      {state.resourceFlow && <ResourceFlowStrip state={state} posting={posting} onAction={resourceFlow} onProfileAction={profileAction}/>}
      {state.releaseAutomation&&<ReleaseAutomationPanel view={state.releaseAutomation} disabled={state.busy||posting} onAction={releaseAutomation} technical/>}
      {state.migration&&<MigrationPanel view={state.migration} disabled={state.busy||posting} onAction={migration} technical/>}
      {state.pipeline&&<PipelinePanel view={state.pipeline} disabled={state.busy||posting} onAction={pipeline} technical/>}
      {state.changeAssessment&&<ChangeAssessmentStrip view={state.changeAssessment}/>}
      {state.delivery && <DeliveryStrip view={state.delivery} disabled={state.busy || posting} onDeploy={delivery}/>}
      {revision && <ChangeReview view={revision} disabled={state.busy || posting} readOnly={!!state.resourceFlow || !!state.delivery || !!state.pipeline || !!state.releaseAutomation}
        onReview={() => run('revision-review')} onApply={() => run('revision-apply', revision.state.reviewId)}/>}
      {(!(state.onboarding || state.application) || !!state.graph || !!state.systemTopology || view === 'evidence' && !!state.recording) && (!state.migration||state.graph)&&<>{(!(state.onboarding || state.application) || !!state.graph) && !state.systemTopology && <Summary state={state}/>}
      <InfrastructureWorkspace state={state} view={view} selected={selectedResource} evidenceKind={evidenceKind} fitWindow={fitWindow}
        onView={setView} onSelect={selectResource} onConnectionSelect={selectConnection} onEvidenceKind={setEvidenceKind}/></>}
      {!state.onboarding && !state.application && <><ConnectionChecks state={state} compact={fitWindow} selected={selectedConnection} onSelect={selectConnection} onCheck={() => { void run('connections'); }} onEvidence={() => { selectConnection(undefined); setEvidenceKind('connections'); setView('evidence'); }}/>
      <IdentityChecks state={state} compact={fitWindow} onCheck={() => { void run('identity'); }} onEvidence={() => { setEvidenceKind('identity'); setView('evidence'); }}/></>}
      {fitWindow ? <ActivityBar state={state} onSelect={selectActivity}/> : <RunFeed state={state} onSelect={selectActivity}/>}<footer className="page-footer"><span>Native FootPrint recording · read-only evidence inspection</span><span>{state.mode === 'simulator' ? 'Simulation · no cloud resources are provisioned' : state.mode === 'kubernetes' ? 'Local fixture · scripted model and seeded data' : 'Host-configured providers · readiness from recorded observations'}</span></footer>
    </main></div>;
}
