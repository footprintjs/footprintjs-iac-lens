import { useState } from 'react';
import { localAppUrl } from '../src/core/model.ts';
import { useDashboard } from './lib/use-dashboard.ts';
import { Icon } from './components/Icon.tsx';
import { Sidebar, type View } from './components/Sidebar.tsx';
import { RunControls } from './components/RunControls.tsx';
import { Summary } from './components/Summary.tsx';
import { SystemBlocks } from './components/SystemBlocks.tsx';
import { DeploymentFlow } from './components/DeploymentFlow.tsx';
import { ResourceCanvas } from './components/ResourceCanvas.tsx';
import { Inspector } from './components/Inspector.tsx';
import { RunFeed } from './components/RunFeed.tsx';
import { ArtifactsView } from './components/ArtifactsView.tsx';
import { AppAccess } from './components/AppAccess.tsx';
import { ConnectionChecks } from './components/ConnectionChecks.tsx';
import { IdentityChecks } from './components/IdentityChecks.tsx';
import { EvidenceSource, type EvidenceKind } from './components/EvidenceSource.tsx';

export interface IacLensProps { baseUrl?: string }
/** Optional React surface; the protocol, model and transport are framework-neutral. */
export function IacLens({ baseUrl = '' }: IacLensProps) {
  const { state, connected, error, posting, run, dismissError } = useDashboard(baseUrl);
  const [view, setView] = useState<View>('graph');
  const [selected, setSelected] = useState<string>();
  const [selectedConnection, setSelectedConnection] = useState<string>();
  const [evidenceKind, setEvidenceKind] = useState<EvidenceKind>('deployment');
  const resource = state?.graph?.resources.find(resource => resource.id === selected);
  const selectResource = (id: string | undefined) => { setSelected(id); setSelectedConnection(undefined); setView('graph'); };
  const selectConnection = (id?: string) => { setSelectedConnection(id); setSelected(undefined); setView('graph'); };
  const neoUrl = localAppUrl(state?.neoUrl);
  return <div className="iac-lens"><header className="topbar"><a href="#" className="brand" aria-label="FootPrint IaC Lens home" onClick={event => { event.preventDefault(); setView('graph'); }}><span className="brand-symbol"><Icon name="graph" size={23}/></span><span>footprint<span className="brand-divider">/</span><strong>IaC Lens</strong></span></a><div className="topbar-right"><span className="local-label"><Icon name="compute" size={14}/>Local workspace</span><span className={`connection-pill ${connected ? 'connected' : 'disconnected'}`}><span/>{connected ? 'Live connection' : 'Reconnecting'}</span></div></header>
    {!state ? <div className="startup-state"><Icon name="graph" size={36}/><h1>Connecting to your infrastructure</h1><p>{error ?? 'Loading the desired graph and recorded deployment state…'}</p>{error && <button className="button button-secondary" onClick={() => location.reload()}>Reconnect</button>}</div> : <div className="app-layout"><Sidebar state={state} view={view} onView={setView}/><main className="main-content">
      <section className="page-heading"><div><div className="eyebrow">INFRASTRUCTURE OVERVIEW</div><h1>{state.design?.name ?? state.graph?.name ?? 'Your system'}</h1><AppAccess state={state} neoUrl={neoUrl}/></div><div className="page-actions">{neoUrl && <a className="button button-secondary" href={neoUrl} target="_blank" rel="noreferrer">Open Neo<Icon name="external" size={15}/></a>}<span className={`run-status run-${state.run?.status ?? 'idle'}`}><span/>{state.run?.status === 'running' ? 'Deployment in progress' : state.run?.status === 'passed' ? 'Deployment complete' : state.run?.status === 'failed' ? 'Deployment failed' : 'Ready to deploy'}</span></div></section>
      {error && <div className="error-banner" role="alert"><Icon name="close" size={17}/><span>{error}</span><button className="icon-button" onClick={dismissError} aria-label="Dismiss error"><Icon name="close" size={15}/></button></div>}
      <div className="target-row"><div className="target-description"><span className={`mode-pill ${state.mode === 'simulator' ? 'mode-simulation' : 'mode-real'}`}>{state.mode === 'kubernetes' ? 'LOCAL KUBERNETES' : state.mode === 'simulator' ? 'SIMULATION' : 'CONFIGURED PROVIDERS'}</span><span className="target-name">{state.target?.context ?? state.target?.label ?? state.target?.id ?? 'Local simulator'}</span></div><RunControls state={state} posting={posting} onRun={scenario => { setSelected(undefined); void run(scenario); }}/></div>
      <Summary state={state}/>
      <DeploymentFlow state={state} selected={selected} onSelect={selectResource}/>
      <details className="capability-inventory"><summary>Browse capabilities<small>Groups, not deployment order</small></summary><SystemBlocks state={state} onSelect={selectResource}/></details>
      <ConnectionChecks state={state} selected={selectedConnection} onSelect={selectConnection} onCheck={() => { void run('connections'); }} onEvidence={() => { setEvidenceKind('connections'); setView('evidence'); }}/>
      <IdentityChecks state={state} onCheck={() => { void run('identity'); }} onEvidence={() => { setEvidenceKind('identity'); setView('evidence'); }}/>
      <section className={`workbench${resource && view === 'graph' ? ' with-inspector' : ''}`}><div className="workbench-main"><div className="workbench-toolbar"><div className="view-tabs" role="tablist" aria-label="Infrastructure view">{([{ id: 'graph', label: 'System graph', icon: 'graph' }, { id: 'evidence', label: 'Execution evidence', icon: 'evidence' }, { id: 'artifacts', label: 'Output artifacts', icon: 'file' }] as const).map(tab => <button key={tab.id} role="tab" aria-selected={view === tab.id} onClick={() => setView(tab.id)} className={view === tab.id ? 'view-tab active' : 'view-tab'}><Icon name={tab.icon} size={16}/>{tab.label}</button>)}</div><span className="graph-count">{state.graph?.resources.length ?? 0} resources</span></div>
        {view === 'graph' ? <><div className="canvas-context"><span><span className="tiny-square"/>Deployment dependency graph</span><small>Select a resource to inspect its evidence</small></div><ResourceCanvas key={state.graph?.digest ?? 'none'} state={state} selected={selected} onSelect={selectResource} onConnectionSelect={selectConnection}/><div className="canvas-legend">{['pending', 'deploying', 'ready', 'failed', 'skipped'].map(status => <span key={status}><i className={`legend-dot mark-${status}`}/>{status.charAt(0).toUpperCase() + status.slice(1)}</span>)}<small>Solid: deployment order · Dashed: recorded connection status</small></div></>
          : view === 'evidence' ? <EvidenceSource state={state} kind={evidenceKind} onKind={setEvidenceKind}/>
            : <ArtifactsView artifacts={state.artifacts ?? []}/>}
      </div>{resource && view === 'graph' && <Inspector state={state} resource={resource} onClose={() => setSelected(undefined)} onEvidence={() => { setEvidenceKind('deployment'); setView('evidence'); }}/>}</section>
      <RunFeed state={state} onSelect={selectResource}/><footer className="page-footer"><span>Native FootPrint recording · read-only evidence inspection</span><span>{state.mode === 'simulator' ? 'Simulation · no cloud resources are provisioned' : state.mode === 'kubernetes' ? 'Local fixture · scripted model and seeded data' : 'Host-configured providers · readiness from recorded observations'}</span></footer>
    </main></div>}
  </div>;
}
