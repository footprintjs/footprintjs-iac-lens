import type {SystemTopologyView,TopologyActionObservation} from 'footprintjs-iac/system-topology';
import type {AdapterDeploymentResource,AdapterDeploymentStage,AdapterDeploymentView} from './adapter-deployment.ts';
import {resolveTopologyDeploymentStep} from './topology-deployment-step.ts';

export interface ExecutionFollowPlan {
 resourceId?:string;
 /** null selects the chosen resource's root; other values are exact declared child scopes. */
 scopeId?:string|null;
 /** Visible nodes to fit together. A descendant in another active branch is represented by its mount. */
 stageIds:string[];
 /** Actual running frontier across all active resources, without running mount ancestors. */
 activeStageIds:string[];
 activeResourceIds:string[];
 componentIds:string[];
 boundaryIds:string[];
}

const ordered=(ids:Iterable<string>)=>[...new Set(ids)].sort();

function ancestors(resource:AdapterDeploymentResource,scope:string):string[] {
 const scopes=new Map(resource.scopes.map(value=>[value.id,value])),path:string[]=[],seen=new Set<string>();
 while(!seen.has(scope)){
  seen.add(scope);const current=scopes.get(scope);if(!current)return[];
  path.push(scope);
  if(scope===resource.rootScope)return path;
  if(!current.parentScope)return[];
  scope=current.parentScope;
 }
 return[];
}

function frontier(resource:AdapterDeploymentResource):AdapterDeploymentStage[] {
 const running=resource.stages.filter(stage=>stage.status==='running');
 return running.filter(stage=>!stage.childScope||!running.some(other=>other.id!==stage.id&&ancestors(resource,other.scope).includes(stage.childScope!)));
}

function visibleStage(resource:AdapterDeploymentResource,stage:AdapterDeploymentStage,scope:string):string|undefined {
 if(stage.scope===scope)return stage.id;
 const path=ancestors(resource,stage.scope),index=path.indexOf(scope);
 if(index<1)return;
 const child=resource.scopes.find(value=>value.id===path[index-1]);
 return resource.stages.find(value=>value.id===child?.mountStageId&&value.scope===scope&&value.childScope===child.id)?.id;
}

/** Select a camera target from one admitted publication; never derives execution or readiness from colors. */
export function selectExecutionFollow(deployment?:AdapterDeploymentView,topology?:SystemTopologyView,preferredResourceId?:string):ExecutionFollowPlan {
 const empty:ExecutionFollowPlan={stageIds:[],activeStageIds:[],activeResourceIds:[],componentIds:[],boundaryIds:[]};
 if(!deployment?.available||!deployment.resources.length)return empty;
 const frontiers=new Map(deployment.resources.map(resource=>[resource.resourceId,frontier(resource)]));
 const activeResourceIds=ordered(deployment.resources.filter(resource=>frontiers.get(resource.resourceId)!.length).map(resource=>resource.resourceId));
 // One pane renders one resource. Keep a requested active resource, otherwise use stable ID order.
 const candidates=activeResourceIds.length?activeResourceIds:ordered(deployment.resources.map(resource=>resource.resourceId));
 const resourceId=preferredResourceId&&candidates.includes(preferredResourceId)?preferredResourceId:candidates[0];
 const resource=deployment.resources.find(value=>value.resourceId===resourceId)!;
 const active=frontiers.get(resource.resourceId)!;
 const paths=active.map(stage=>ancestors(resource,stage.scope));
 const scope=paths.length&&paths.every(path=>path.length)?paths[0]!.find(id=>paths.every(path=>path.includes(id)))??resource.rootScope:resource.rootScope;
 const activeStageIds=ordered([...frontiers.values()].flat().map(stage=>stage.id));
 const plan:ExecutionFollowPlan={...empty,resourceId,scopeId:scope===resource.rootScope?null:scope,
  stageIds:ordered(active.flatMap(stage=>visibleStage(resource,stage,scope)??[])),activeStageIds,activeResourceIds};
 if(!topology||!activeStageIds.length)return plan;
 const activeIds=new Set(activeStageIds),components=new Set<string>(),boundaries=new Set<string>();
 const matches=(action:TopologyActionObservation)=>{
  if(action.status!=='running')return false;
  const step=resolveTopologyDeploymentStep(deployment,action);
  return !!step&&activeIds.has(step.stageId);
 };
 for(const node of topology.nodes){
  const match=node.actions?.some(action=>matches(action)&&node.bindings.resourceIds.includes(action.resourceId)
   &&(action.componentId?(node.bindings.componentIds??[]).includes(action.componentId):action.scope==='shared-resource'&&!!node.bindings.componentIds?.length));
  if(!match)continue;
  // Shared actions attached by the base remain shared work; this is focus, not a new component measurement.
  components.add(node.id);
  let boundaryId=node.boundaryId;const seen=new Set<string>();
  while(boundaryId&&!seen.has(boundaryId)){
   seen.add(boundaryId);const boundary=topology.boundaries.find(value=>value.id===boundaryId);if(!boundary)break;
   boundaries.add(boundary.id);boundaryId=boundary.parentId;
  }
 }
 for(const action of topology.observations.actions??[]){
  if(action.componentId||!matches(action))continue;
  for(const boundary of topology.boundaries)if(boundary.bindings?.resourceIds.includes(action.resourceId))boundaries.add(boundary.id);
 }
 return{...plan,componentIds:ordered(components),boundaryIds:ordered(boundaries)};
}
