import type {RecordedDeploymentStep} from '../src/core/topology-deployment-step.ts';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { localAppUrl } from '../src/core/model.ts';
import { useDashboard } from './lib/use-dashboard.ts';
import { Icon } from './components/Icon.tsx';
import { AgentFeatureBoundary } from './features/agents/AgentFeatureBoundary.tsx';
import type { View } from './lib/workspace-views.ts';
import type { EvidenceKind } from './components/EvidenceSource.tsx';
import './components/fit-window.css';
import './features/agents/shell.css';
import {RunWorkspaceSlot} from './features/runs/RunWorkspaceSlot.tsx';
import {OnboardingSlot} from './features/onboarding/OnboardingSlot.tsx';
import type {LensTheme} from './theme/types.ts';
import {resolveLensTheme} from './theme/resolve-theme.ts';
import {LensThemeProvider} from './theme/LensThemeContext.tsx';
import './theme/theme.css';

const agentFeature = () => lazy(() => import('./features/agents/AgentWorkspace.tsx'));
const SimpleDashboard=lazy(()=>import('./components/SimpleDashboard.tsx').then(module=>({default:module.SimpleDashboard})));
const DetailsWorkspace=lazy(()=>import('./components/DetailsWorkspace.tsx').then(module=>({default:module.DetailsWorkspace})));

