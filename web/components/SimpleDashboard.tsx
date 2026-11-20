import { useState } from 'react';
import { ConnectionDetails } from './ConnectionDetails.tsx';
import { DetailsPanel } from './DetailsPanel.tsx';
import { connectionProgress, declaredConnection, untestedConnections } from '../../src/core/connections.ts';
import type {RecordedDeploymentStep} from '../../src/core/topology-deployment-step.ts';
import { SystemTopologySlot } from '../features/system-topology/SystemTopologySlot.tsx';
import {ReleaseAutomationPanel} from './ReleaseAutomationPanel.tsx';
import type {ReleaseAutomationAction} from '../../src/core/release-automation.ts';
import { ChangeAssessmentStrip } from './ChangeAssessmentStrip.tsx';
import { projectBuildScene } from '../../src/core/build-scene.ts';
import { projectRevisionReview } from '../../src/core/revision-review.ts';
import type { DashboardState, Scenario } from '../../src/core/types.ts';
import { BuildScene } from './BuildScene.tsx';
import { Icon } from './Icon.tsx';
import { ChangeReview } from './ChangeReview.tsx';
import { ResourceFlowStrip } from './ResourceFlowStrip.tsx';
import type { ResourceFlowAction } from '../../src/core/resource-flow.ts';
import './simple-dashboard.css';
import type { ConnectionProfileHandler } from './ConnectionProfilesControl.tsx';
import { RecordedTraceButton } from './RecordedTraceButton.tsx';
import { HostActionButtons } from './HostActionButtons.tsx';
import type { HostActionInput } from '../../src/core/host-actions.ts';
import { deliveryPhases, type DeliveryAction } from '../../src/core/delivery.ts';
import { MigrationPanel } from './MigrationPanel.tsx';
import type { MigrationAction } from '../../src/core/migration.ts';
import { PipelinePanel } from './PipelinePanel.tsx';
import type { PipelineAction } from '../../src/core/pipeline.ts';
import { DeliveryStrip } from './DeliveryStrip.tsx';
import { ApplicationSetupPanel, type ApplicationActionHandler } from './ApplicationSetupPanel.tsx';
import { OnboardingSlot } from '../features/onboarding/OnboardingSlot.tsx';
import type { OnboardingAction } from '../../src/core/onboarding.ts';
import type { OnboardingVersionAction } from '../../src/core/onboarding-versions.ts';

function checkLabel(status: string | undefined, passed: number, total: number) {
  if (status === 'checking') return 'Checking…';
  if (status === 'failed') return 'Needs attention';
  if (status === 'passed') return `${passed}/${total} passed`;
  return 'Not checked';
}

