import { useEffect, useState } from 'react';
import { localAppUrl } from '../src/core/model.ts';
import { useDashboard } from './lib/use-dashboard.ts';
import { Icon } from './components/Icon.tsx';
import { Sidebar, type View } from './components/Sidebar.tsx';
import { RunControls } from './components/RunControls.tsx';
import { Summary } from './components/Summary.tsx';
import { InfrastructureWorkspace } from './components/InfrastructureWorkspace.tsx';
import { RunFeed } from './components/RunFeed.tsx';
import { ActivityBar } from './components/ActivityBar.tsx';
import { AppAccess } from './components/AppAccess.tsx';
import { ConnectionChecks } from './components/ConnectionChecks.tsx';
import { IdentityChecks } from './components/IdentityChecks.tsx';
import { SimpleDashboard } from './components/SimpleDashboard.tsx';
import type { EvidenceKind } from './components/EvidenceSource.tsx';
import './components/fit-window.css';

export interface IacLensProps { baseUrl?: string; fitWindow?: boolean }
/** Optional React surface; the protocol, model and transport are framework-neutral. */
export function IacLens({ baseUrl = '', fitWindow = true }: IacLensProps) {
  const { state, connected, error, posting, run, dismissError } = useDashboard(baseUrl);
  const [displayMode, setDisplayMode] = useState<'simple' | 'details'>('simple');
  const [view, setView] = useState<View>('deployment');
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
  const selectActivity = (id: string) => { selectResource(id); setView('deployment'); };
  const neoUrl = localAppUrl(state?.neoUrl);
  return <div className={`iac-lens${fitWindow ? ' lens-fit' : ''}${displayMode === 'simple' ? ' lens-simple' : ''}`}><header className="topbar"><a href="#" className="brand" aria-label="FootPrint IaC Lens home" onClick={event => { event.preventDefault(); setDisplayMode('simple'); setView('deployment'); }}><span className="brand-symbol"><Icon name="graph" size={23}/></span><span>footprint<span className="brand-divider">/</span><strong>IaC Lens</strong></span></a><div className="topbar-right"><div className="display-modes" role="group" aria-label="Display mode"><button aria-pressed={displayMode === 'simple'} onClick={() => setDisplayMode('simple')}>Simple</button><button aria-pressed={displayMode === 'details'} onClick={() => setDisplayMode('details')}>Details</button></div><span className={`connection-pill ${connected ? 'connected' : 'disconnected'}`}><span/>{connected ? state?.deploymentReadOnly ? 'Recorded' : 'Live' : 'Reconnecting'}</span></div></header>
    {!state ? <div className="startup-state"><Icon name="graph" size={36}/><h1>Connecting to your system</h1><p>{error ? 'Unable to connect. Please try again.' : 'Just a moment…'}</p>{error && <button className="button button-secondary" onClick={() => location.reload()}>Reconnect</button>}</div> : displayMode === 'simple' ? <SimpleDashboard state={state} posting={posting} error={error} neoUrl={neoUrl} onRun={(scenario, reviewId) => { void run(scenario, reviewId); }} onDismissError={dismissError} onDetails={() => setDisplayMode('details')}/> : <div className="app-layout"><Sidebar state={state} view={view} onView={setView}/><main className="main-content">
      <section className="page-heading"><div><div className="eyebrow">INFRASTRUCTURE OVERVIEW</div><h1>{state.design?.name ?? state.graph?.name ?? 'Your system'}</h1><AppAccess state={state} neoUrl={neoUrl}/></div><div className="page-actions">{neoUrl && <a className="button button-secondary" href={neoUrl} target="_blank" rel="noreferrer">Open Neo<Icon name="external" size={15}/></a>}<span className={`run-status run-${state.run?.status ?? 'idle'}`}><span/>{state.run?.status === 'running' ? 'Deployment in progress' : state.run?.status === 'passed' ? 'Deployment complete' : state.run?.status === 'failed' ? 'Deployment failed' : 'Ready to deploy'}</span></div></section>
      {error && <div className="error-banner" role="alert"><Icon name="close" size={17}/><span>{error}</span><button className="icon-button" onClick={dismissError} aria-label="Dismiss error"><Icon name="close" size={15}/></button></div>}
      <div className="target-row"><div className="target-description"><span className={`mode-pill ${state.mode === 'simulator' ? 'mode-simulation' : 'mode-real'}`}>{state.mode === 'kubernetes' ? 'LOCAL KUBERNETES' : state.mode === 'simulator' ? 'SIMULATION' : 'CONFIGURED PROVIDERS'}</span><span className="target-name">{state.target?.context ?? state.target?.label ?? state.target?.id ?? 'Local simulator'}</span></div><RunControls state={state} posting={posting} onRun={scenario => { void run(scenario); }}/></div>
      <Summary state={state}/>
      <InfrastructureWorkspace state={state} view={view} selected={selectedResource} evidenceKind={evidenceKind} fitWindow={fitWindow}
        onView={setView} onSelect={selectResource} onConnectionSelect={selectConnection} onEvidenceKind={setEvidenceKind}/>
      <ConnectionChecks state={state} compact={fitWindow} selected={selectedConnection} onSelect={selectConnection} onCheck={() => { void run('connections'); }} onEvidence={() => { setSelectedConnection(undefined); setEvidenceKind('connections'); setView('evidence'); }}/>
      <IdentityChecks state={state} compact={fitWindow} onCheck={() => { void run('identity'); }} onEvidence={() => { setEvidenceKind('identity'); setView('evidence'); }}/>
      {fitWindow ? <ActivityBar state={state} onSelect={selectActivity}/> : <RunFeed state={state} onSelect={selectActivity}/>}<footer className="page-footer"><span>Native FootPrint recording · read-only evidence inspection</span><span>{state.mode === 'simulator' ? 'Simulation · no cloud resources are provisioned' : state.mode === 'kubernetes' ? 'Local fixture · scripted model and seeded data' : 'Host-configured providers · readiness from recorded observations'}</span></footer>
    </main></div>}
  </div>;
}
