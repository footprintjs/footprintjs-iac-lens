import {selectExecutionFollow} from '../../../src/core/execution-follow.ts';
import type {AdapterDeploymentView} from '../../../src/core/adapter-deployment.ts';
import type {RunRecord} from '../../../src/core/run-history.ts';
import type {DashboardState} from '../../../src/core/types.ts';
import type {SystemExecutionFocus} from '../system-topology/execution-focus.ts';

/** Camera context only; held components are never an execution highlight. */
export interface SystemFollowContext {focus:SystemExecutionFocus;held:boolean}
interface RememberedFocus extends SystemFollowContext {resourceIds:string[];stageIds:string[]}

const target=(state:DashboardState)=>state.onboarding?.targetId??state.application?.selection?.targetId??state.target?.id;
function sameBinding(a:DashboardState,b:DashboardState):boolean {
 return !!a.systemTopology&&!!b.systemTopology&&a.run?.id===b.run?.id&&target(a)===target(b)
  &&a.graph?.digest===b.graph?.digest&&a.systemTopology.definition.digest===b.systemTopology.definition.digest
  &&a.systemTopology.definition.binding.targetId===b.systemTopology.definition.binding.targetId
  &&a.systemTopology.definition.binding.graphDigest===b.systemTopology.definition.binding.graphDigest
  &&a.systemTopology.observations.targetId===b.systemTopology.observations.targetId
  &&a.systemTopology.observations.graphDigest===b.systemTopology.observations.graphDigest
  &&a.systemTopology.observations.definitionDigest===b.systemTopology.observations.definitionDigest
  &&a.systemTopology.observations.configurationDigest===b.systemTopology.observations.configurationDigest;
}

function derive(state:DashboardState,deployment:AdapterDeploymentView|undefined,previous?:RememberedFocus):RememberedFocus|undefined {
 if(!state.systemTopology||state.run?.status!=='running'||!deployment?.available||!deployment.runId
  ||deployment.runId!==state.run.id||!deployment.nativeRunId)return;
 const plan=selectExecutionFollow(deployment,state.systemTopology);
 const deploying=(ids:readonly string[])=>ids.length>0&&ids.every(id=>{
  const resources=state.run!.resources.filter(row=>row.id===id);
  return resources.length===1&&resources[0]!.status==='deploying';
 });
 if(plan.componentIds.length||plan.boundaryIds.length){
  if(!deploying(plan.activeResourceIds))return;
  return{focus:{componentIds:plan.componentIds,boundaryIds:plan.boundaryIds},held:false,resourceIds:plan.activeResourceIds,stageIds:plan.activeStageIds};
 }
 if(!previous||!deploying(previous.resourceIds))return;
 // An unmapped parent stage can retain its resource's camera area, but another
 // active resource cannot inherit that context. Neither case invents an actor.
 if(plan.activeResourceIds.some(id=>!previous.resourceIds.includes(id)))return;
 const visited=previous.stageIds.length>0&&previous.stageIds.every(id=>deployment.resources.some(resource=>previous.resourceIds.includes(resource.resourceId)
  &&resource.stages.some(stage=>stage.id===id&&stage.executions>0)));
 const exists=previous.focus.componentIds.every(id=>state.systemTopology!.nodes.some(node=>node.id===id))
  &&previous.focus.boundaryIds.every(id=>state.systemTopology!.boundaries.some(boundary=>boundary.id===id));
 return visited&&exists?{...previous,held:true}:undefined;
}

/** Rebuild camera context from this selected prefix, never from a later replay position. */
export function selectSystemFollowContext({record,index,state,deployment,followingLive=false}:{record?:RunRecord;index:number;state?:DashboardState;deployment?:AdapterDeploymentView;followingLive?:boolean}):SystemFollowContext|undefined {
 if(!state||!deployment)return;
 let previous:RememberedFocus|undefined;
 if(record&&record.summary.runId===state.run?.id){
  const end=Number.isFinite(index)?Math.min(record.frames.length-1,Math.max(0,Math.trunc(index))):0;
  // RunRecord admission bounds this fold to at most 128 retained publications.
  const prefix=followingLive?record.frames.filter(frame=>frame.state.revision<=state.revision):record.frames.slice(0,end+1);
  for(const frame of prefix){
   const captured=frame.deployment;
   if(!sameBinding(frame.state,state)||!captured||captured.runId!==deployment.runId||captured.nativeRunId!==deployment.nativeRunId)continue;
   previous=derive(frame.state,captured,previous);
  }
 }
 const selected=derive(state,deployment,previous);
 return selected?{focus:selected.focus,held:selected.held}:undefined;
}
