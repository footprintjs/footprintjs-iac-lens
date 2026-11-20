import assert from 'node:assert/strict';
import test from 'node:test';
import { compileGraph } from 'footprintjs-iac/graph';
import { deriveRunObservation, readRunCatalog, readRunRecord, registeredRunAppUrl, type RunRecord, type RunSummary } from '../src/core/run-history.ts';
import type { DashboardState } from '../src/core/types.ts';
import type {OnboardingSnapshot} from '../src/core/onboarding.ts';
import {createRunHistoryClient} from '../src/core/run-history.ts';

const graph=compileGraph({name:'recorded-app',resources:[{id:'services',provider:'registered',spec:{kind:'Service'}}],boundaries:[],memberships:[],relations:[]});
const state=():DashboardState=>({revision:1,busy:true,graph,target:{id:'registered-target',label:'My application'},run:{id:'deployment-one',status:'running',resources:[{id:'services',status:'deploying'}],events:[{version:1,runId:'deployment-one',sequence:1,timestamp:1000,runtimeStageId:'execute-services#0',resourceId:'services',status:'deploying'}],recording:{snapshot:{runId:'native-one',commitLog:[]},structure:{id:'root'},provenance:{runId:'deployment-one',stack:graph.name,graphDigest:graph.digest}}}});
const summary=():RunSummary=>({id:'a'.repeat(64),runId:'deployment-one',label:'My application',targetId:'registered-target',kind:'deployment',status:'running',sequence:1,frameCount:1,replayAvailable:true,timing:'recorded',startedAt:1000,appVerified:false,limitations:[]});
const record=():RunRecord=>({version:1,summary:summary(),frames:[{sequence:1,nativePosition:'native-position-one',caption:'Updating your setup',recordedAt:1000,state:state()}],omittedFrames:0,limitations:[]});

test('run observations follow native progress positions, not browser revisions or wall clocks',()=>{
 const first=deriveRunObservation(state())!;assert.equal(first.runId,'deployment-one');assert.equal(first.recordedAt,1000);assert.equal(first.status,'running');
 const next=state();next.revision=99;assert.equal(deriveRunObservation(next)!.nativePosition,first.nativePosition);
 next.run!.events.push({...next.run!.events[0]!,sequence:2,timestamp:1500,status:'ready'});
 assert.notEqual(deriveRunObservation(next)!.nativePosition,first.nativePosition);assert.equal(deriveRunObservation(next)!.recordedAt,1500);
});
test('native domain, physical target, graph and configuration identity cannot be spliced',()=>{
 const first=deriveRunObservation(state())!;
 const foreign=state();foreign.run!.recording!.provenance!.runId='other';assert.equal(deriveRunObservation(foreign),undefined);
 const target=state();target.target!.id='another';assert.notEqual(deriveRunObservation(target)!.identity,first.identity);
 const none=state();delete none.run!.recording;none.run!.events=[];assert.equal(deriveRunObservation(none),undefined);
});
test('a completed resource run does not claim the application was verified or expose a premature URL',()=>{
 const value=state();value.busy=false;value.run!.status='passed';value.neoUrl='https://app.example.test';
 const completed=deriveRunObservation(value)!;assert.equal(completed.status,'ready');assert.equal(completed.appVerified,false);assert.equal(completed.appUrl,undefined);
 value.appAccess={status:'ready'};const verified=deriveRunObservation(value)!;assert.equal(verified.appVerified,true);assert.equal(verified.appUrl,value.neoUrl);
});
test('a confirmed removal reports absence instead of resurfacing a previous ready link',()=>{
 const value=state(),run=value.run!;
 run.resources[0]!.action='delete';run.events[0]!.action='delete';
 assert.equal(deriveRunObservation(value)?.caption,'Removing your setup');
 run.status='passed';run.resources[0]!.status='deleted';
 run.events.push({...run.events[0]!,sequence:2,status:'deleted'});
 value.appAccess={status:'ready'};value.neoUrl='https://app.example.test';
 const done=deriveRunObservation(value)!;
 assert.equal(done.caption,'Removal verified');
 assert.equal(done.appVerified,false);
 assert.equal(done.appUrl,undefined);
});
test('registered production URLs are allowed, while credentials and executable URLs are refused',()=>{
 assert.equal(registeredRunAppUrl('https://neo.example.test/app'),'https://neo.example.test/app');
 for(const value of ['javascript:alert(1)','data:text/html,hi','https://user:password@app.example.test'])assert.equal(registeredRunAppUrl(value),undefined);
});
test('registered query and hash routes remain intact and are never fetched by the URL reader',()=>{
 for(const url of ['https://app.example.test/?workspace=operations','https://app.example.test/#/request-lifecycle/9','http://127.0.0.1:1234/?view=status#/runs/recent'])assert.equal(registeredRunAppUrl(url),url);
 const value=record();value.summary.status='ready';value.summary.appVerified=true;value.summary.appUrl='https://app.example.test/?view=status#/runs/recent';value.frames[0]!.state.appAccess={status:'ready'};value.frames[0]!.state.neoUrl=value.summary.appUrl;
 assert.equal(readRunRecord(value).summary.appUrl,value.summary.appUrl);
});
test('catalog and archive readers detach input and keep replay data read-only',()=>{
 const original=record(),value=readRunRecord(original);original.frames[0]!.caption='changed';assert.equal(value.frames[0]!.caption,'Updating your setup');
 assert.equal(readRunCatalog({version:1,runs:[summary()],omitted:0,limitations:[]}).runs.length,1);
 const foreign=record();foreign.frames[0]!.state.run!.id='other-run';assert.throws(()=>readRunRecord(foreign));
 const reordered=record();reordered.frames.push({...reordered.frames[0]!});reordered.summary.frameCount=2;assert.throws(()=>readRunRecord(reordered));
 const timed=record();delete timed.frames[0]!.recordedAt;assert.throws(()=>readRunRecord(timed));
});
test('readers reject accessors without executing them and reject unsafe paths as run identifiers',()=>{
 let reads=0;const value=record();Object.defineProperty(value.summary,'label',{enumerable:true,get(){reads++;return 'private';}});assert.throws(()=>readRunRecord(value));assert.equal(reads,0);
 for(const id of ['../private','constructor','/tmp/native.json','abc'])assert.throws(()=>readRunCatalog({version:1,runs:[{...summary(),id}],omitted:0,limitations:[]}));
});

