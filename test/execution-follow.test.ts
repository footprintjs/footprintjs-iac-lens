import assert from 'node:assert/strict';
import test from 'node:test';
import type {SystemTopologyView,TopologyNodeView,TopologyNodeAction} from 'footprintjs-iac/system-topology';
import type {AdapterDeploymentResource,AdapterDeploymentStage,AdapterDeploymentStatus,AdapterDeploymentView} from '../src/core/adapter-deployment.ts';
import {selectExecutionFollow} from '../src/core/execution-follow.ts';

const root='execute-services',child=root+'/provider',nested=child+'/host';
function stage(id:string,scope=root,status:AdapterDeploymentStatus='running',childScope?:string):AdapterDeploymentStage {
 return{id:scope+'/'+id,stageId:id,label:id,kind:childScope?'subflow':'stage',scope,resourceId:'services',status,runtimeStageIds:['running','completed','failed'].includes(status)?[scope+'/'+id+'#1']:[],executions:['running','completed','failed'].includes(status)?1:0,column:0,row:0,...childScope?{childScope}:{}};
}
function resource():AdapterDeploymentResource {
 return{resourceId:'services',label:'Services',action:'update',rootScope:root,
  scopes:[{id:root,label:'Services'},{id:child,label:'Provider',parentScope:root,mountStageId:root+'/provider'},{id:nested,label:'Host',parentScope:child,mountStageId:child+'/host'}],
  stages:[stage('provider',root,'running',child),stage('host',child,'running',nested),stage('restart',nested),stage('verify',root,'pending')],edges:[]};
}
const deployment=(value=resource()):AdapterDeploymentView=>({available:true,runId:'deployment-one',nativeRunId:'native-one',resources:[value],warnings:[]});
function action(runtimeStageId=nested+'/restart#1',componentId?:string):TopologyNodeAction {
 return{resourceId:'services',...componentId?{componentId}:{},phase:'start',status:'running',scope:componentId?'component':'shared-resource',label:'Recorded action',evidence:{kind:'adapter',runId:'native-one',runtimeStageId,complete:false}};
}
function topology():SystemTopologyView {
 const node=(id:string,componentId?:string):TopologyNodeView=>({id,label:id,category:'compute',origin:'existing',originLabel:'Existing',boundaryId:'runtime',bindings:{resourceIds:['services'],...componentId?{componentIds:[componentId]}:{}},status:'checking',statusLabel:'Checking',facts:{installed:'confirmed',running:'unknown',connected:'unknown'},evidenceScope:'component',progress:{completed:0,total:2,indeterminate:false},evidence:[],limitations:[]});
 const nodes=[node('backend','neo-be'),node('tools','neo-tools'),node('database')];
 const boundaries:SystemTopologyView['boundaries']=[{id:'server',label:'Server',kind:'server',status:'checking',observed:true,progress:{completed:0,total:2,indeterminate:false},evidence:[]},{id:'runtime',label:'Runtime',kind:'runtime',parentId:'server',bindings:{resourceIds:['services']},status:'checking',observed:true,progress:{completed:0,total:2,indeterminate:false},evidence:[]}];
 return{version:1,kind:'system-topology-view',definition:{version:1,kind:'system-topology',id:'system',label:'System',binding:{targetId:'target',graphDigest:'a'.repeat(64)},digest:'b'.repeat(64),nodes,boundaries,connections:[]},observations:{targetId:'target',graphDigest:'a'.repeat(64),definitionDigest:'b'.repeat(64),configurationDigest:'c'.repeat(64),resources:[],components:[],checks:[],actions:[]},nodes,boundaries,connections:[],limitations:[]};
}

test('the running frontier enters exact nested scopes instead of following their still-running mount ancestors',()=>{
 const view=deployment(),before=structuredClone(view),plan=selectExecutionFollow(view);
 assert.equal(plan.resourceId,'services');assert.equal(plan.scopeId,nested);
 assert.deepEqual(plan.activeStageIds,[nested+'/restart']);assert.deepEqual(plan.stageIds,[nested+'/restart']);
 assert.deepEqual(view,before);
});

test('a new recorded moment returns to its active parent and never follows future or last-completed work',()=>{
 const first=deployment(),next=structuredClone(first);
 for(const row of next.resources[0]!.stages)row.status='completed';
 next.resources[0]!.stages.find(row=>row.stageId==='verify')!.status='running';
 assert.equal(selectExecutionFollow(first).scopeId,nested);
 const plan=selectExecutionFollow(next);assert.equal(plan.scopeId,null);assert.deepEqual(plan.stageIds,[root+'/verify']);
 assert.deepEqual(plan.activeStageIds,[root+'/verify']);
});

test('parallel child scopes stay together at their deepest shared scope using their exact visible mounts',()=>{
 const value=resource(),left=child+'/left',right=child+'/right';
 value.scopes.push({id:left,label:'Left',parentScope:child,mountStageId:child+'/left'},{id:right,label:'Right',parentScope:child,mountStageId:child+'/right'});
 value.stages=[stage('provider',root,'running',child),stage('left',child,'running',left),stage('right',child,'running',right),stage('work',left),stage('work',right)];
 const plan=selectExecutionFollow(deployment(value));
 assert.equal(plan.scopeId,child);assert.deepEqual(plan.stageIds,[child+'/left',child+'/right']);
 assert.deepEqual(plan.activeStageIds,[left+'/work',right+'/work']);
});

