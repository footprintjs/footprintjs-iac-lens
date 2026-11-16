import { useId, useMemo, useState } from 'react';
import type { DashboardState } from '../../../src/core/types.ts';
import { projectAdapterDeployment } from '../../../src/core/adapter-deployment.ts';
import { resolveTopologyDeploymentStep, type RecordedDeploymentStep } from '../../../src/core/topology-deployment-step.ts';
import type { SystemTopologyView } from 'footprintjs-iac/system-topology';
import {useTopologyFit} from './use-topology-fit.ts';
import { layoutSystemTopology } from './topology-layout.ts';
import {routeTopologyConnections} from './topology-routes.ts';
import {currentTopologyAction} from './node-action.ts';
import { TopologyNodeCard } from './TopologyNodeCard.tsx';
import { TopologyBoundaryBox } from './TopologyBoundaryBox.tsx';
import { TopologyWires, TopologyConnectionLabels, TopologyUnplacedConnections } from './TopologyConnections.tsx';
import { TopologyEvidence, type TopologySelection } from './TopologyEvidence.tsx';
import styles from './system-topology.css' with { type: 'text' };

/** Both views consume the same admitted native projection. Layout does not interpret outcomes. */
export default function SystemTopologyGraph({ view, simple = false, state, onRecordedStep }: { view: SystemTopologyView; simple?: boolean; state?:DashboardState; onRecordedStep?(step:RecordedDeploymentStep):void }) {
  const [selected, setSelected] = useState<TopologySelection>();
  const adapter=useMemo(()=>state?projectAdapterDeployment(state):undefined,[state]);
  const marker = `topology-arrow-${useId().replace(/:/g, '')}`;
  const {geometry,boxes,routes}=useMemo(()=>{
    const geometry=layoutSystemTopology(view),boxes=new Map(geometry.boxes.map(box=>[box.id,box]));
    const routes=routeTopologyConnections(view.definition.connections,boxes);
    return{geometry,boxes,routes};
  },[view.definition.digest]);
  const fit=useTopologyFit(geometry);
  const boundaries = [...view.boundaries].sort((a, b) => boxes.get(a.id)!.depth - boxes.get(b.id)!.depth);
  return <section className={`system-topology${simple ? ' topology-simple' : ''}`} aria-label={simple ? 'Your system' : 'System design'}>
    <style>{styles}</style>
    <header className="topology-heading"><div><h2>{simple ? 'Your system' : view.definition.label}</h2>
      <p>{simple ? 'What runs where, and what is connected.' : 'Declared placement · arrows show communication, not deployment order.'}</p>
    </div><span className="topology-native">FootPrint evidence</span></header>
    <div ref={fit.viewportRef} className="topology-viewport" role="region" aria-label="Installed components, host boundaries and live connections" tabIndex={0}>
      <div className="topology-center"><div className="topology-fit" style={{width:fit.width,height:fit.height}}><div className="topology-stage" style={{ width: geometry.width, height: geometry.height,transform:`scale(${fit.scale})` }}>
        {boundaries.map(boundary => <TopologyBoundaryBox key={boundary.id} boundary={boundary} box={boxes.get(boundary.id)!} onSelect={() => setSelected({ kind: 'boundary', id: boundary.id })}/>)}
        <TopologyWires connections={view.connections} boxes={boxes} width={geometry.width} height={geometry.height} marker={marker} routes={routes}/>
        {view.nodes.map(node => {const {action:primary}=currentTopologyAction(node);return <TopologyNodeCard key={node.id} node={node} box={boxes.get(node.id)!} onSelect={() => setSelected({ kind: 'node', id: node.id })} step={adapter&&primary?resolveTopologyDeploymentStep(adapter,primary):undefined} onRecordedStep={onRecordedStep}/>;})}
        <TopologyConnectionLabels connections={view.connections} boxes={boxes} routes={routes} onSelect={id => setSelected({ kind: 'connection', id })}/>
      </div></div></div>
    </div>
    <footer className="topology-legend"><span><i className="topology-pending"/>Waiting</span><span><i className="topology-installing"/>Building</span><span><i className="topology-ready"/>Ready</span><span><i className="topology-failed"/>Failed</span>
      <small>Line colours identify connections · badges show status.</small>
      <TopologyUnplacedConnections connections={view.connections} boxes={boxes} routes={routes} onSelect={id=>setSelected({kind:'connection',id})}/>
      {view.limitations.length > 0 && <details><summary>Unconfirmed details ({view.limitations.length})</summary>{view.limitations.map((text, index) => <p key={index}>{text}</p>)}</details>}
    </footer>
    {selected && <TopologyEvidence view={view} selection={selected} onClose={() => setSelected(undefined)} adapter={adapter} onRecordedStep={onRecordedStep}/>}
  </section>;
}
