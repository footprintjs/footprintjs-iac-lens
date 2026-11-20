import { readDashboardState } from './client.ts';
import type { RunCatalog, RunFrame, RunRecord, RunSummary } from './run-history.ts';
import type { Recording } from './types.ts';
import { runObservationIdentity } from './run-history-identity.ts';
import {readRunFrameDeployment} from './run-history-deployment.ts';
import {readLensDeploymentChart} from './deployment-chart-reader.ts';

export const RUN_CATALOG_MAX_RUNS=128, RUN_RECORD_MAX_FRAMES=128;
function fail():never{throw Error('Invalid recorded run history');}
/** Plain bounded JSON only; persisted viewer state cannot bring executable properties back. */
export function copyRunData(input:unknown):any {
 let nodes=0;const stack=new Set<object>();
 function copy(value:unknown,depth:number):any {
  if(++nodes>1_000_000||depth>256)fail();
  if(value===null||value===undefined||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'){if(!Number.isFinite(value))fail();return value;}
  if(!value||typeof value!=='object'||stack.has(value)||![Object.prototype,Array.prototype,null].includes(Object.getPrototypeOf(value))||Object.getOwnPropertySymbols(value).length)fail();
  stack.add(value);const descriptors=Object.getOwnPropertyDescriptors(value),result:Record<string,unknown>=Object.create(null);
  for(const [key,descriptor]of Object.entries(descriptors)){
   if(Array.isArray(value)&&key==='length')continue;
   if(!descriptor.enumerable||!('value'in descriptor))fail();
   Object.defineProperty(result,key,{value:copy(descriptor.value,depth+1),enumerable:true,writable:true,configurable:true});
  }
  stack.delete(value);
  if(!Array.isArray(value))return Object.fromEntries(Object.entries(result));
  const keys=Object.keys(result);if(keys.length!==value.length||keys.some((key,index)=>key!==String(index)))fail();return keys.map(key=>result[key]);
 }
 return copy(input,0);
}
export function runObject(input:unknown,allowed:readonly string[]):Record<string,any>{
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!allowed.includes(key)))fail();return input as Record<string,any>;
}
export function runText(input:unknown,max=512):string{if(typeof input!=='string'||!input.trim()||input.length>max||/[\x00-\x1f\x7f]/.test(input))fail();return input;}
const count=(input:unknown)=>{if(!Number.isSafeInteger(input)||(input as number)<0)fail();return input as number;};
const clock=(input:unknown)=>{if(typeof input!=='number'||!Number.isFinite(input)||input<0||input>8_640_000_000_000_000)fail();return input;};
const strings=(input:unknown)=>{if(!Array.isArray(input)||input.length>32)fail();return input.map(value=>runText(value,1000));};
export function runOpaqueId(input:unknown):string{if(typeof input!=='string'||!/[a-f0-9]{64}/.test(input)||input.length!==64)fail();return input;}
/** A trusted host supplies a public, secret-free app link. Routing query/hash fragments remain supported. */
export function registeredRunAppUrl(input:unknown):string|undefined {
 try{const value=runText(input,2048),url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return;return value;}catch{return;}
}
function summary(input:unknown):RunSummary {
 const row=runObject(input,['id','runId','targetId','label','versionLabel','kind','status','sequence','frameCount','replayAvailable','timing','startedAt','finishedAt','appUrl','appVerified','limitations']);
 runOpaqueId(row.id);runText(row.runId);runText(row.label,200);if(row.targetId!==undefined)runText(row.targetId);if(row.versionLabel!==undefined)runText(row.versionLabel,200);
 if(!['deployment','workflow','checks','agent'].includes(row.kind)||!['running','ready','failed','incomplete'].includes(row.status)||!['recorded','steps'].includes(row.timing)||typeof row.appVerified!=='boolean'||typeof row.replayAvailable!=='boolean')fail();
 count(row.sequence);count(row.frameCount);if(row.frameCount>RUN_RECORD_MAX_FRAMES||row.replayAvailable&&row.frameCount===0)fail();
 if(row.startedAt!==undefined)clock(row.startedAt);if(row.finishedAt!==undefined)clock(row.finishedAt);
 if(row.finishedAt!==undefined&&row.startedAt!==undefined&&row.finishedAt<row.startedAt)fail();
 if(row.appUrl!==undefined&&(!row.appVerified||row.status!=='ready'||!registeredRunAppUrl(row.appUrl)))fail();
 if(row.appVerified&&row.status!=='ready')fail();strings(row.limitations);return row as RunSummary;
}
export function readRunSummary(input:unknown):RunSummary{return summary(copyRunData(input));}
export function readRunCatalog(input:unknown):RunCatalog {
 const row=runObject(copyRunData(input),['version','runs','omitted','limitations']);
 if(row.version!==1||!Array.isArray(row.runs)||row.runs.length>RUN_CATALOG_MAX_RUNS)fail();count(row.omitted);strings(row.limitations);
 const runs=row.runs.map(summary);if(new Set(runs.map((run:RunSummary)=>run.id)).size!==runs.length)fail();return{version:1,runs,omitted:row.omitted,limitations:row.limitations};
}
function recording(input:unknown,runId:string,graphDigest?:string):Recording {
 const row=runObject(input,['snapshot','structure','narrativeEntries','provenance','controlDeps']);
 if(!row.snapshot||typeof row.snapshot!=='object'||Array.isArray(row.snapshot)||!row.structure||typeof row.structure!=='object'||Array.isArray(row.structure))fail();runText(row.snapshot.runId);
 if(row.provenance!==undefined){const provenance=runObject(row.provenance,['runId','stack','graphDigest']);if(provenance.runId!==runId)fail();if(provenance.stack!==undefined)runText(provenance.stack);if(provenance.graphDigest!==undefined&&(!/^[a-f0-9]{64}$/.test(provenance.graphDigest)||provenance.graphDigest!==graphDigest))fail();}
 else if(row.snapshot.runId!==runId)fail();
 if(row.narrativeEntries!==undefined&&(!Array.isArray(row.narrativeEntries)||row.narrativeEntries.length>100_000))fail();return row as Recording;
}
export function readRunRecord(input:unknown):RunRecord {
 const row=runObject(copyRunData(input),['version','summary','frames','omittedFrames','limitations','recording','deploymentSchedule']);
 if(row.version!==1||!Array.isArray(row.frames)||row.frames.length>RUN_RECORD_MAX_FRAMES)fail();const head=summary(row.summary);count(row.omittedFrames);strings(row.limitations);
 if(head.frameCount!==row.frames.length)fail();let previous=0,previousClock:number|undefined,identity:string|undefined;
 const positions=new Set<string>();
 const frames:RunFrame[]=row.frames.map((input:unknown)=>{
  const frame=runObject(input,['sequence','nativePosition','caption','recordedAt','state','deployment']);count(frame.sequence);if(frame.sequence<=previous)fail();previous=frame.sequence;
  runText(frame.nativePosition,262144);runText(frame.caption,240);if(positions.has(frame.nativePosition))fail();positions.add(frame.nativePosition);
  const state=readDashboardState(frame.state);if(state.run?.id!==head.runId&&state.resourceFlow?.executionId!==head.runId)fail();
  if(frame.deployment!==undefined)readRunFrameDeployment(frame.deployment,state);
  const target=state.onboarding?.targetId??state.application?.selection?.targetId??state.target?.id??state.resourceFlow?.target.id;if(head.targetId!==undefined&&target!==head.targetId)fail();
  const frameIdentity=runObservationIdentity(state,head.runId);if(identity!==undefined&&identity!==frameIdentity)fail();identity=frameIdentity;
  if(frame.recordedAt!==undefined){clock(frame.recordedAt);if(previousClock!==undefined&&frame.recordedAt<previousClock&&head.timing==='recorded')fail();previousClock=frame.recordedAt;}
  if(head.timing==='recorded'&&frame.recordedAt===undefined)fail();
  return frame as RunFrame;
 });
 if(head.appVerified){
  const last=frames.at(-1)?.state,onb=last?.onboarding,app=last?.application;
  const verified=onb?onb.status==='ready'&&onb.deployment?.promoted===true:app?app.phase==='ready'&&app.deployment?.promoted===true:last?.appAccess?.status==='ready';
  if(!verified||head.appUrl!==undefined&&registeredRunAppUrl(last?.neoUrl??app?.deployment?.appUrl)!==head.appUrl)fail();
 }
 let deploymentSchedule:RunRecord['deploymentSchedule'];
 if(row.deploymentSchedule!==undefined){
  const entry=runObject(row.deploymentSchedule,['firstSequence','chart']),firstSequence=count(entry.firstSequence),chart=readLensDeploymentChart(entry.chart);
  const last=frames.at(-1);
  if(!firstSequence||!last||firstSequence>last.sequence||chart.runId!==head.runId||chart.stack!==last.state.graph?.name||chart.graphDigest!==last.state.graph?.digest||!chart.resources.some(resource=>resource.schedule))fail();
  deploymentSchedule={firstSequence,chart};
 }
 return{version:1,summary:head,frames,omittedFrames:row.omittedFrames,limitations:row.limitations,...row.recording!==undefined?{recording:recording(row.recording,head.runId,frames[0]?.state.graph?.digest)}:{},...deploymentSchedule?{deploymentSchedule}:{}};
}
