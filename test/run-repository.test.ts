import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FileStateStore,InfraEngine,SimulatorAdapter} from 'footprintjs-iac';
import {compileGraph} from 'footprintjs-iac/graph';
import {createDeploymentRecorder} from 'footprintjs-iac/progress';
import {FileRunRepository} from '../src/server/run-repository.ts';
import {deriveRunObservation} from '../src/core/run-history.ts';
import type {DashboardState} from '../src/core/types.ts';

async function fixture(t:{after(fn:()=>Promise<void>):void},limits:{maxFrames?:number}={}){
 const directory=await mkdtemp(join(tmpdir(),'lens-run-history-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const graph=compileGraph({name:'run-history',resources:[{id:'app',provider:'simulator',spec:{version:1}}],boundaries:[],memberships:[],relations:[]});
 const repository=new FileRunRepository(join(directory,'viewer'),limits);await repository.initialize();
 const recorder=createDeploymentRecorder({captureStages:true}),states:DashboardState[]=[];
 const state=(status:'running'|'passed'='running'):DashboardState=>{const value=recorder.getSnapshot();return{revision:states.length,graph,busy:status==='running',target:{id:'test',label:'Test app'},run:{id:value.runId??'',status,mode:'simulator',resources:Object.values(value.resources).map(row=>({...row,id:row.resourceId})),events:[...value.events],...(value.chart?{chart:value.chart}:{}),...(recorder.getRecording()?{recording:recorder.getRecording()}:{} )}};};
 const stop=recorder.subscribe(()=>{const next=state();states.push(next);repository.observe(next);});
 const engine=new InfraEngine({adapters:[new SimulatorAdapter({file:join(directory,'provider.json')})],store:new FileStateStore(join(directory,'engine')),traceDirectory:join(directory,'trace'),recorders:[recorder],chartObservers:[recorder]});
 const result=await engine.apply(graph);stop();assert(result.ok);
 const evidence=JSON.parse(await readFile(result.evidencePath,'utf8')),final=state('passed');
 final.run!.recording={snapshot:evidence.snapshot,structure:evidence.structure,controlDeps:evidence.controlDeps,provenance:{runId:result.runId,stack:graph.name,graphDigest:graph.digest}};
 repository.observe(final);await repository.whenIdle();return{directory,repository,final,states,recorder,engine};
}
test('native observations form one durable run and replay reads never execute the provider',async t=>{
 const f=await fixture(t),catalog=await f.repository.list();assert.equal(catalog.runs.length,1);
 const summary=catalog.runs[0]!;assert.equal(summary.runId,f.final.run!.id);assert.equal(summary.status,'ready');assert(summary.frameCount>1);assert(summary.replayAvailable);
 const record=await f.repository.read(summary.id);assert(record);assert.equal(record.frames.length,summary.frameCount);
 assert(record.frames.some(frame=>frame.state.run?.resources.some(row=>row.status==='deploying')));
 assert(record.frames.every(frame=>!frame.state.run?.recording&&!frame.state.recording&&!frame.state.artifacts));
 const original=await readFile(join(f.directory,'provider.json'),'utf8');
 const reopened=new FileRunRepository(join(f.directory,'viewer'));await reopened.initialize();
 assert.deepEqual(await reopened.read(summary.id),record);assert.equal(await readFile(join(f.directory,'provider.json'),'utf8'),original);
 assert.equal(await reopened.read('../provider.json'),undefined);
});
test('bounded progress discloses omitted updates and keeps native evidence separately',async t=>{
 const f=await fixture(t,{maxFrames:2}),summary=(await f.repository.list()).runs[0]!,record=(await f.repository.read(summary.id))!;
 assert.equal(record.frames.length,2);assert(record.omittedFrames>0);assert.equal(record.frames[0]!.sequence,1);
 assert(record.recording);assert(record.limitations.some(value=>value.includes('outside this bounded replay')));
});
test('another history writer cannot overwrite a newer saved index',async t=>{
 const f=await fixture(t),other=new FileRunRepository(join(f.directory,'viewer'));await other.initialize();
 assert(f.recorder.clear);f.recorder.clear();const result=await f.engine.apply(f.final.graph!);assert(result.ok);
 const snapshot=f.recorder.getSnapshot(),evidence=JSON.parse(await readFile(result.evidencePath,'utf8'));
 const next:DashboardState={...f.final,run:{id:result.runId,status:'passed',mode:'simulator',resources:Object.values(snapshot.resources).map(row=>({...row,id:row.resourceId})),events:[...snapshot.events],recording:{snapshot:evidence.snapshot,structure:evidence.structure,provenance:{runId:result.runId,stack:f.final.graph!.name,graphDigest:f.final.graph!.digest}}}};
 f.repository.observe(next);await f.repository.whenIdle();const path=join(f.directory,'viewer','runs','index.json'),saved=await readFile(path,'utf8');
 other.observe(next);await other.whenIdle();assert.equal(await readFile(path,'utf8'),saved);
 assert((await other.list()).limitations.some(value=>value.includes('could not be saved')));
});
test('browser revisions cannot create replay frames or rewrite a terminal run',async t=>{
 const f=await fixture(t),summary=(await f.repository.list()).runs[0]!,before=await f.repository.read(summary.id);
 for(let revision=100;revision<120;revision++)f.repository.observe({...f.final,revision});
 f.repository.observe({...f.final,busy:true,run:{...f.final.run!,status:'running'}});await f.repository.whenIdle();
 assert.deepEqual(await f.repository.read(summary.id),before);
});
test('a corrupted retained recording stays retained and is never served as a verified replay',async t=>{
 const f=await fixture(t),summary=(await f.repository.list()).runs[0]!;
 const index=JSON.parse(await readFile(join(f.directory,'viewer','runs','index.json'),'utf8'));
 const file=join(f.directory,'viewer','runs',summary.id+'-'+index.entries[0].digest+'.json'),original=await readFile(file,'utf8');
 await writeFile(file,original.replace('Test app','Changed app'));
 const reopened=new FileRunRepository(join(f.directory,'viewer'));await reopened.initialize();
 await assert.rejects(()=>reopened.read(summary.id),/recording|archive|history/i);
 assert.equal(await readFile(file,'utf8'),original.replace('Test app','Changed app'));
});
test('an unmatched running capture becomes incomplete without changing its recorded frames or provider result',async t=>{
 const f=await fixture(t),states=f.states.filter(state=>deriveRunObservation(state)?.status==='running');assert(states.length>1);
 const directory=join(f.directory,'unfinished'),repository=new FileRunRepository(directory);
 await repository.initialize();repository.observe(states[0]!);repository.observe(states.at(-1)!);await repository.whenIdle();
 const id=(await repository.list()).runs[0]!.id,before=(await repository.read(id))!,provider=await readFile(join(f.directory,'provider.json'),'utf8');
 const reopened=new FileRunRepository(directory);await reopened.initialize();const retained=(await reopened.read(id))!;
 assert.equal(retained.summary.status,'incomplete');assert.equal(retained.summary.finishedAt,undefined);assert.equal(retained.summary.appVerified,false);
 assert(retained.limitations.some(text=>text.includes('cannot confirm')));assert.deepEqual(retained.frames,before.frames);
 assert.equal(await readFile(join(f.directory,'provider.json'),'utf8'),provider);
 reopened.observe(f.final);await reopened.whenIdle();assert.deepEqual(await reopened.read(id),retained);
 // A separately admitted current native run can resume the saved capture, including after an orphaned reopen.
 const resumed=new FileRunRepository(directory);await resumed.initialize(states.at(-1)!);
 assert.equal((await resumed.read(id))!.summary.status,'running');assert.deepEqual((await resumed.read(id))!.frames,before.frames);
 resumed.observe(f.final);await resumed.whenIdle();assert.equal((await resumed.read(id))!.summary.status,'ready');
 const completed=(await resumed.read(id))!;resumed.observe(states[0]!);await resumed.whenIdle();assert.deepEqual(await resumed.read(id),completed);
});
test('a matching current running capture resumes immediately after reopening',async t=>{
 const f=await fixture(t),state=f.states.find(state=>deriveRunObservation(state)?.status==='running')!;assert(state);
 const directory=join(f.directory,'current'),repository=new FileRunRepository(directory);await repository.initialize();repository.observe(state);await repository.whenIdle();
 const id=(await repository.list()).runs[0]!.id,before=(await repository.read(id))!;
 const reopened=new FileRunRepository(directory);await reopened.initialize(state);
 assert.equal((await reopened.read(id))!.summary.status,'running');assert.deepEqual((await reopened.read(id))!.frames,before.frames);
 reopened.observe(f.final);await reopened.whenIdle();assert.equal((await reopened.read(id))!.summary.status,'ready');
});
test('a delayed matching running stream resumes an orphan in the same repository without inventing a frame',async t=>{
 const f=await fixture(t),states=f.states.filter(state=>deriveRunObservation(state)?.status==='running');assert(states.length>1);
 const directory=join(f.directory,'delayed-stream'),original=new FileRunRepository(directory);await original.initialize();
 original.observe(states[0]!);original.observe(states.at(-1)!);await original.whenIdle();
 const id=(await original.list()).runs[0]!.id,before=(await original.read(id))!;
 const reopened=new FileRunRepository(directory);await reopened.initialize();assert.equal((await reopened.read(id))!.summary.status,'incomplete');
 reopened.observe(states.at(-1)!);await reopened.whenIdle();const active=(await reopened.read(id))!;
 assert.equal(active.summary.status,'running');assert.deepEqual(active.frames,before.frames);
 assert(!active.limitations.some(text=>text.includes('cannot confirm')));assert(!active.summary.limitations.some(text=>text.includes('cannot confirm')));
 const persisted=new FileRunRepository(directory);await persisted.initialize(states.at(-1)!);assert.deepEqual(await persisted.read(id),active);
 reopened.observe(f.final);await reopened.whenIdle();const completed=(await reopened.read(id))!;assert.equal(completed.summary.status,'ready');assert.equal(completed.frames.length,before.frames.length+1);
 reopened.observe(states[0]!);await reopened.whenIdle();assert.deepEqual(await reopened.read(id),completed);
});
test('native incomplete and failed outcomes cannot resume through a running callback',async t=>{
 const f=await fixture(t),running=f.states.find(state=>deriveRunObservation(state)?.status==='running')!;assert(running);
 const cases:DashboardState[]=[{...f.final,run:{...f.final.run!,report:{outcome:'unconfirmed'}}},{...f.final,run:{...f.final.run!,status:'failed'}}];
 for(const [index,state]of cases.entries()){
  const repository=new FileRunRepository(join(f.directory,'native-terminal-'+index));await repository.initialize();repository.observe(state);await repository.whenIdle();
  const id=(await repository.list()).runs[0]!.id,before=(await repository.read(id))!;assert.equal(before.summary.status,index===0?'incomplete':'failed');
  repository.observe(running);await repository.whenIdle();assert.deepEqual(await repository.read(id),before);
 }
});
test('each published index references one coherent synchronous records and retention snapshot',async t=>{
 const a=await fixture(t),b=await fixture(t),stateA=a.states.find(state=>deriveRunObservation(state)?.status==='running')!;
 const statesB=b.states.filter(state=>deriveRunObservation(state)?.status==='running'),stateB=statesB[0]!,nextB=statesB.find(state=>deriveRunObservation(state)!.nativePosition!==deriveRunObservation(stateB)!.nativePosition)!;assert(nextB);
 const repository=new FileRunRepository(join(a.directory,'batch'),{maxRuns:2});await repository.initialize();
 const writer=repository as unknown as {atomic(path:string,text:string):Promise<void>},atomic=writer.atomic.bind(repository);
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),blocked=new Promise<void>(resolve=>{entered=resolve;});
 let firstBlob=true,firstIndex=true;const mismatches:string[]=[],omitted:number[]=[];
 writer.atomic=async(path,text)=>{
  if(path.endsWith('/index.json')&&firstIndex){firstIndex=false;const index=JSON.parse(text);omitted.push(index.omitted);
   for(const entry of index.entries){const record=JSON.parse(await readFile(join(path.slice(0,path.lastIndexOf('/')),entry.summary.id+'-'+entry.digest+'.json'),'utf8'));if(JSON.stringify(record.summary)!==JSON.stringify(entry.summary))mismatches.push(entry.summary.id);}
  }else if(!path.endsWith('/index.json')&&firstBlob){firstBlob=false;entered();await gate;}
  await atomic(path,text);
 };
 repository.observe(stateA);repository.observe(stateB);await blocked;
 repository.observe(nextB);repository.observe({...stateA,target:{id:'another-registered-target',label:'Another app'}});release();await repository.whenIdle();
 assert.deepEqual(mismatches,[]);assert.deepEqual(omitted,[0]);assert.equal((await repository.list()).omitted,1);
 const reopened=new FileRunRepository(join(a.directory,'batch'));await reopened.initialize(nextB);
 for(const summary of (await reopened.list()).runs)assert(await reopened.read(summary.id));
});
test('application verification persists even when the application has no registered public URL',async t=>{
 const f=await fixture(t),repository=new FileRunRepository(join(f.directory,'no-public-url'));await repository.initialize();
 repository.observe(f.states.find(state=>deriveRunObservation(state)?.status==='running')!);
 const verified:DashboardState={...f.final,appAccess:{status:'ready'}};assert.equal(deriveRunObservation(verified)!.appVerified,true);
 repository.observe(verified);await repository.whenIdle();const summary=(await repository.list()).runs[0]!,record=(await repository.read(summary.id))!;
 assert.equal(summary.status,'ready');assert.equal(summary.appVerified,true);assert.equal(summary.appUrl,undefined);
 assert.deepEqual(record.frames.at(-1)!.state.appAccess,{status:'ready'});assert.equal(record.frames.at(-1)!.state.neoUrl,undefined);
 assert.equal((await repository.list()).limitations.length,0);
});
