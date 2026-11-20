import {createContext,useContext} from 'react';
import {Handle,type NodeProps} from '@xyflow/react';
import type {SystemTopologyView} from 'footprintjs-iac/system-topology';
import type {AdapterDeploymentView} from '../../../src/core/adapter-deployment.ts';
import {resolveTopologyDeploymentStep,type RecordedDeploymentStep} from '../../../src/core/topology-deployment-step.ts';
import type {SystemGraphNode,SystemGraphPlacement} from './create-system-graph.ts';
import type {TopologySelection} from './TopologyEvidence.tsx';
import {TopologyNodeCard} from './TopologyNodeCard.tsx';
import {TopologyObjectNode,TopologyObjectBoundary} from './TopologyObjectNode.tsx';
import {TopologyBoundaryBox} from './TopologyBoundaryBox.tsx';
import {currentTopologyAction} from './node-action.ts';
import {IsometricSystemFloor} from './IsometricSystemFloor.tsx';
import type {SystemExecutionFocus} from './execution-focus.ts';
import type {DiagramSymbolDefinition} from '../../../src/core/system-symbols.ts';
import {objectActivity} from './object-activity.ts';

export interface SystemGraphContextValue {
  view:SystemTopologyView;
  placement:SystemGraphPlacement;
  adapter?:AdapterDeploymentView;
  onSelect?(selection:TopologySelection):void;
  onRecordedStep?(step:RecordedDeploymentStep):void;
  executionFocus?:SystemExecutionFocus;
  symbols?:ReadonlyMap<string,DiagramSymbolDefinition>;
}
export const SystemGraphContext=createContext<SystemGraphContextValue|undefined>(undefined);
export function useSystemGraph(){const value=useContext(SystemGraphContext);if(!value)throw Error('System graph adapter is not mounted');return value;}

function Ports({data}:{data:SystemGraphNode['data']}){
  return <>{data.ports.map(port=><Handle key={`${port.type}:${port.id}`} id={port.id} type={port.type} position={port.position} isConnectable={false}
    style={{left:port.x+3,top:port.y+3,width:6,height:6,opacity:0,pointerEvents:'none'}}/>)}</>;
}
export function SystemComponentNode({data}:NodeProps<SystemGraphNode>){
  const {view,onSelect,onRecordedStep,adapter,executionFocus,symbols}=useSystemGraph(),node=data.component;
  if(!node)return null;
  const {action}=currentTopologyAction(node),step=adapter&&action?resolveTopologyDeploymentStep(adapter,action):undefined;
  const symbol=symbols?.get(`component:${node.id}`),object=!!data.isometric&&symbol?.presentation==='object';
  const props={node,box:data.box,onSelect:onSelect?()=>onSelect({kind:'node' as const,id:node.id}):undefined,step,onRecordedStep,executionFocus:executionFocus?.componentIds.includes(node.id)};
  return <>{data.isometric&&!object&&<IsometricSystemFloor points={data.isometric.floor} status={node.status}/>}
    {object?<TopologyObjectNode {...props} symbol={symbol} activity={objectActivity(node,view.observations.resources)}/>:<TopologyNodeCard {...props} symbol={symbol}/>}<Ports data={data}/></>;
}
export function SystemBoundaryNode({data}:NodeProps<SystemGraphNode>){
  const {onSelect,executionFocus,symbols}=useSystemGraph(),boundary=data.boundary;if(!boundary)return null;
  const header=data.isometric?.header,symbol=symbols?.get(`boundary:${boundary.id}`);
  const box=header?{...data.box,...header,height:header.height??36}:data.box;
  const props={boundary,box,onSelect:onSelect?()=>onSelect({kind:'boundary' as const,id:boundary.id}):undefined,executionFocus:executionFocus?.boundaryIds.includes(boundary.id)};
  return <>{data.isometric&&<IsometricSystemFloor points={data.isometric.floor} status={boundary.status} boundary progress={boundary.progress}/>}
    {data.isometric&&symbol?.presentation==='object'?<TopologyObjectBoundary {...props} symbol={symbol}/>:<TopologyBoundaryBox {...props} symbol={symbol}/>}<Ports data={data}/></>;
}