function onboarding(ready=false):OnboardingSnapshot {
 const labels=['Discover system','Configure connection','Verify connections','Review changes','Deploy and test'];
 return{id:'application-setup',label:'My application',strategyId:'registered',targetId:'registered-target',configurationDigest:'b'.repeat(64),status:ready?'ready':'reviewed',busy:!ready,
  stages:['discover','configure','verify','review','deploy'].map((id,index)=>({id:id as OnboardingSnapshot['stages'][number]['id'],label:labels[index]!,status:index===4&&!ready?'running':'passed'})),checks:[],canDiscover:false,canConfigure:false,canVerify:false,canReview:false,canDeploy:false,canReconcile:false,
  ...(ready?{deployment:{ok:true,promoted:true,status:'promoted'}}:{}),recording:{runId:ready?'onboarding-final':'onboarding-deploy'}};
}
test('one deployment identity survives verification child segments without inventing their elapsed clock',()=>{
 const value=state();value.run!.status='passed';value.onboarding=onboarding();value.neoUrl='https://app.example.test';
 const pending=deriveRunObservation(value)!;assert.equal(pending.status,'running');assert.equal(pending.appVerified,false);assert.equal(pending.recordedAt,undefined);assert.equal(pending.startedAt,1000);
 value.busy=false;value.onboarding=onboarding(true);
 const final=deriveRunObservation(value)!;assert.equal(final.identity,pending.identity);assert.notEqual(final.nativePosition,pending.nativePosition);assert.equal(final.status,'ready');assert.equal(final.appVerified,true);assert.equal(final.finishedAt,undefined);assert.equal(final.appUrl,value.neoUrl);
});
test('a global viewer busy flag cannot restart an earlier completed run',()=>{
 const value=state();value.run!.status='passed';value.busy=false;const completed=deriveRunObservation(value)!;
 value.busy=true;const otherWork=deriveRunObservation(value)!;assert.equal(otherWork.status,'ready');assert.equal(otherWork.nativePosition,completed.nativePosition);
});
test('archive links require the captured verification projection, not just a summary boolean',()=>{
 const value=record();value.summary.status='ready';value.summary.appVerified=true;value.summary.appUrl='https://app.example.test';
 assert.throws(()=>readRunRecord(value));
 value.frames[0]!.state.appAccess={status:'ready'};value.frames[0]!.state.neoUrl=value.summary.appUrl;
 assert.equal(readRunRecord(value).summary.appUrl,value.summary.appUrl);
 value.frames[0]!.state.neoUrl='https://other.example.test';assert.throws(()=>readRunRecord(value));
});
test('archive frames cannot splice another graph or foreign native proof into the same domain run',()=>{
 const value=record();value.summary.frameCount=2;
 const second=state();second.graph=compileGraph({name:'changed',resources:[{id:'different',provider:'registered',spec:{}}],boundaries:[],memberships:[],relations:[]});
 value.frames.push({sequence:2,nativePosition:'another-position',caption:'Checking',recordedAt:1500,state:second});assert.throws(()=>readRunRecord(value));
 const foreign=record();foreign.recording={snapshot:{runId:'foreign-sdk'},structure:{id:'root'}};assert.throws(()=>readRunRecord(foreign));
});
test('run-history client performs GETs only and rejects path-like IDs before a request',async()=>{
 const calls:{url:string;method?:string}[]=[],client=createRunHistoryClient({baseUrl:'http://127.0.0.1:1234/',async fetch(url,options){calls.push({url,method:options?.method});return{ok:true,status:200,async json(){return url.endsWith('/api/runs')?{version:1,runs:[summary()],omitted:0,limitations:[]}:record();}};}});
 assert.equal((await client.list()).runs.length,1);assert.equal((await client.read('a'.repeat(64)))!.frames.length,1);
 assert(calls.every(call=>call.method==='GET'));await assert.rejects(()=>client.read('../state'));assert.equal(calls.length,2);
});
test('clocked native stage events must match the owning SDK run and have loss-free capture',()=>{
 const value=state(),snapshot=value.run!.recording!.snapshot as Record<string,unknown>;
 const data={version:1,runId:'native-one',droppedEvents:0,observerFailures:0,events:[{sequence:1,type:'start',runtimeStageId:'actual-step#0',timestamp:2000}]};
 snapshot.recorders=[{id:'iac-native-stage-progress',data}];assert.equal(deriveRunObservation(value)!.recordedAt,2000);
 data.runId='foreign-sdk';assert.equal(deriveRunObservation(value)!.recordedAt,1000);
 data.runId='native-one';data.droppedEvents=1;assert.equal(deriveRunObservation(value)!.recordedAt,1000);
 value.run!.status='passed';value.busy=false;assert.equal(deriveRunObservation(value)!.finishedAt,undefined,'an earlier resource timestamp does not become a run-end clock');
});
