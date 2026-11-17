import type {AdapterDeploymentView} from './adapter-deployment.ts';
import type {DashboardState} from './types.ts';

/** A per-moment projection is small enough to retain beside 128 physical snapshots. */
export const RUN_FRAME_DEPLOYMENT_MAX_BYTES=128*1024;
const fail=():never=>{throw Error('Invalid recorded deployment moment');};
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=2048&&!/[\x00-\x1f\x7f]/.test(value);
const count=(value:unknown)=>Number.isSafeInteger(value)&&(value as number)>=0;
function row(input:unknown,keys:readonly string[]):Record<string,any>{
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!keys.includes(key)))fail();return input as Record<string,any>;
}
function list(input:unknown,max:number):any[]{if(!Array.isArray(input)||input.length>max)fail();return input as any[];}
function unique(values:readonly string[]){if(new Set(values).size!==values.length)fail();}

/** Input has already passed the archive's plain-JSON copier; this binds domain/scoped references. */
export function readRunFrameDeployment(input:unknown,state:DashboardState):AdapterDeploymentView {
 if(new TextEncoder().encode(JSON.stringify(input)).byteLength>RUN_FRAME_DEPLOYMENT_MAX_BYTES)fail();
 const view=row(input,['available','runId','nativeRunId','resources','warnings']);
 if(typeof view.available!=='boolean')fail();
 if(view.runId!==undefined&&(!text(view.runId)||view.runId!==state.run?.id))fail();
 if(view.nativeRunId!==undefined&&!text(view.nativeRunId))fail();
 if(list(view.warnings,32).some(value=>!text(value)))fail();
 const resources=list(view.resources,4096),desired=new Set(state.graph?.resources.map(resource=>resource.id)??[]);
 if(view.available!==!!resources.length||view.available&&(!state.run||view.runId!==state.run.id||!state.graph))fail();
 unique(resources.map(resource=>resource.resourceId));
 let total=0;
 for(const input of resources){
  const resource=row(input,['resourceId','label','action','rootScope','adapterScope','stages','edges','scopes']);
  if(!text(resource.resourceId)||!desired.has(resource.resourceId)||!text(resource.label)||!text(resource.action)||!text(resource.rootScope))fail();
  const scopes=list(resource.scopes,4096),stages=list(resource.stages,12000),edges=list(resource.edges,24000);
  if(!scopes.length||!stages.length||(total+=scopes.length+stages.length+edges.length)>30000)fail();
  unique(scopes.map(scope=>scope.id));unique(stages.map(stage=>stage.id));unique(edges.map(edge=>edge.id));
  const scopeIds=new Set(scopes.map(scope=>scope.id)),stageIds=new Set(stages.map(stage=>stage.id));
  if(!scopeIds.has(resource.rootScope)||resource.adapterScope!==undefined&&!scopeIds.has(resource.adapterScope))fail();
  for(const input of scopes){
   const scope=row(input,['id','label','parentScope','mountStageId']);
   if(!text(scope.id)||!text(scope.label))fail();
   if(scope.id===resource.rootScope){if(scope.parentScope!==undefined||scope.mountStageId!==undefined)fail();}
   else if(!text(scope.parentScope)||!scopeIds.has(scope.parentScope)||scope.mountStageId!==scope.id||!stageIds.has(scope.mountStageId)||!scope.id.startsWith(scope.parentScope+'/'))fail();
  }
  for(const input of stages){
   const stage=row(input,['id','stageId','label','kind','nativeKind','scope','resourceId','status','runtimeStageIds','executions','column','row','childScope','reason']);
   if(!text(stage.id)||!text(stage.stageId)||!text(stage.label)||!text(stage.scope)||!scopeIds.has(stage.scope)||stage.id!==stage.scope+'/'+stage.stageId||stage.resourceId!==resource.resourceId)fail();
   if(!['stage','decision','subflow','loop'].includes(stage.kind)||!['pending','running','completed','skipped','failed','unknown'].includes(stage.status))fail();
   if(stage.nativeKind!==undefined&&!text(stage.nativeKind))fail();
   const runtime=list(stage.runtimeStageIds,12000);if(runtime.some(value=>!text(value)||!value.startsWith(stage.id+'#')))fail();unique(runtime);
   if(!count(stage.executions)||stage.executions>runtime.length||!count(stage.column)||!count(stage.row)||stage.column>12000||stage.row>12000)fail();
   if(['running','completed','failed'].includes(stage.status)&&(!stage.executions||!runtime.length))fail();
   if(stage.childScope!==undefined&&(stage.kind!=='subflow'||stage.childScope!==stage.id||!scopeIds.has(stage.childScope)))fail();
   if(stage.reason!==undefined&&!text(stage.reason))fail();
  }
  for(const input of edges){
   const edge=row(input,['id','source','target','kind','label','selected']);
   if(!text(edge.id)||!stageIds.has(edge.source)||!stageIds.has(edge.target)||!['next','branch','loop'].includes(edge.kind))fail();
   if(edge.label!==undefined&&!text(edge.label)||edge.selected!==undefined&&(edge.kind!=='branch'||typeof edge.selected!=='boolean'))fail();
  }
 }
 return view as unknown as AdapterDeploymentView;
}
