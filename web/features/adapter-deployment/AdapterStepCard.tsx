import {Handle,Position,type NodeProps} from '@xyflow/react';
import type {AdapterDeploymentStatus} from '../../../src/core/adapter-deployment.ts';
import type {AdapterCardNode} from './adapter-flow-layout.ts';
export const adapterStatusLabel:Record<AdapterDeploymentStatus,string>={pending:'Waiting',running:'Running',completed:'Done',skipped:'Skipped',failed:'Failed',unknown:'Unconfirmed'};
export function AdapterStatus({status}:{status:AdapterDeploymentStatus}) {
  return <span className={`adapter-stage-status status-${status}`}><i/>{adapterStatusLabel[status]}</span>;
}
export function AdapterStepCard({data,selected}:NodeProps<AdapterCardNode>) {
  const {stage,branches,onInspect,onScope,direction}=data;
  return <article className={`adapter-step-card status-${stage.status}${branches.length?' has-branches':''}${selected?' selected':''}`} data-native-stage-id={stage.id}>
    <Handle type="target" position={direction==='reverse'?Position.Right:Position.Left} className="deployment-port"/>
    <header><span>{stage.kind==='decision'?'Decision':stage.kind==='subflow'?'Subflow':stage.kind==='loop'?'Loop':'Recorded step'}</span><AdapterStatus status={stage.status}/></header>
    <button type="button" className="adapter-stage-name" title={stage.label} onClick={()=>onInspect(stage)}>{stage.label}</button>
    {branches.map(branch=><button type="button" key={branch.id} className={`adapter-branch status-${branch.status}`} title={`${branch.label}: ${adapterStatusLabel[branch.status]}`} aria-label={`${branch.label}: ${adapterStatusLabel[branch.status]}`} onClick={()=>branch.childScope?onScope(branch.childScope):onInspect(branch)}><span>{branch.label}</span><AdapterStatus status={branch.status}/></button>)}
    {!branches.length&&<span className="adapter-stage-note">{stage.status==='skipped'?'Another branch was selected.':stage.status==='pending'?'Waiting for native execution.':stage.executions>1?`${stage.executions} recorded executions`:'Native FootPrint evidence'}</span>}
    {stage.childScope&&<button type="button" className="adapter-open-subflow" onClick={()=>onScope(stage.childScope!)}>Open subflow →</button>}
    <Handle type="source" position={direction==='reverse'?Position.Left:Position.Right} className="deployment-port"/>
  </article>;
}
