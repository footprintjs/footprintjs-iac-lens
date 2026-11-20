import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {DashboardState} from '../src/core/types.ts';
import type {RunRecord} from '../src/core/run-history.ts';
import {selectRunMoment} from '../web/features/runs/select-run-moment.ts';
import {createRunDeploymentGraph} from '../web/features/runs/create-run-deployment-graph.ts';
import type {AdapterDeploymentResource} from '../src/core/adapter-deployment.ts';

const initial:DashboardState={revision:1,busy:false,graph:null,target:{id:'server'},run:{id:'held-run',status:'running',resources:[],events:[]}};
function record():RunRecord {
 return{version:1,summary:{id:'a'.repeat(64),runId:'held-run',targetId:'server',label:'Neo',kind:'deployment',status:'ready',sequence:1,frameCount:2,replayAvailable:true,timing:'steps',appVerified:false,limitations:[]},frames:[
  {sequence:1,nativePosition:'start',caption:'Starting',state:initial,deployment:{available:false,runId:'held-run',resources:[],warnings:['Initial snapshot']}},
  {sequence:2,nativePosition:'finish',caption:'Ready',state:{...initial,revision:2,run:{...initial.run!,status:'passed'}},deployment:{available:false,runId:'held-run',resources:[],warnings:['Final snapshot']}},
 ],omittedFrames:0,limitations:[]};
}
test('one replay cursor selects deployment and system from exactly the same captured publication',()=>{
 const held=record(),before=structuredClone(held),live={...initial,revision:20,run:{...initial.run!,status:'passed' as const}};
 for(const index of [0,1]){
  const selected=selectRunMoment(held,index,live,false);
  assert.equal(selected.state,held.frames[index]!.state);assert.equal(selected.deployment,held.frames[index]!.deployment);
 }
 assert.equal(selectRunMoment(held,0,live,false).deployment!.warnings[0],'Initial snapshot');
 assert.deepEqual(held,before);
});
test('old and foreign recordings never borrow later native step detail, while following uses one live publication',()=>{
 const held=record(),live={...initial,revision:30};delete held.frames[0]!.deployment;
 assert.equal(selectRunMoment(held,0,live,false).deployment,undefined);
 const foreign={...live,run:{...live.run!,id:'different-run'}};
 assert.equal(selectRunMoment(held,0,foreign,true).state,held.frames[0]!.state);
 const following=selectRunMoment(held,0,live,true);assert.equal(following.state,live);assert.notEqual(following.deployment,held.frames.at(-1)!.deployment);
 assert.equal(selectRunMoment(undefined,0,live,true).state,undefined);
});
test('standard deployment view retains every native branch and scoped operation',()=>{
 const scope='native/provider',stage=(id:string,column:number,kind:'stage'|'decision'='stage')=>({id:scope+'/'+id,stageId:id,label:id,kind,scope,resourceId:'services',status:'pending' as const,runtimeStageIds:[],executions:0,column,row:0});
 const resource:AdapterDeploymentResource={resourceId:'services',label:'Service group',action:'update',rootScope:scope,adapterScope:scope,scopes:[{id:scope,label:'Provider'}],stages:[stage('admit',0),stage('gate',1,'decision'),stage('start',2),stage('skip',2),stage('verify',3)],edges:[{id:'a',source:scope+'/admit',target:scope+'/gate',kind:'next'},{id:'b',source:scope+'/gate',target:scope+'/start',kind:'branch'},{id:'c',source:scope+'/gate',target:scope+'/skip',kind:'branch'},{id:'d',source:scope+'/start',target:scope+'/verify',kind:'next'},{id:'e',source:scope+'/skip',target:scope+'/verify',kind:'next'}]};
 const before=structuredClone(resource),graph=createRunDeploymentGraph(resource);
 const gate=graph.nodes.find(node=>node.id===scope+'/gate')!;
 assert.deepEqual(graph.nodes.map(node=>node.id),resource.stages.map(stage=>stage.id));
 assert.equal(gate.type,'stageNode');assert.equal(gate.width,undefined);assert.equal(gate.height,undefined);
 assert(graph.nodes.every(node=>(node.data.stage as {status:string}).status==='pending'));
 assert.deepEqual(resource,before);
 resource.edges.find(edge=>edge.id==='b')!.selected=false;resource.edges.find(edge=>edge.id==='c')!.selected=true;
 const alternate=createRunDeploymentGraph(resource);
 assert.equal(alternate.edges.find(edge=>edge.id==='c')!.data!.selected,true,'selection follows the recorded edge, not branch array order');
 assert(graph.edges.every(edge=>edge.data!.selected===undefined),'an unobserved decision never chooses its first branch');
});
test('the selected run exposes two quiet panes and exactly one shared replay timeline',async()=>{
 const root=join(import.meta.dirname,'..');
 const result=await build({stdin:{contents:"export {RunPlayer} from './web/features/runs/RunPlayer.tsx'",resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'});
 await mkdir(join(root,'.artifacts'),{recursive:true});const directory=await mkdtemp(join(root,'.artifacts/synchronized-ui-'));
 try{
  const file=join(directory,'render.mjs');await writeFile(file,result.outputFiles[0]!.text);const {RunPlayer}=await import(pathToFileURL(file).href);
  const held=record(),html=renderToStaticMarkup(createElement(RunPlayer,{record:held,summary:held.summary,liveState:{revision:0,busy:false,graph:null},connected:false,loading:false,onBack:()=>{},onCurrentDetails:()=>{}}));
  assert.match(html,/Deployment flow/);assert.match(html,/Running system/);assert.match(html,/Synchronized deployment and running system/);
  assert.equal((html.match(/aria-label="Replay position"/g)??[]).length,1);
  assert.equal((html.match(/data-fp="time-travel-controls"/g)??[]).length,1);
  assert.equal((html.match(/aria-label="Run replay"/g)??[]).length,1);
 }finally{await rm(directory,{recursive:true,force:true});}
});