export function SimpleDashboard({ state, posting, error, neoUrl, onRun, onResourceFlow, onProfileAction, onHostAction, onDelivery, onPipeline, onMigration, onReleaseAutomation, onApplication, onOnboarding, onOnboardingVersion, onDismissError, onDetails, onSystem, onRecordedStep }: {
  onRecordedStep?(step:RecordedDeploymentStep):void;
  state: DashboardState; posting: boolean; error?: string; neoUrl?: string;
  onRun: (scenario: Scenario, reviewId?: string) => void; onDismissError: () => void; onDetails: () => void; onSystem?: () => void;
  onResourceFlow(input: ResourceFlowAction): void;
  onProfileAction?: ConnectionProfileHandler;
  onHostAction?(input: HostActionInput): void;
  onReleaseAutomation?(input:ReleaseAutomationAction):void;
  onMigration?(input:MigrationAction):void;
  onPipeline?(input:PipelineAction):void;
  onDelivery?(input: DeliveryAction): void;
  onApplication?: ApplicationActionHandler;
  onOnboarding?(input: OnboardingAction): void;
  onOnboardingVersion?(input: OnboardingVersionAction): void;
}) {
  const scene = projectBuildScene(state);
  const revision = projectRevisionReview(state);
  const disabled = state.busy || posting;
  const checksDisabled = disabled || Boolean(state.resourceFlow ? state.resourceFlow.status !== 'passed'
    : (state.managedReviewAvailable || state.revisionReview) && state.run?.status !== 'passed');
  const scenario: Scenario | undefined = state.onboarding || state.application || state.resourceFlow || state.delivery || state.pipeline || state.migration || state.releaseAutomation ? undefined : state.managedReviewAvailable ? 'review'
    : state.mode === 'kubernetes' && state.neoAvailable ? 'neo' : scene.simulation ? 'demo' : undefined;
  const connectionChecks = state.connections?.checks ?? [];
  const identityChecks = state.identity?.checks ?? [];
  const connectionText = checkLabel(state.connections?.status, connectionChecks.filter(check => check.status === 'connected').length, connectionChecks.length);
  const accessText = checkLabel(state.identity?.status, identityChecks.filter(check => check.status === 'passed').length, identityChecks.length);
  const identityAvailable = !state.onboarding && !state.application && (!(state.resourceFlow || state.delivery || state.pipeline || state.migration || state.releaseAutomation) || state.identityReviewAvailable === true);
  const deliveryPhase = state.delivery && deliveryPhases(state.delivery).find(phase => phase.status === 'running');
  const applicationCaption = state.application && (
    state.application.phase === 'failed' || state.application.phase === 'incomplete' ? 'Needs attention'
      : state.application.phase === 'choose' || state.application.phase === 'inspect' ? 'Waiting for setup'
        : state.application.phase === 'review' || state.application.phase === 'deploy' && !state.application.busy ? 'Deployment not started' : undefined);
  const headline = applicationCaption ?? (state.delivery?.status === 'running' ? `${deliveryPhase?.label ?? 'Updating'}…`
    : state.delivery?.status === 'failed' || state.delivery?.status === 'incomplete' ? 'Update needs attention' : scene.headline);
  return <main className={`simple-dashboard${state.systemTopology ? ' has-system-topology' : ''}${state.onboarding ? ' has-onboarding' : ''}${state.onboarding && (state.graph || state.systemTopology) ? ' onboarding-with-system' : ''}${state.application ? ' has-application' : ''}${state.application && state.graph ? ' application-with-system' : ''}${state.resourceFlow ? ' has-resource-flow' : ''}${state.pipeline ? ' has-pipeline' : ''}${state.pipeline&&state.graph ? ' pipeline-with-system' : ''}${state.migration?' has-migration':''}${state.releaseAutomation?' has-release-automation':''}`}>
    <section className="simple-heading"><div><div className="simple-eyebrow">{state.onboarding || state.application ? 'Application setup' : scene.simulation ? 'Simulation' : state.pipeline?.catalog.simulation ? 'Simulation' : state.deploymentReadOnly ? 'Recorded view' : 'Your system'}</div><h1>{state.onboarding?.label ?? state.application?.label ?? state.design?.name ?? (state.managedReviewAvailable || revision || state.resourceFlow || state.delivery || state.pipeline || state.migration || state.releaseAutomation ? state.target?.label : undefined) ?? (neoUrl ? 'Neo' : 'Your system')}</h1></div><div className="simple-actions">
      <RecordedTraceButton state={state}/><HostActionButtons state={state} posting={posting} onAction={onHostAction}/>
      {neoUrl && !state.application && <a href={neoUrl} target="_blank" rel="noreferrer" className="simple-button simple-secondary">{state.resourceFlow || state.onboarding ? 'Open app' : 'Open Neo'}<Icon name="external" size={16}/></a>}
      {!revision && !state.deploymentReadOnly && scenario && <button className="simple-button simple-primary" disabled={disabled} onClick={() => onRun(scenario)}><Icon name="play" size={16}/>{disabled ? 'Working…' : state.run?.status === 'passed' ? 'Check setup' : 'Build system'}</button>}
    </div></section>
    <OnboardingSlot state={state} posting={posting} onAction={onOnboarding} onVersionAction={onOnboardingVersion}/>
    {state.application && <ApplicationSetupPanel state={state} posting={posting} onAction={onApplication} onProfileAction={onProfileAction}/>}
    {state.resourceFlow && <ResourceFlowStrip state={state} posting={posting} onAction={onResourceFlow} onProfileAction={onProfileAction}/>}
    {state.releaseAutomation&&<ReleaseAutomationPanel view={state.releaseAutomation} compact={!!state.graph} disabled={disabled} onAction={onReleaseAutomation}/>}
    {state.migration&&<MigrationPanel view={state.migration} disabled={disabled} onAction={onMigration}/>}
    {state.pipeline&&<PipelinePanel view={state.pipeline} compact={!!state.graph} disabled={disabled} onAction={onPipeline}/>}
    {state.changeAssessment&&<ChangeAssessmentStrip view={state.changeAssessment}/>}
    {state.delivery && <DeliveryStrip view={state.delivery} disabled={disabled} onDeploy={onDelivery}/>}
    {revision && !state.releaseAutomation && <ChangeReview view={revision} disabled={disabled} readOnly={!!state.resourceFlow || !!state.delivery || !!state.pipeline || !!state.releaseAutomation}
      onReview={() => onRun('revision-review')} onApply={() => onRun('revision-apply', revision.state.reviewId)}/>}
    {error && <div className="simple-error" role="alert"><span>That didn’t finish. <button onClick={onDetails}>See details</button></span><button onClick={onDismissError} aria-label="Dismiss error"><Icon name="close" size={17}/></button></div>}
    {((!state.onboarding&&!state.application&&!state.pipeline&&!state.migration&&!state.releaseAutomation)||!!state.graph||!!state.systemTopology)&&<section className={`simple-stage phase-${scene.phase}`}>
      {!state.systemTopology && <div className="simple-stage-heading"><div><h2 aria-live="polite">{state.resourceFlow?.status === 'paused' ? 'Waiting for connection details' : state.resourceFlow?.status === 'idle' && state.resourceFlow.mode === 'existing' ? 'Ready to connect' : headline}</h2>{scene.subline && <p>{scene.subline}</p>}</div>{state.pipeline&&<button className="simple-button simple-secondary" onClick={onSystem??onDetails}>View running system<Icon name="external" size={14}/></button>}<span className="simple-count">{scene.counts.ready}<span> / {scene.counts.total} ready</span></span></div>}
      <SystemTopologyFallback onRecordedStep={onRecordedStep} state={state} scene={scene} changes={revision?.resources}/>
      {scene.warnings.length > 0 && <div className="simple-warning"><span>Some results need a closer look.</span><button onClick={onDetails}>Details<Icon name="arrow" size={14}/></button></div>}
    </section>}
    <footer className="simple-checks">
      {(state.connectionReviewAvailable || state.connections) && <div className={`simple-check check-${state.connections?.status ?? 'idle'}`}><span className="simple-check-symbol"><Icon name="network" size={20}/></span><div><strong>Connections</strong><span aria-live="polite">{connectionText}</span></div>{state.connectionReviewAvailable && !state.onboarding && !state.application && <button aria-label="Check connections" disabled={checksDisabled} onClick={() => onRun('connections')}>Check</button>}</div>}
      {state.identity && <div className={`simple-check check-${state.identity.status}`}><span className="simple-check-symbol"><Icon name="identity" size={20}/></span><div><strong>Sign-in & access</strong><span aria-live="polite">{accessText}</span></div>{identityAvailable && <button aria-label="Check sign-in and access" disabled={checksDisabled} onClick={() => onRun('identity')}>Check</button>}</div>}
      <span className="simple-recorded"><span/>FootPrint</span>
    </footer>
  </main>;
}

