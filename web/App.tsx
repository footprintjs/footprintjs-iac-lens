import { useEffect, useState } from 'react';
import { localAppUrl } from '../src/core/model.ts';
import { useDashboard } from './lib/use-dashboard.ts';
import { Icon } from './components/Icon.tsx';
import { SimpleDashboard } from './components/SimpleDashboard.tsx';
import { DetailsWorkspace } from './components/DetailsWorkspace.tsx';
import type { View } from './lib/workspace-views.ts';
import type { EvidenceKind } from './components/EvidenceSource.tsx';
import './components/fit-window.css';

export interface IacLensProps { baseUrl?: string; fitWindow?: boolean }
/** Optional React surface; the protocol, model and transport are framework-neutral. */
export function IacLens({ baseUrl = '', fitWindow = true }: IacLensProps) {
  const { state, connected, error, posting, run, resourceFlow, dismissError } = useDashboard(baseUrl);
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
    {!state ? <div className="startup-state"><Icon name="graph" size={36}/><h1>Connecting to your system</h1><p>{error ? 'Unable to connect. Please try again.' : 'Just a moment…'}</p>{error && <button className="button button-secondary" onClick={() => location.reload()}>Reconnect</button>}</div> : displayMode === 'simple' ? <SimpleDashboard state={state} posting={posting} error={error} neoUrl={neoUrl} onRun={(scenario, reviewId) => { void run(scenario, reviewId); }} onResourceFlow={input => { void resourceFlow(input); }} onDismissError={dismissError} onDetails={() => setDisplayMode('details')}/> : <DetailsWorkspace state={state} posting={posting} error={error} neoUrl={neoUrl} fitWindow={fitWindow}
      view={view} selectedResource={selectedResource} selectedConnection={selectedConnection} evidenceKind={evidenceKind}
      setView={setView} selectResource={selectResource} selectConnection={selectConnection} setEvidenceKind={setEvidenceKind}
      selectActivity={selectActivity} run={(scenario, reviewId) => { void run(scenario, reviewId); }} resourceFlow={input => { void resourceFlow(input); }} dismissError={dismissError}/>}
  </div>;
}
