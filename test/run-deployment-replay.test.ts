import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {flowChart,FlowChartExecutor,decide,type CombinedRecorder} from 'footprintjs';
import {controlDepRecorder} from 'footprintjs/trace';
import {compileGraph} from 'footprintjs-iac/graph';
import type {DeploymentChart} from 'footprintjs-iac/progress';
import type {DashboardState,Recording} from '../src/core/types.ts';
import {readRunRecord,type RunRecord} from '../src/core/run-history.ts';
import {FileRunRepository} from '../src/server/run-repository.ts';
import {runFrameDeployment} from '../src/server/run-frame-deployment.ts';
import {runFrameState} from '../src/server/run-frame-state.ts';

type Row=Record<string,any>;
async function capture(){
 let release!:()=>void,entered!:()=>void,effects=0;
 const held=new Promise<void>(resolve=>{release=resolve;}),waiting=new Promise<void>(resolve=>{entered=resolve;});
 const child=flowChart('Admit operation',(scope:Row)=>{scope.allowed=true;},'adapter-admit')
  .addDeciderFunction('Can update?',(scope:Row)=>decide(scope,[{when:{allowed:{eq:true}},then:'change'}],'unchanged'),'gate')
  .addFunctionBranch('change','Update service',async()=>{effects++;entered();await held;})
  .addFunctionBranch('unchanged','Leave service unchanged',()=>undefined).end()
  .addFunction('Verify service',(scope:Row)=>{scope.verified=true;},'verify').build();
 const native=flowChart('Load',(scope:Row)=>{scope.failed=false;},'load')
  .addDeciderFunction('Can proceed?',(scope:Row)=>decide(scope,[{when:{failed:{eq:false}},then:'execute-app'}],'skip-app'),'gate-app')
  .addSubFlowChartBranch('execute-app',child,'Reconcile app').addFunctionBranch('skip-app','Skip app',()=>undefined).end().build();
 const graph=compileGraph({name:'synchronized-replay',resources:[{id:'app',provider:'test',spec:{kind:'Service'}}],boundaries:[],memberships:[],relations:[]});
 const chart:DeploymentChart={version:1,runId:'domain-run',stack:graph.name,graphDigest:graph.digest,structure:native.buildTimeStructure,
  resources:[{resourceId:'app',action:'update',batchIndex:0,gateStageId:'gate-app',executeStageId:'execute-app',skipStageId:'skip-app'}]};
 const executor=new FlowChartExecutor(native);executor.attachCombinedRecorder(controlDepRecorder({id:'iac-internal-control-dependencies'}));
 const events:Row[]=[];let nativeRunId='';
 const record=(type:string,event:Row)=>events.push({sequence:events.length+1,type,runtimeStageId:event.runtimeStageId,stageId:event.stageId,...event.chosen===undefined?{}:{chosen:event.chosen}});
 const observer:CombinedRecorder={id:'iac-native-stage-progress',onRunStart(event){nativeRunId=event.traversalContext!.runId;},onStageStart(event){record('start',event);},onStageEnd(event){record('end',event);},onSelected(event){if(event.evidence)record('decision',{...event.traversalContext,chosen:event.evidence.selected});},toSnapshot(){return{name:'Observed stages',data:{version:1,runId:nativeRunId,events:[...events],droppedEvents:0,observerFailures:0}};}};
 executor.attachCombinedRecorder(observer);
 const state=(phase:'pending'|'running'|'passed'):DashboardState=>({revision:events.length,graph,busy:phase!=='passed',target:{id:'local',label:'App'},run:{id:chart.runId,status:phase==='passed'?'passed':'running',resources:[{id:'app',status:phase==='pending'?'pending':phase==='running'?'deploying':'ready',action:'update'}],
  events:[{version:1,runId:chart.runId,sequence:phase==='passed'?2:1,runtimeStageId:'execute-app#0',resourceId:'app',status:phase==='pending'?'pending':phase==='running'?'deploying':'ready',action:'update'}],chart,
  ...phase==='pending'?{}:{recording:JSON.parse(JSON.stringify({snapshot:executor.getSnapshot(),structure:native.buildTimeStructure,provenance:{runId:chart.runId,stack:graph.name,graphDigest:graph.digest}})) as Recording}}});
 const pending=state('pending'),run=executor.run();await waiting;
 return{pending,running:state('running'),release,run,final:()=>state('passed'),effects:()=>effects};
}
const stage=(record:RunRecord,index:number,id:string)=>record.frames[index]!.deployment!.resources[0]!.stages.find(stage=>stage.stageId===id)!;