function SystemTopologyFallback({ state, scene, changes, onRecordedStep }: { onRecordedStep?(step:RecordedDeploymentStep):void; state: DashboardState; scene: ReturnType<typeof projectBuildScene>; changes: Parameters<typeof BuildScene>[0]['changes'] }) {
  const [selected, setSelected] = useState<{ id: string; digest?: string }>();
  const edge = selected && selected.digest === state.graph?.digest && scene.edges.find(item => item.id === selected.id);
  const check = edge && connectionProgress(state, edge.id, edge.from, edge.to);
  const declaration = check && declaredConnection(state.graph, check);
  return state.systemTopology ? <SystemTopologySlot view={state.systemTopology} state={state} onRecordedStep={onRecordedStep} simple/> : <><BuildScene onConnection={id => setSelected({ id, digest: state.graph?.digest })} compact={!!state.releaseAutomation} scene={scene} execution={state.run?.status} workflowStatus={state.resourceFlow?.status} changes={changes}/>
    {check && declaration && state.graph && <DetailsPanel title={declaration.label ?? `${check.from} → ${check.to}`} onClose={() => setSelected(undefined)}>
      <ConnectionDetails details={declaration.details} check={check} run={state.connections ?? untestedConnections(state.graph)}/>
    </DetailsPanel>}</>;
}
