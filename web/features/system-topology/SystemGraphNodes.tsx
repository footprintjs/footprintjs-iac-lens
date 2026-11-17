import {createContext,useContext} from 'react';
import {Handle,type NodeProps} from '@xyflow/react';
import type {SystemTopologyView} from 'footprintjs-iac/system-topology';
import type {AdapterDeploymentView} from '../../../src/core/adapter-deployment.ts';
import {resolveTopologyDeploymentStep,type RecordedDeploymentStep} from '../../../src/core/topology-deployment-step.ts';
import type {SystemGraphNode,SystemGraphPlacement} from './create-system-graph.ts';
import type {TopologySelection} from './TopologyEvidence.tsx';
import {TopologyNodeCard} from './TopologyNodeCard.tsx';
import {TopologyBoundaryBox} from './TopologyBoundaryBox.tsx';
import {currentTopologyAction} from './node-action.ts';
import {IsometricSystemFloor} from './IsometricSystemFloor.tsx';

export interface SystemGraphContextValue {
  view:SystemTopologyView;
  placement:SystemGraphPlacement;
  adapter?:AdapterDeploymentView;
  onSelect?(selection:TopologySelection):void;
  onRecordedStep?(step:RecordedDeploymentStep):void;
}
export const SystemGraphContext=createContext<SystemGraphContextValue|undefined>(undefined);
export function useSystemGraph(){const value=useContext(SystemGraphContext);if(!value)throw Error('System graph adapter is not mounted');return value;}

function Ports({data}:{data:SystemGraphNode['data']}){
  return <>{data.ports.map(port=><Handle key={`${port.type}:${port.id}`} id={port.id} type={port.type} position={port.position} isConnectable={false}
    style={{left:port.x+3,top:port.y+3,width:6,height:6,opacity:0,pointerEvents:'none'}}/>)}</>;
}
export function SystemComponentNode({data}:NodeProps<SystemGraphNode>){
  const {onSelect,onRecordedStep,adapter}=useSystemGraph(),node=data.component;
  if(!node)return null;
  const {action}=currentTopologyAction(node),step=adapter&&action?resolveTopologyDeploymentStep(adapter,action):undefined;
  return <>{data.isometric&&<IsometricSystemFloor points={data.isometric.floor} status={node.status}/>}<TopologyNodeCard node={node} box={data.box} onSelect={onSelect?()=>onSelect({kind:'node',id:node.id}):undefined} step={step} onRecordedStep={onRecordedStep}/><Ports data={data}/></>;
}
export function SystemBoundaryNode({data}:NodeProps<SystemGraphNode>){
  const {onSelect}=useSystemGraph(),boundary=data.boundary;if(!boundary)return null;
  const header=data.isometric?.header;
  return <>{data.isometric&&<IsometricSystemFloor points={data.isometric.floor} status={boundary.status} boundary progress={boundary.progress}/>}
    <TopologyBoundaryBox boundary={boundary} box={header?{...data.box,...header,height:36}:data.box} onSelect={onSelect?()=>onSelect({kind:'boundary',id:boundary.id}):undefined}/><Ports data={data}/></>;
}
