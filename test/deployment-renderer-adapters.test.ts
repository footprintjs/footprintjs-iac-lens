import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import type {DashboardState} from '../src/core/types.ts';
import type {AdapterDeploymentResource,AdapterDeploymentStage,AdapterDeploymentView} from '../src/core/adapter-deployment.ts';
import {buildDeploymentFlowView} from '../web/lib/deployment-flow-view.ts';
import {createDeploymentTraceGraph} from '../web/lib/create-deployment-trace-graph.ts';
import {adapterFlowLayout} from '../web/features/adapter-deployment/adapter-flow-layout.ts';
import {createAdapterTraceGraph} from '../web/features/adapter-deployment/create-adapter-trace-graph.ts';

function deployment():DashboardState {
 return {revision:1,busy:true,graph:{kind:'infra-graph',version:1,name:'native-renderer',digest:'a'.repeat(64),boundaries:[],memberships:[],relations:[{kind:'communicatesWith',from:'app',to:'database'}],resources:[
  {id:'database',provider:'fixture',spec:{}},{id:'app',provider:'fixture',dependsOn:['database'],spec:{kind:'Deployment'}},
 ]},run:{id:'deployment-one',status:'running',resources:[{id:'database',status:'ready',action:'find'},{id:'app',status:'deploying',action:'update'}],events:[
  {runId:'deployment-one',resourceId:'database',status:'deploying',sequence:1,timestamp:100,runtimeStageId:'find-database#0'},
  {runId:'deployment-one',resourceId:'database',status:'ready',sequence:2,timestamp:100,runtimeStageId:'find-database#0'},
  {runId:'deployment-one',resourceId:'app',status:'deploying',sequence:3,timestamp:100,runtimeStageId:'update-app#1'},
 ]}};
}
function adapter():AdapterDeploymentResource {
 const stage=(id:string,kind:AdapterDeploymentStage['kind'],column:number,status:AdapterDeploymentStage['status']):AdapterDeploymentStage=>({
  id:`mounted/provider/${id}`,stageId:id,label:id,kind,scope:'mounted/provider',resourceId:'services',status,runtimeStageIds:status==='skipped'?[]:[`mounted/provider/${id}#4`],executions:status==='skipped'?0:1,column,row:0,
 });
 const stages=[stage('inspect','stage',0,'completed'),stage('change-needed','decision',1,'completed'),stage('restart','stage',2,'running'),stage('leave-unchanged','stage',2,'skipped'),stage('observe','subflow',3,'pending')];
 stages[2]!.runtimeStageIds=['mounted/provider/restart#3','mounted/provider/restart#4'];stages[2]!.executions=2;
 stages[4]!.childScope='mounted/provider/observe';
 return{resourceId:'services',label:'Registered services',action:'update',rootScope:'mounted/provider',scopes:[{id:'mounted/provider',label:'Provider'}],stages,edges:[
  {id:'inspect-gate',source:stages[0]!.id,target:stages[1]!.id,kind:'next'},
  {id:'chosen',source:stages[1]!.id,target:stages[2]!.id,kind:'branch',selected:true},
  {id:'excluded',source:stages[1]!.id,target:stages[3]!.id,kind:'branch',selected:false},
  {id:'restart-observe',source:stages[2]!.id,target:stages[4]!.id,kind:'next'},
  {id:'retry',source:stages[4]!.id,target:stages[2]!.id,kind:'loop'},
 ]};
}

test('the deployment renderer adapter retains native resource identity, observed order and separate prerequisite semantics',()=>{
 const input=deployment(),before=structuredClone(input),view=buildDeploymentFlowView(input,undefined,true),graph=createDeploymentTraceGraph(view);
 assert.deepEqual(graph.nodes.map(node=>node.id),view.nodes.map(node=>node.id));
 for(const node of graph.nodes){const original=view.nodes.find(row=>row.id===node.id)!;assert.deepEqual(node.position,original.position);assert.equal(node.data.step,original.data.step);}
 assert.equal(graph.nodes.find(node=>node.id==='database')!.data.step.progress.action,'find');
 assert.equal(graph.nodes.find(node=>node.id==='app')!.data.step.progress.status,'deploying');
 assert(graph.edges.every(edge=>edge.data?.domain==='deployment'));
 assert.deepEqual(graph.edges.map(edge=>[edge.id,edge.source,edge.target,edge.label]),view.edges.map(edge=>[edge.id,edge.source,edge.target,edge.label]));
 assert(!graph.edges.some(edge=>edge.source==='app'&&edge.target==='database'),'a communication edge never becomes execution order');
 assert.deepEqual(input,before);
});

test('the scoped adapter renderer retains selected branches, loop identity and repeated native instances without promoting pending work',()=>{
 const input=adapter(),before=structuredClone(input),layout=adapterFlowLayout(input,'mounted/provider',true,()=>{},()=>{}),graph=createAdapterTraceGraph(layout);
 assert.equal(graph.nodes.length,input.stages.length);
 for(const node of graph.nodes){const original=input.stages.find(row=>row.id===node.id)!;assert.equal(node.data.stage,original);assert.equal(node.data.stage.status,original.status);}
 assert.deepEqual(graph.nodes.find(node=>node.data.stage.stageId==='restart')!.data.stage.runtimeStageIds,['mounted/provider/restart#3','mounted/provider/restart#4']);
 assert.equal(graph.nodes.find(node=>node.data.stage.stageId==='restart')!.data.stage.executions,2);
 assert.equal(graph.nodes.find(node=>node.data.stage.stageId==='observe')!.data.stage.childScope,'mounted/provider/observe');
 assert.equal(graph.nodes.find(node=>node.data.stage.stageId==='observe')!.data.stage.status,'pending');
 assert.equal(graph.edges.find(edge=>edge.id==='chosen')!.data?.selected,true);
 assert.equal(graph.edges.find(edge=>edge.id==='excluded')!.data?.selected,false);
 assert.equal(graph.edges.find(edge=>edge.id==='retry')!.data?.kind,'loop');
 assert.deepEqual(graph.edges.map(edge=>edge.id),input.edges.map(edge=>edge.id));
 assert.deepEqual(input,before);
});

test('both deployment presentations mount the released EUI renderer while execution state remains in admitted projection',async()=>{
 const root=resolve(import.meta.dirname,'..');
 const result=await build({stdin:{contents:"export {DeploymentFlow} from './web/components/DeploymentFlow.tsx'; export {default as AdapterDeploymentFlow} from './web/features/adapter-deployment/AdapterDeploymentFlow.tsx';",resolveDir:root,loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'});
 await mkdir(join(root,'.artifacts'),{recursive:true});const directory=await mkdtemp(join(root,'.artifacts/deployment-renderer-'));
 try{
  const file=join(directory,'render.mjs');await writeFile(file,result.outputFiles[0]!.text);const components=await import(pathToFileURL(file).href);
  const input=deployment(),before=structuredClone(input),resource=adapter(),view:AdapterDeploymentView={available:true,runId:input.run!.id,nativeRunId:'native-one',warnings:[],resources:[resource]};
  for(const html of [renderToStaticMarkup(createElement(components.DeploymentFlow,{state:input,onSelect:()=>{}})),renderToStaticMarkup(createElement(components.AdapterDeploymentFlow,{state:input,view,fitWindow:true}))]){
   assert.match(html,/data-fp="traced-flow"/);assert.match(html,/data-fp-renderer="flat"/);assert.match(html,/data-unstyled="true"/);
  }
  assert.deepEqual(input,before);
 }finally{await rm(directory,{recursive:true,force:true});}
});
