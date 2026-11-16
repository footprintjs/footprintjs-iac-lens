import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {adapterFlowLayout} from '../web/features/adapter-deployment/adapter-flow-layout.ts';
import type {AdapterDeploymentResource,AdapterDeploymentStage} from '../src/core/adapter-deployment.ts';
function fixture():AdapterDeploymentResource {
  const stage=(id:string,kind:AdapterDeploymentStage['kind'],column:number,status:AdapterDeploymentStage['status']='completed'):AdapterDeploymentStage=>({id:`scope/${id}`,stageId:id,label:id,kind,scope:'scope',resourceId:'service-group',status,runtimeStageIds:[`scope/${id}#1`],executions:1,column,row:0});
  const stages=[stage('inspect','stage',0),stage('change-needed','decision',1),stage('restart','stage',2),stage('leave-unchanged','stage',2,'skipped'),stage('observe','stage',3)];
  return{resourceId:'service-group',label:'Services',action:'update',rootScope:'scope',scopes:[{id:'scope',label:'Recorded adapter'}],stages,edges:[
    {id:'inspect-decision',source:'scope/inspect',target:'scope/change-needed',kind:'next'},
    {id:'yes',source:'scope/change-needed',target:'scope/restart',kind:'branch',selected:true},
    {id:'no',source:'scope/change-needed',target:'scope/leave-unchanged',kind:'branch',selected:false},
    {id:'restart-check',source:'scope/restart',target:'scope/observe',kind:'next'},
    {id:'unchanged-check',source:'scope/leave-unchanged',target:'scope/observe',kind:'next'},
  ]};
}
test('compact adapter cards retain both native decision branches and their independent skipped evidence',()=>{
 const input=fixture(),layout=adapterFlowLayout(input,'scope',false,()=>{},()=>{});
 assert.equal(layout.nodes.length,3);const gate=layout.nodes.find(node=>node.id==='scope/change-needed')!;
 assert.deepEqual(gate.data.branches.map(stage=>[stage.stageId,stage.status]),[['restart','completed'],['leave-unchanged','skipped']]);
 assert.deepEqual(layout.edges.map(({source,target})=>[source,target]),[['scope/inspect','scope/change-needed'],['scope/change-needed','scope/observe']]);
 assert.equal(input.stages.length,5,'view grouping never removes source evidence');
});
test('full chart retains individual native nodes and chosen versus unchosen branch arrows',()=>{
 const input=fixture(),layout=adapterFlowLayout(input,'scope',true,()=>{},()=>{});
 assert.equal(layout.nodes.length,5);assert.equal(layout.edges.length,5);
 assert.equal(layout.edges.find(edge=>edge.id==='yes')?.label,'selected');assert.equal(layout.edges.find(edge=>edge.id==='no')?.label,'not selected');
 input.stages.find(stage=>stage.stageId==='restart')!.status='running';
 const next=adapterFlowLayout(input,'scope',true,()=>{},()=>{});
 assert.deepEqual(next.nodes.map(node=>node.position),layout.nodes.map(node=>node.position));assert(next.edges.find(edge=>edge.id==='restart-check')?.animated);
});
test('adapter renderer remains an optional lazy chunk outside the framework-neutral core',async()=>{
 const result=await build({absWorkingDir:new URL('..',import.meta.url).pathname,entryPoints:['web/features/adapter-deployment/AdapterDeploymentSlot.tsx'],bundle:true,write:false,splitting:true,outdir:'/not-written',format:'esm',platform:'browser',packages:'external',jsx:'automatic',logLevel:'silent'});
 const entry=result.outputFiles.find(file=>file.path.endsWith('AdapterDeploymentSlot.js'))!.text;
 assert.match(entry,/import\(/);assert.doesNotMatch(entry,/adapter-stage-detail|Inside the deployment/);
 assert(result.outputFiles.some(file=>file.path.includes('AdapterDeploymentFlow-')&&file.text.includes('Inside the deployment')));
});

test('selectors with three or more branches remain individual visible nodes instead of clipping a compact card',()=>{
 const input=fixture(),third={...input.stages[2]!,id:'scope/third',stageId:'third',label:'Third parallel operation',row:2};input.stages.push(third);
 input.edges.push({id:'third-branch',source:'scope/change-needed',target:third.id,kind:'branch',selected:true});
 const layout=adapterFlowLayout(input,'scope',false,()=>{},()=>{});
 for(const stage of input.stages)assert(layout.nodes.some(node=>node.id===stage.id));
 assert.equal(layout.nodes.find(node=>node.id==='scope/change-needed')!.data.branches.length,0);
});