test('parallel stages in one scope fit together with stable ordering rather than choosing a most-recent label',()=>{
 const value=resource();value.stages.push(stage('another',nested));
 const before=selectExecutionFollow(deployment(value));value.stages.reverse();
 const after=selectExecutionFollow(deployment(value));assert.deepEqual(after,before);
 assert.deepEqual(after.stageIds,[nested+'/another',nested+'/restart']);
});

test('multiple active resources select deterministically while retaining every resource in the active frontier',()=>{
 const view=deployment(),other=structuredClone(resource());other.resourceId='alpha';
 for(const row of other.stages){row.resourceId='alpha';row.id='alpha-'+row.id;row.runtimeStageIds=row.runtimeStageIds.map(id=>'alpha-'+id);}
 // A separate root with a direct running stage is sufficient for this resource's projection.
 other.rootScope='alpha-root';other.scopes=[{id:'alpha-root',label:'Alpha'}];other.stages=[{...stage('start','alpha-root'),resourceId:'alpha'}];
 view.resources.push(other);
 assert.equal(selectExecutionFollow(view).resourceId,'alpha');
 assert.equal(selectExecutionFollow(view,undefined,'services').resourceId,'services');
 assert.deepEqual(selectExecutionFollow(view).activeResourceIds,['alpha','services']);
 assert.deepEqual(selectExecutionFollow(view).activeStageIds,['alpha-root/start',nested+'/restart']);
});

test('terminal, skipped, unknown and unobserved stages never manufacture an active cursor',()=>{
 for(const status of ['completed','failed','skipped','unknown','pending'] as const){
  const view=deployment();for(const row of view.resources[0]!.stages)row.status=status;
  const plan=selectExecutionFollow(view);assert.equal(plan.scopeId,null);assert.deepEqual(plan.stageIds,[]);assert.deepEqual(plan.activeStageIds,[]);
 }
 assert.deepEqual(selectExecutionFollow(undefined),{stageIds:[],activeStageIds:[],activeResourceIds:[],componentIds:[],boundaryIds:[]});
});

test('missing or cyclic scope metadata does not invent a prefix-derived drill target',()=>{
 const view=deployment();view.resources[0]!.scopes.find(row=>row.id===nested)!.parentScope=nested;
 const plan=selectExecutionFollow(view);assert.equal(plan.scopeId,null);assert(!plan.stageIds.includes(nested+'/restart'));
 const broken=deployment();broken.resources[0]!.scopes=broken.resources[0]!.scopes.filter(row=>row.id!==nested);
 assert.equal(selectExecutionFollow(broken).scopeId,null);
});

test('exact native component actions highlight matching placement without changing Existing labels or progress',()=>{
 const view=deployment(),system=topology();system.nodes[0]!.actions=[action(undefined,'neo-be')];
 const before=structuredClone(system),plan=selectExecutionFollow(view,system);
 assert.deepEqual(plan.componentIds,['backend']);assert.deepEqual(plan.boundaryIds,['runtime','server']);
 assert.deepEqual(system,before);assert.equal(system.nodes[0]!.origin,'existing');assert.equal(system.nodes[0]!.progress.completed,0);
});

test('shared actions focus only the registered node-action rows, not neighbouring resource-only database bindings',()=>{
 const view=deployment(),system=topology();system.nodes[0]!.actions=[action()];system.nodes[1]!.actions=[action()];
 system.observations.actions=[action()];
 const plan=selectExecutionFollow(view,system);assert.deepEqual(plan.componentIds,['backend','tools']);
 assert.deepEqual(plan.boundaryIds,['runtime','server']);assert(!plan.componentIds.includes('database'));
});

test('foreign, passed, mismatched-runtime and unmatched-component actions do not borrow the active stage',()=>{
 for(const change of [
  (row:TopologyNodeAction)=>{row.evidence.runId='foreign-native';},
  (row:TopologyNodeAction)=>{row.evidence.runtimeStageId=nested+'/different#1';},
  (row:TopologyNodeAction)=>{row.componentId='unregistered';row.scope='component';},
  (row:TopologyNodeAction)=>{row.status='passed';},
 ]){
  const view=deployment(),system=topology(),row=action();change(row);system.nodes[0]!.actions=[row];
  assert.deepEqual(selectExecutionFollow(view,system).componentIds,[]);
 }
 const view=deployment(),system=topology();system.nodes[0]!.actions=[action()];delete view.nativeRunId;
 assert.deepEqual(selectExecutionFollow(view,system).componentIds,[]);
});

test('a repeated or ambiguous runtime instance cannot create a component association',()=>{
 const view=deployment(),system=topology();system.nodes[0]!.actions=[action()];
 view.resources[0]!.stages.push({...stage('duplicate',nested),runtimeStageIds:[nested+'/restart#1']});
 assert.deepEqual(selectExecutionFollow(view,system).componentIds,[]);
});
