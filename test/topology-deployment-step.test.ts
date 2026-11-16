import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTopologyDeploymentStep, currentRecordedDeploymentStep } from '../src/core/topology-deployment-step.ts';
import type { AdapterDeploymentView } from '../src/core/adapter-deployment.ts';
const evidence = {kind:'adapter' as const,runId:'native-one',runtimeStageId:'mount/provider/start#4',complete:false};
function view():AdapterDeploymentView {
 return {available:true,runId:'deployment-one',nativeRunId:'native-one',warnings:[],resources:[{resourceId:'services',label:'Services',action:'update',rootScope:'mount',scopes:[{id:'mount',label:'Reconcile'},{id:'mount/provider',label:'Provider',parentScope:'mount'}],edges:[],stages:[{id:'mount/provider/start',stageId:'start',label:'Restart registered services',kind:'stage',scope:'mount/provider',resourceId:'services',status:'running',runtimeStageIds:['mount/provider/start#4'],executions:1,column:0,row:0}]}]};
}
test('topology links resolve the exact admitted native instance, resource and mounted scope',()=>{
 const result=resolveTopologyDeploymentStep(view(),{resourceId:'services',evidence});
 assert.deepEqual(result,{deploymentRunId:'deployment-one',nativeRunId:'native-one',resourceId:'services',stageId:'mount/provider/start',runtimeStageId:'mount/provider/start#4',scope:'mount/provider'});
});
test('stale runs, wrong resources and absent runtime evidence cannot link to an unrelated green stage',()=>{
 for(const change of [{runId:'native-old'},{runtimeStageId:'mount/provider/start#3'},{runtimeStageId:undefined}])assert.equal(resolveTopologyDeploymentStep(view(),{resourceId:'services',evidence:{...evidence,...change}}),undefined);
 assert.equal(resolveTopologyDeploymentStep(view(),{resourceId:'other',evidence}),undefined);
 assert.equal(resolveTopologyDeploymentStep({...view(),nativeRunId:undefined},{resourceId:'services',evidence}),undefined);
 assert.equal(resolveTopologyDeploymentStep({...view(),available:false},{resourceId:'services',evidence}),undefined);
 assert.equal(resolveTopologyDeploymentStep(view(),{resourceId:'services',evidence:{...evidence,kind:'check'}}),undefined);
});
test('a skipped or unconfirmed stage cannot masquerade as an observed component operation',()=>{
 for(const status of ['skipped','unknown','pending'] as const){const input=view();input.resources[0]!.stages[0]!.status=status;assert.equal(resolveTopologyDeploymentStep(input,{resourceId:'services',evidence}),undefined);}
 const input=view();input.resources[0]!.stages.push({...input.resources[0]!.stages[0]!,id:'mount/provider/duplicate'});
 assert.equal(resolveTopologyDeploymentStep(input,{resourceId:'services',evidence}),undefined,'ambiguous native identity stays unavailable');
});

test('a selected link is revalidated on every run and exact runtime identity',()=>{
 const input=view(),selection=resolveTopologyDeploymentStep(input,{resourceId:'services',evidence})!;
 assert.deepEqual(currentRecordedDeploymentStep(input,selection),selection);
 assert.equal(currentRecordedDeploymentStep({...input,runId:'deployment-two'},selection),undefined);
 assert.equal(currentRecordedDeploymentStep({...input,nativeRunId:'native-two'},selection),undefined);
 assert.equal(currentRecordedDeploymentStep(input,{...selection,scope:'different-scope'}),undefined);
 assert.equal(currentRecordedDeploymentStep(input,undefined),undefined);
});
