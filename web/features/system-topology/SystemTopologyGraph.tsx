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
import type {SystemExecutionFocus,SystemCameraFollow} from './execution-focus.ts';
import {selectSystemCameraFocus} from './system-camera-focus.ts';
import {SystemChartFocus} from './SystemChartFocus.tsx';
import {useSystemSymbolAdapter} from './symbol-context.tsx';
import type {DiagramSymbolDefinition} from '../../../src/core/system-symbols.ts';
import {symbolGeometryProfile,objectGeometryProfile} from './topology-layout.ts';
import styles from './system-topology.css' with { type: 'text' };
import isometricStyles from './isometric-system.css' with {type:'text'};
import symbolStyles from './symbols.css' with {type:'text'};
import objectStyles from './objects.css' with {type:'text'};

const nodeTypes={'system-boundary':SystemBoundaryNode,'system-component':SystemComponentNode};
const edgeTypes={'system-connection':SystemGraphConnection};

/** Both views consume the same admitted native projection. Layout does not interpret outcomes. */
export default function SystemTopologyGraph({ view, simple = false, state, onRecordedStep, inspectable = true, renderer = 'flat', executionFocus, cameraFollow }: { view: SystemTopologyView; simple?: boolean; state?:DashboardState; inspectable?:boolean; renderer?:FlowchartRenderer; executionFocus?:SystemExecutionFocus; cameraFollow?:SystemCameraFollow; onRecordedStep?(step:RecordedDeploymentStep):void }) {
  const [selected, setSelected] = useState<TopologySelection>();
  const theme=useLensTheme();
  const symbolAdapter=useSystemSymbolAdapter();
  const symbols=useMemo(()=>{
    const mapped=new Map<string,DiagramSymbolDefinition>();
    for(const node of view.nodes){const symbol=symbolAdapter?.resolve(view,{kind:'component',id:node.id});if(symbol)mapped.set(`component:${node.id}`,symbol);}
    for(const boundary of view.boundaries){const symbol=symbolAdapter?.resolve(view,{kind:'boundary',id:boundary.id});if(symbol)mapped.set(`boundary:${boundary.id}`,symbol);}
    return mapped;
  },[view,symbolAdapter]);
  const hasSymbols=symbols.size>0;
  const adapter=useMemo(()=>state?projectAdapterDeployment(state):undefined,[state]);
  const isometric=renderer==='isometric',hasObjects=isometric&&[...symbols.values()].some(symbol=>symbol.presentation==='object');
  const profile=hasObjects?objectGeometryProfile:hasSymbols?symbolGeometryProfile:undefined;
  // Replay updates status frequently. Rebuild routes only when the authored geometry changes.
  const portGeometryKey=hasObjects?JSON.stringify([...symbols].flatMap(([key,symbol])=>
    key.startsWith('component:')&&symbol.ports?[[key,symbol.viewBox,symbol.ports]]:[])):'';
  const placement=useMemo(()=>isometric?createIsometricSystemPlacement(view,profile,symbols):createSystemGraphPlacement(view,profile),[view.definition.digest,isometric,profile,portGeometryKey]);
  const graph=useMemo(()=>isometric?createIsometricSystemGraph(view,placement as ReturnType<typeof createIsometricSystemPlacement>):createSystemGraph(view,placement),[view,placement,isometric]);
  const bounds=useMemo(()=>systemGraphBounds(placement),[placement]);
  const camera=useDiagramCamera(bounds,{autoFit:cameraFollow===undefined});
  const cameraFocus=useMemo(()=>selectSystemCameraFocus(view,placement,cameraFollow?.focus),[view,placement,cameraFollow?.focus]);
  const context=useMemo(()=>({view,placement,adapter,onSelect:inspectable?setSelected:undefined,onRecordedStep:inspectable?onRecordedStep:undefined,executionFocus,symbols}),[view,placement,adapter,inspectable,onRecordedStep,executionFocus,symbols]);
  return <section className={`system-topology${simple ? ' topology-simple' : ''}${isometric?' topology-isometric':''}`} data-system-renderer="explainable-ui" data-system-perspective={renderer} data-system-camera-area={cameraFocus?.key??'overview'} data-system-camera-follow={cameraFollow?.enabled} data-system-camera-held={cameraFollow?.held||undefined} aria-label={simple ? 'Your system' : 'System design'}>
    <style>{styles}</style>
    {isometric&&<style>{isometricStyles}</style>}
    {hasSymbols&&<style>{symbolStyles}</style>}
    {hasObjects&&<style>{objectStyles}</style>}
    <header className="topology-heading"><div><h2>{simple ? 'Your system' : view.definition.label}</h2>
      <p>{simple ? 'What runs where, and what is connected.' : 'Declared placement · arrows show communication, not deployment order.'}</p>
    </div><span className="topology-native">FootPrint evidence</span></header>
    <div ref={camera.containerRef} className="topology-viewport" role="region" aria-label="Installed components, host boundaries and live connections" tabIndex={0}>
      <SystemGraphContext.Provider value={context}><FootprintTheme tokens={theme.tokens}>
        {/* The controlled EUI camera fits authored cards and wires. No execution overlay is supplied. */}
        <TracedFlow graph={graph} layout="passthrough" renderer={renderer} nodeTypes={nodeTypes} edgeTypes={edgeTypes} unstyled background={false}
          currentSubflowId={null} breadcrumb={false} autoFit={false} viewport={camera.viewport} onViewportChange={camera.onViewportChange} minZoom={.01} maxZoom={1}
          className="topology-eui-canvas" style={{minHeight:0}}>
          {cameraFollow&&<SystemChartFocus bounds={bounds} size={camera.size} focus={cameraFocus} enabled={cameraFollow.enabled} runKey={cameraFollow.runKey}/>}
          {!simple&&<Controls showInteractive={false} position="bottom-left"/>}
        </TracedFlow>
      </FootprintTheme></SystemGraphContext.Provider>
    </div>
    <TopologyUnplacedConnections connections={view.connections} boxes={placement.boxes} routes={placement.routes} onSelect={id=>setSelected({kind:'connection',id})}/>
    <footer className="topology-legend"><span><i className="topology-pending"/>Waiting</span><span><i className="topology-installing"/>Building</span><span><i className="topology-ready"/>Ready</span><span><i className="topology-failed"/>Failed</span>
      <small>Line colours identify connections · badges show status.</small>
      {view.limitations.length > 0 && <details><summary>Unconfirmed details ({view.limitations.length})</summary>{view.limitations.map((text, index) => <p key={index}>{text}</p>)}</details>}
    </footer>
    {inspectable&&selected && <TopologyEvidence connectionRun={state?.connections} view={view} selection={selected} onClose={() => setSelected(undefined)} adapter={adapter} onRecordedStep={onRecordedStep}/>}
  </section>;
}
