import { SystemTopologySlot } from '../features/system-topology/SystemTopologySlot.tsx';
import { useState } from 'react';
import type { DashboardState } from '../../src/core/types.ts';
import { ResourceCanvas } from './ResourceCanvas.tsx';
import { SystemBlocks } from './SystemBlocks.tsx';
import { DetailsPanel } from './DetailsPanel.tsx';

export function RunningSystem({ state, selected, fitWindow = false, onSelect, onConnectionSelect }: {
  state: DashboardState;
  selected?: string;
  fitWindow?: boolean;
  onSelect(id?: string): void;
  onConnectionSelect(id: string): void;
}) {
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  if (state.systemTopology) return <SystemTopologySlot view={state.systemTopology}/>;
  return <section className="running-system" aria-label="Running system">
    <div className="running-system-heading">
      <h2>Resources and communication</h2>
      <p>Resource colours follow recorded deployment outcomes. Connection labels show their latest recorded checks.</p>
    </div>
    <ResourceCanvas key={state.graph?.digest ?? 'none'} state={state} selected={selected}
      mode="running-system" fitWindow={fitWindow} onSelect={onSelect} onConnectionSelect={onConnectionSelect}/>
    <div className="canvas-legend">
      {['pending', 'deploying', 'ready', 'failed', 'skipped'].map(status => <span key={status}>
        <i className={`legend-dot mark-${status}`}/>{status.charAt(0).toUpperCase() + status.slice(1)}
      </span>)}
      <small>Arrows: communication · Resources: last deployment · Edges: last check</small>
    </div>
    {fitWindow ? <div className="capability-inventory"><button className="button button-secondary" onClick={() => setCapabilitiesOpen(true)}>Capabilities and placement</button></div>
      : <details className="capability-inventory"><summary>Capabilities and placement</summary>
      <SystemBlocks state={state} onSelect={onSelect}/>
    </details>}
    {fitWindow && capabilitiesOpen && <DetailsPanel title="Capabilities and placement" onClose={() => setCapabilitiesOpen(false)}>
      <SystemBlocks state={state} onSelect={id => { setCapabilitiesOpen(false); onSelect(id); }}/>
    </DetailsPanel>}
  </section>;
}