export interface IacLensProps { baseUrl?: string; fitWindow?: boolean; theme?: LensTheme }
/** Optional React surface; the protocol, model and transport are framework-neutral. */
export function IacLens({ baseUrl = '', fitWindow = true, theme }: IacLensProps) {
  const resolvedTheme=useMemo(()=>resolveLensTheme(theme),[theme]);
  const { state, connected, error, posting, run, resourceFlow, connectionProfile, hostAction, delivery, pipeline, migration, releaseAutomation, application, onboarding, onboardingVersion, agentPlatform, agentError, dismissError, dismissAgentError } = useDashboard(baseUrl);
  const [workspace, setWorkspace] = useState<'runs' | 'infrastructure' | 'agents'>('runs');
  const [AgentWorkspace, setAgentWorkspace] = useState(agentFeature);
  const [agentFeatureAttempt, setAgentFeatureAttempt] = useState(0);
  const [displayMode, setDisplayMode] = useState<'simple' | 'details'>('simple');
  const [view, setView] = useState<View>('deployment');
  const [recordedStep,setRecordedStep]=useState<RecordedDeploymentStep>();
  const [selected, setSelected] = useState<string>();
  const [selectedConnection, setSelectedConnection] = useState<string>();
  const [evidenceKind, setEvidenceKind] = useState<EvidenceKind>('deployment');
  const selectedResource = state?.graph?.resources.find(resource => resource.id === selected)?.id;
  useEffect(() => {
    setSelected(current => state?.graph?.resources.some(resource => resource.id === current) ? current : undefined);
    setSelectedConnection(undefined);
  }, [state?.graph?.digest]);
  const selectResource = (id: string | undefined) => { setSelected(id); setSelectedConnection(undefined); };
  const selectConnection = (id?: string) => { setSelectedConnection(id); if (id) { setSelected(undefined); setView('system'); } };
  const openRecordedStep=(step:RecordedDeploymentStep)=>{setWorkspace('infrastructure');setRecordedStep(step);selectResource(step.resourceId);setView('deployment');setDisplayMode('details');};
  const selectActivity = (id: string) => { selectResource(id); setView('deployment'); };
  const neoUrl = localAppUrl(state?.neoUrl);
  const agentsAvailable = state?.agentPlatformAvailable || !!state?.agentPlatform;
  const openAgents = () => {
    setWorkspace('agents');
    if (!state?.agentPlatform && !posting) void agentPlatform({ action: 'open' });
  };
  const simpleWorkspace=state&&<Suspense fallback={<section role="status">Opening setup…</section>}><SimpleDashboard onRecordedStep={openRecordedStep} state={state} posting={posting} error={error} neoUrl={neoUrl} onRun={(scenario, reviewId) => { void run(scenario, reviewId); }} onResourceFlow={input => { void resourceFlow(input); }} onProfileAction={connectionProfile} onHostAction={input => { void hostAction(input); }} onDelivery={input => { void delivery(input); }} onReleaseAutomation={input=>{void releaseAutomation(input);}} onMigration={input=>{void migration(input);}} onPipeline={input=>{void pipeline(input);}} onOnboardingVersion={input => { void onboardingVersion(input); }} onOnboarding={input => { void onboarding(input); }} onApplication={input => { void application(input); }} onDismissError={dismissError} onDetails={() => { setWorkspace('infrastructure');setView('evidence'); setDisplayMode('details'); }} onSystem={()=>{setWorkspace('infrastructure');setView('system');setDisplayMode('details');}}/></Suspense>;
  return <LensThemeProvider value={resolvedTheme}><div data-lens-theme={resolvedTheme.mode} style={resolvedTheme.style} className={`iac-lens${fitWindow ? ' lens-fit' : ''}${displayMode === 'simple' ? ' lens-simple' : ''}${agentsAvailable ? ' lens-agent-navigation' : ''}${workspace==='runs'?' lens-runs':''}`}><header className="topbar"><a href="#" className="brand" aria-label="InfraChart Lens home" onClick={event => { event.preventDefault(); setWorkspace('runs'); setDisplayMode('simple'); setView('deployment'); }}><span className="brand-symbol"><Icon name="graph" size={23}/></span><span>FootPrintJS<span className="brand-divider">/</span><strong>InfraChart Lens</strong></span></a><div className="topbar-right">
      {workspace!=='runs'&&<button type="button" className="button button-secondary" onClick={()=>setWorkspace('runs')}>All runs</button>}
      {workspace!=='runs'&&agentsAvailable && <div className="display-modes workspace-modes" role="group" aria-label="Workspace"><button type="button" aria-pressed={workspace === 'infrastructure'} onClick={() => setWorkspace('infrastructure')}>Infrastructure</button><button type="button" aria-pressed={workspace === 'agents'} onClick={openAgents}>Agents</button></div>}
      {workspace!=='runs'&&<div className="display-modes" role="group" aria-label="Display mode"><button aria-pressed={displayMode === 'simple'} onClick={() => setDisplayMode('simple')}>Simple</button><button aria-pressed={displayMode === 'details'} onClick={() => { setView('system'); setDisplayMode('details'); }}>{workspace === 'agents' ? 'Details' : 'System design'}</button></div>}{workspace!=='runs'&&<span className={`connection-pill ${connected ? 'connected' : 'disconnected'}`}><span/>{connected ? state?.deploymentReadOnly ? 'Recorded' : 'Live' : 'Reconnecting'}</span>}</div></header>
    {!state ? <div className="startup-state"><Icon name="graph" size={36}/><h1>Connecting to your system</h1><p>{error ? 'Unable to connect. Please try again.' : 'Just a moment…'}</p>{error && <button className="button button-secondary" onClick={() => location.reload()}>Reconnect</button>}</div> : workspace==='runs'?<RunWorkspaceSlot baseUrl={baseUrl} liveState={state} connected={connected} onDetails={()=>{setWorkspace('infrastructure');setDisplayMode('details');setView('evidence');}} onAgents={agentsAvailable?openAgents:undefined} setup={<>{error&&<div className="run-setup-error" role="alert"><span>{error}</span><button type="button" onClick={dismissError}>Dismiss</button></div>}{state.onboarding?<OnboardingSlot state={state} posting={posting} onAction={input=>{void onboarding(input);}} onVersionAction={input=>{void onboardingVersion(input);}}/>:simpleWorkspace}</>}/>: workspace === 'agents' && agentsAvailable ? <>
      {agentError && <div className="agents-transport-error" role="alert"><span>{agentError}</span><button type="button" onClick={dismissAgentError} aria-label="Dismiss agent action error"><Icon name="close" size={14}/></button></div>}
      {state.agentPlatform ? <AgentFeatureBoundary key={agentFeatureAttempt} onRetry={() => { setAgentWorkspace(agentFeature); setAgentFeatureAttempt(current => current + 1); }} onInfrastructure={() => setWorkspace('infrastructure')}><Suspense fallback={<div className="agents-opening" role="status"><Icon name="graph" size={32}/><h1>Opening Agents</h1></div>}><AgentWorkspace state={state} view={state.agentPlatform} posting={posting} technical={displayMode === 'details'} onCheck={agentId => { void agentPlatform({ action: 'check', agentId }); }} onRefresh={() => { void agentPlatform({ action: 'refresh' }); }} onInfrastructure={() => setWorkspace('infrastructure')}/></Suspense></AgentFeatureBoundary>
        : <main className="agents-opening" aria-label="Opening Agents"><Icon name="graph" size={32}/><h1>{agentError ? 'Agents could not open' : posting ? 'Reading agent records' : 'Open your agents'}</h1><p>Read the registered agents and their recorded activity.</p><div><button type="button" className="button button-secondary" disabled={posting} onClick={() => { void agentPlatform({ action: 'open' }); }}>{posting ? 'Reading…' : 'Read records'}</button><button type="button" className="button button-secondary" onClick={() => setWorkspace('infrastructure')}>Back to infrastructure</button></div></main>}
    </> : displayMode === 'simple' ? simpleWorkspace : <Suspense fallback={<section role="status">Opening details…</section>}><DetailsWorkspace recordedStep={recordedStep} onRecordedStep={openRecordedStep} onClearRecordedStep={()=>setRecordedStep(undefined)} state={state} posting={posting} error={error} neoUrl={neoUrl} fitWindow={fitWindow}
      view={view} selectedResource={selectedResource} selectedConnection={selectedConnection} evidenceKind={evidenceKind}
      setView={setView} selectResource={selectResource} selectConnection={selectConnection} setEvidenceKind={setEvidenceKind}
      selectActivity={selectActivity} run={(scenario, reviewId) => { void run(scenario, reviewId); }} resourceFlow={input => { void resourceFlow(input); }} profileAction={connectionProfile} hostAction={input => { void hostAction(input); }} delivery={input => { void delivery(input); }} releaseAutomation={input=>{void releaseAutomation(input);}} migration={input=>{void migration(input);}} pipeline={input=>{void pipeline(input);}} onboardingVersion={input => { void onboardingVersion(input); }} onboarding={input => { void onboarding(input); }} application={input => { void application(input); }} dismissError={dismissError}/></Suspense>}
  </div></LensThemeProvider>;
}
