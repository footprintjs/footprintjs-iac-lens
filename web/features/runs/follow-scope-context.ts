import type {AdapterDeploymentResource,AdapterDeploymentView} from '../../../src/core/adapter-deployment.ts';
import {selectExecutionFollow,type ExecutionFollowPlan} from '../../../src/core/execution-follow.ts';
import type {RunRecord} from '../../../src/core/run-history.ts';
import type {DashboardState} from '../../../src/core/types.ts';

/** Camera context only. A held scope never means a stage or component is still running. */
export interface FollowScopeContext {runId:string;resourceId:string;scopeId:string|null;held:boolean}

function scopePath(resource:AdapterDeploymentResource,id:string):string[]|undefined {
 const scopes=new Map(resource.scopes.map(scope=>[scope.id,scope])),path:string[]=[],seen=new Set<string>();
 while(!seen.has(id)){
  seen.add(id);const scope=scopes.get(id);if(!scope)return;
  path.push(id);if(id===resource.rootScope)return path;
  if(!scope.parentScope||!resource.stages.some(stage=>stage.id===scope.mountStageId&&stage.scope===scope.parentScope&&stage.childScope===id))return;
  id=scope.parentScope;
 }
}

/** Derive one camera transition from admitted current facts; execution flags remain outside this value. */
export function deriveFollowScopeContext(state:DashboardState,deployment:AdapterDeploymentView|undefined,plan:ExecutionFollowPlan,previous?:FollowScopeContext):FollowScopeContext|undefined {
 if(!deployment?.available||!deployment.runId||deployment.runId!==state.run?.id||!plan.resourceId)return;
 const resources=deployment.resources.filter(resource=>resource.resourceId===plan.resourceId);
 if(resources.length!==1)return;
 const resource=resources[0]!,requested=plan.scopeId??null;
 const direct:FollowScopeContext={runId:deployment.runId,resourceId:resource.resourceId,
  scopeId:requested&&scopePath(resource,requested)?requested:null,held:false};
 // A genuinely active parent/sibling scope overrides a previous child immediately.
 if(plan.activeStageIds.length)return direct;
 const owned=state.run.resources.filter(row=>row.id===resource.resourceId);
 if(state.run.status!=='running'||owned.length!==1||owned[0]!.status!=='deploying'
  ||previous?.runId!==deployment.runId||previous.resourceId!==resource.resourceId||!previous.scopeId
  ||!scopePath(resource,previous.scopeId))return direct;
 const visited=resource.stages.some(stage=>stage.resourceId===resource.resourceId&&stage.executions>0
  &&scopePath(resource,stage.scope)?.includes(previous.scopeId!));
 // In particular, rewinding to Start cannot carry a later scope into an unvisited publication.
 return visited?{...previous,held:true}:direct;
}

const target=(state:DashboardState)=>state.onboarding?.targetId??state.application?.selection?.targetId??state.target?.id;
function sameBinding(a:DashboardState,b:DashboardState):boolean {
 return a.run?.id===b.run?.id&&target(a)===target(b)&&a.graph?.digest===b.graph?.digest
  &&a.systemTopology?.definition.digest===b.systemTopology?.definition.digest
  &&a.systemTopology?.observations.configurationDigest===b.systemTopology?.observations.configurationDigest;
}

/** Reconstruct navigation only from the selected record prefix; no later frame can lend its scope. */
export function selectFollowScopeContext({record,index,state,deployment,followingLive=false}:{record?:RunRecord;index:number;state?:DashboardState;deployment?:AdapterDeploymentView;followingLive?:boolean}):FollowScopeContext|undefined {
 if(!state||!deployment)return;
 let context:FollowScopeContext|undefined;
 if(record&&record.summary.runId===state.run?.id){
  const end=Number.isFinite(index)?Math.min(record.frames.length-1,Math.max(0,Math.trunc(index))):0;
  // RunRecord admission bounds this list to 128 saved publications.
  const prefix=followingLive?record.frames.filter(frame=>frame.state.revision<=state.revision):record.frames.slice(0,end+1);
  for(const frame of prefix){
   if(!sameBinding(frame.state,state)||frame.deployment?.runId!==deployment.runId)continue;
   context=deriveFollowScopeContext(frame.state,frame.deployment,selectExecutionFollow(frame.deployment),context);
  }
 }
 return deriveFollowScopeContext(state,deployment,selectExecutionFollow(deployment),context);
}