test('one archive moment retains its native subflow state without projecting terminal evidence into earlier moments',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'lens-synchronized-replay-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const fixture=await capture(),repository=new FileRunRepository(directory);await repository.initialize();
 try{repository.observe(fixture.pending);repository.observe(fixture.running);await repository.whenIdle();}
 finally{fixture.release();await fixture.run;}
 repository.observe(fixture.final());await repository.whenIdle();
 const id=(await repository.list()).runs[0]!.id,record=(await repository.read(id))!;
 assert.equal(record.frames.length,3);assert(record.recording);
 assert(record.frames.every(frame=>!frame.state.run?.recording&&!frame.state.recording),'the full native recording is retained once, not copied into each moment');
 assert(record.frames[0]!.deployment!.resources[0]!.stages.every(stage=>stage.status==='pending'));
 assert.equal(stage(record,0,'gate').nativeKind,'decider','retain the native constructor kind before outcomes exist');
 assert.equal(stage(record,1,'change').status,'running');assert.equal(stage(record,1,'verify').status,'pending');
 assert.equal(stage(record,1,'unchanged').status,'skipped','only the actual native choice establishes skipping');
 assert.equal(stage(record,2,'change').status,'completed');assert.equal(stage(record,2,'verify').status,'completed');
 const saved=JSON.stringify(record),indexBefore=await readFile(join(directory,'runs','index.json'),'utf8');
 const reopened=new FileRunRepository(directory);await reopened.initialize();assert.equal(JSON.stringify(await reopened.read(id)),saved);
 assert.equal(await readFile(join(directory,'runs','index.json'),'utf8'),indexBefore);assert.equal(fixture.effects(),1);
 // Consumer mutation cannot change the repository's earlier admitted result.
 stage(record,0,'verify').status='completed';assert.equal(stage((await reopened.read(id))!,0,'verify').status,'pending');
});

test('older archives remain byte-equivalent read models and never acquire terminal step observations',async t=>{
 const fixture=await capture();fixture.release();await fixture.run;
 const state=fixture.final(),frameState=runFrameState(state,{appVerified:false});
 const record:RunRecord={version:1,summary:{id:'a'.repeat(64),runId:state.run!.id,targetId:'local',label:'App',kind:'deployment',status:'ready',sequence:1,frameCount:1,replayAvailable:true,timing:'steps',appVerified:false,limitations:[]},frames:[{sequence:1,nativePosition:'old-position',caption:'Done',state:frameState}],omittedFrames:0,limitations:[],recording:state.run!.recording};
 assert.equal(JSON.stringify(readRunRecord(record)),JSON.stringify(record));assert.equal(readRunRecord(record).frames[0]!.deployment,undefined);
});

test('per-moment readers reject foreign ownership, malformed scope references and fabricated native stage outcomes',async()=>{
 const fixture=await capture();fixture.release();await fixture.run;
 const state=fixture.final(),frameState=runFrameState(state,{appVerified:false}),deployment=runFrameDeployment(state,frameState);
 assert(deployment.available);
 const base:RunRecord={version:1,summary:{id:'a'.repeat(64),runId:state.run!.id,targetId:'local',label:'App',kind:'deployment',status:'ready',sequence:1,frameCount:1,replayAvailable:true,timing:'steps',appVerified:false,limitations:[]},frames:[{sequence:1,nativePosition:'position',caption:'Done',state:frameState,deployment}],omittedFrames:0,limitations:[]};
 for(const change of [
  (record:RunRecord)=>{record.frames[0]!.deployment!.runId='foreign';},
  (record:RunRecord)=>{record.frames[0]!.deployment!.resources[0]!.resourceId='other-resource';},
  (record:RunRecord)=>{record.frames[0]!.deployment!.resources[0]!.stages[0]!.scope='another-scope';},
  (record:RunRecord)=>{record.frames[0]!.deployment!.resources[0]!.edges[0]!.target='unknown-stage';},
  (record:RunRecord)=>{const step=record.frames[0]!.deployment!.resources[0]!.stages[0]!;step.status='completed';step.runtimeStageIds=[];step.executions=0;},
 ]){const input=structuredClone(base);change(input);assert.throws(()=>readRunRecord(input));}
 let reads=0;const accessor=structuredClone(base);Object.defineProperty(accessor.frames[0]!.deployment!,'available',{enumerable:true,get(){reads++;return true;}});assert.throws(()=>readRunRecord(accessor));assert.equal(reads,0);
});

test('unsupported or oversized per-moment adapter evidence is explicit instead of truncated or borrowed',async()=>{
 const fixture=await capture();fixture.release();await fixture.run;
 const absent=structuredClone(fixture.pending);delete absent.run!.chart;
 const missing=runFrameDeployment(absent,runFrameState(absent,{appVerified:false}));
 assert.equal(missing.available,false);assert.deepEqual(missing.resources,[]);assert(missing.warnings.some(warning=>warning.includes('this recorded moment')));
 const large=structuredClone(fixture.pending),mount=large.run!.chart!.structure.next!.children!.find(stage=>stage.id==='execute-app')!;
 let node=mount.subflowStructure!;delete node.next;
 for(let index=0;index<400;index++){
  const next={id:'phase-'+index,type:'stage' as const,name:'A bounded native phase '.repeat(20)};
  node.next=next;node=next;
 }
 const bounded=runFrameDeployment(large,runFrameState(large,{appVerified:false}));
 assert.equal(bounded.available,false);assert.deepEqual(bounded.resources,[]);assert(bounded.warnings.some(warning=>warning.includes('exceed this bounded replay moment')));
});
