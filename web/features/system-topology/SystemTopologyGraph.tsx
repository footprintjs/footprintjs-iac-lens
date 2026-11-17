import { useMemo, useState } from 'react';
import {Controls} from '@xyflow/react';
import {TracedFlow,FootprintTheme,type FlowchartRenderer} from 'footprint-explainable-ui/flowchart';
import type { DashboardState } from '../../../src/core/types.ts';
import { projectAdapterDeployment } from '../../../src/core/adapter-deployment.ts';
import type { RecordedDeploymentStep } from '../../../src/core/topology-deployment-step.ts';
import type { SystemTopologyView } from 'footprintjs-iac/system-topology';
import {useLensTheme} from '../../theme/LensThemeContext.tsx';
import {createSystemGraph,createSystemGraphPlacement,systemGraphBounds} from './create-system-graph.ts';
import {useDiagramCamera} from '../../lib/diagram-camera.ts';
import {createIsometricSystemGraph,createIsometricSystemPlacement} from './create-isometric-system-graph.ts';
import {SystemGraphContext,SystemBoundaryNode,SystemComponentNode} from './SystemGraphNodes.tsx';
import {SystemGraphConnection} from './SystemGraphConnection.tsx';
import { TopologyUnplacedConnections } from './TopologyConnections.tsx';
import { TopologyEvidence, type TopologySelection } from './TopologyEvidence.tsx';
import styles from './system-topology.css' with { type: 'text' };
import isometricStyles from './isometric-system.css' with {type:'text'};

const nodeTypes={'system-boundary':SystemBoundaryNode,'system-component':SystemComponentNode};
const edgeTypes={'system-connection':SystemGraphConnection};

/** Both views consume the same admitted native projection. Layout does not interpret outcomes. */
export default function SystemTopologyGraph({ view, simple = false, state, onRecordedStep, inspectable = true, renderer = 'flat' }: { view: SystemTopologyView; simple?: boolean; state?:DashboardState; inspectable?:boolean; renderer?:FlowchartRenderer; onRecordedStep?(step:RecordedDeploymentStep):void }) {
  const [selected, setSelected] = useState<TopologySelection>();
  const theme=useLensTheme();
  const adapter=useMemo(()=>state?projectAdapterDeployment(state):undefined,[state]);
  const isometric=renderer==='isometric';
  const placement=useMemo(()=>isometric?createIsometricSystemPlacement(view):createSystemGraphPlacement(view),[view.definition.digest,isometric]);
  const graph=useMemo(()=>isometric?createIsometricSystemGraph(view,placement as ReturnType<typeof createIsometricSystemPlacement>):createSystemGraph(view,placement),[view,placement,isometric]);
  const bounds=useMemo(()=>systemGraphBounds(placement),[placement]);
  const camera=useDiagramCamera(bounds);
  const context=useMemo(()=>({view,placement,adapter,onSelect:inspectable?setSelected:undefined,onRecordedStep:inspectable?onRecordedStep:undefined}),[view,placement,adapter,inspectable,onRecordedStep]);
  return <section className={`system-topology${simple ? ' topology-simple' : ''}${isometric?' topology-isometric':''}`} data-system-renderer="explainable-ui" data-system-perspective={renderer} aria-label={simple ? 'Your system' : 'System design'}>
    <style>{styles}</style>
    {isometric&&<style>{isometricStyles}</style>}
    <header className="topology-heading"><div><h2>{simple ? 'Your system' : view.definition.label}</h2>
      <p>{simple ? 'What runs where, and what is connected.' : 'Declared placement · arrows show communication, not deployment order.'}</p>
    </div><span className="topology-native">FootPrint evidence</span></header>
    <div ref={camera.containerRef} className="topology-viewport" role="region" aria-label="Installed components, host boundaries and live connections" tabIndex={0}>
      <SystemGraphContext.Provider value={context}><FootprintTheme tokens={theme.tokens}>
        {/* The controlled EUI camera fits authored cards and wires. No execution overlay is supplied. */}
        <TracedFlow graph={graph} layout="passthrough" renderer={renderer} nodeTypes={nodeTypes} edgeTypes={edgeTypes} unstyled background={false}
          currentSubflowId={null} breadcrumb={false} autoFit={false} viewport={camera.viewport} onViewportChange={camera.onViewportChange} minZoom={.01} maxZoom={1}
          className="topology-eui-canvas" style={{minHeight:0}}>
          {!simple&&<Controls showInteractive={false} position="bottom-left"/>}
        </TracedFlow>
      </FootprintTheme></SystemGraphContext.Provider>
    </div>
    <footer className="topology-legend"><span><i className="topology-pending"/>Waiting</span><span><i className="topology-installing"/>Building</span><span><i className="topology-ready"/>Ready</span><span><i className="topology-failed"/>Failed</span>
      <small>Line colours identify connections · badges show status.</small>
      <TopologyUnplacedConnections connections={view.connections} boxes={placement.boxes} routes={placement.routes} onSelect={id=>setSelected({kind:'connection',id})}/>
      {view.limitations.length > 0 && <details><summary>Unconfirmed details ({view.limitations.length})</summary>{view.limitations.map((text, index) => <p key={index}>{text}</p>)}</details>}
    </footer>
    {inspectable&&selected && <TopologyEvidence view={view} selection={selected} onClose={() => setSelected(undefined)} adapter={adapter} onRecordedStep={onRecordedStep}/>}
  </section>;
}
