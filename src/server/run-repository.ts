import {createHash,randomUUID} from 'node:crypto';
import {mkdir,lstat,readFile,writeFile,rename,open,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {deriveRunObservation,readRunCatalog,readRunRecord,type RunCatalog,type RunRecord,type RunRepository,type RunSummary} from '../core/run-history.ts';
import type {DashboardState} from '../core/types.ts';
import {runFrameState} from './run-frame-state.ts';
import {runFrameDeployment} from './run-frame-deployment.ts';
import { readLensDeploymentChart } from '../core/deployment-chart-reader.ts';

const MAX_BYTES=32*1024*1024;
const UNCONFIRMED_CAPTURE='This viewer cannot confirm that the earlier running capture is still active. Its recorded progress is retained; no provider outcome is inferred.';
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const validId=(id:string)=>/^[a-f0-9]{64}$/.test(id);
interface Entry {summary:RunSummary;digest:string}
interface Index {version:1;entries:Entry[];omitted:number}
async function readFileBounded(path:string,max=MAX_BYTES){const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>max)throw Error('Run archive is not a bounded regular file');return readFile(path,'utf8');}

/** Derived viewer history. Reopening or seeking this repository never invokes a deployment or check. */
export class FileRunRepository implements RunRepository {
 private readonly directory:string;
 private entries:Entry[]=[];
 private readonly records=new Map<string,RunRecord>();
 private readonly changed=new Set<string>();
 private completion:Promise<void>=Promise.resolve();
 private scheduled=false;
 private blocked=false;
 private diskDigest:string|undefined;
 private diskEntries:Entry[]=[];
 private readonly ownedBlobs=new Set<string>();
 private readonly written=new Map<string,RunRecord>();
 private readonly limits:{maxRuns?:number;maxFrames?:number};
 private omitted=0;
 private limitations:string[]=[];
 constructor(directory:string,limits:{maxRuns?:number;maxFrames?:number}={}){
  this.limits=limits;
  this.directory=resolve(directory,'runs');
  if((limits.maxRuns!==undefined&&(!Number.isInteger(limits.maxRuns)||limits.maxRuns<1||limits.maxRuns>12))||(limits.maxFrames!==undefined&&(!Number.isInteger(limits.maxFrames)||limits.maxFrames<2||limits.maxFrames>128)))throw Error('Bound run history retention');
 }
 async initialize(state?:DashboardState):Promise<void>{
  await mkdir(this.directory,{recursive:true,mode:0o700});const info=await lstat(this.directory);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Run archive needs its registered private directory');
  try{
   const text=await readFileBounded(join(this.directory,'index.json'),1024*1024),index=JSON.parse(text) as Index;
   if(index.version!==1||!Array.isArray(index.entries)||index.entries.length>12||!Number.isSafeInteger(index.omitted)||index.omitted<0||Object.keys(index).some(key=>!['version','entries','omitted'].includes(key)))throw Error('Invalid run history index');
   const catalog=readRunCatalog({version:1,runs:index.entries.map(row=>row.summary),omitted:index.omitted,limitations:[]});
   for(const entry of index.entries)if(Object.keys(entry).some(key=>!['summary','digest'].includes(key))||!validId(entry.digest))throw Error('Invalid run history checksum');
   this.entries=index.entries.map((row,index)=>({...row,summary:catalog.runs[index]!}));this.diskEntries=this.entries.map(row=>({...row}));this.omitted=index.omitted;this.diskDigest=digest(text);
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'){this.blocked=true;this.limitations.push('Earlier run history could not be read. Its files are retained; new observations are available in this session only.');}}
  if(state&&!this.entries.length&&!this.blocked)this.seedSummaries(state);
  await this.reopenCaptures(state);if(state)this.observe(state);await this.whenIdle();
 }
 async list():Promise<RunCatalog>{return readRunCatalog({version:1,runs:this.entries.map(row=>row.summary).sort((a,b)=>b.sequence-a.sequence),omitted:this.omitted,limitations:this.limitations});}
 async read(id:string):Promise<RunRecord|undefined>{
  if(!validId(id))return;
  const entry=this.entries.find(row=>row.summary.id===id);if(!entry)return;
  const held=this.records.get(id);if(held)return readRunRecord(structuredClone(held));
  const text=await readFileBounded(join(this.directory,id+'-'+entry.digest+'.json'));
  if(digest(text)!==entry.digest)throw Error('Run archive checksum differs; the original file is retained');
  const value=readRunRecord(JSON.parse(text));
  if(JSON.stringify(value.summary)!==JSON.stringify(entry.summary))throw Error('Run archive belongs to another history entry');
  return value;
 }
 observe(state:DashboardState):void{
  try{
   const next=deriveRunObservation(state);if(!next)return;
   const id=digest(next.identity),entry=this.entries.find(row=>row.summary.id===id);let prior=this.records.get(id);
   // Terminal outcomes are immutable. A delayed callback cannot turn their results green or active again.
   if(entry&&!prior)return;
   if(prior&&prior.summary.status!=='running'){
    if(prior.summary.status!=='incomplete'||!prior.summary.limitations.includes(UNCONFIRMED_CAPTURE)||next.status!=='running')return;
    // A matching active stream can resolve viewer-only uncertainty without fabricating another native observation.
    prior=readRunRecord({...prior,summary:{...prior.summary,status:'running',limitations:prior.summary.limitations.filter(text=>text!==UNCONFIRMED_CAPTURE)},limitations:prior.limitations.filter(text=>text!==UNCONFIRMED_CAPTURE)});
    this.records.set(id,prior);entry!.summary=prior.summary;this.changed.add(id);this.schedule();
   }
   if(prior?.frames.at(-1)?.nativePosition===next.nativePosition)return;
   const sequence=entry?.summary.sequence??Math.max(0,...this.entries.map(row=>row.summary.sequence))+1;
   const frameState=runFrameState(state,next);
   const frame={sequence:(prior?.frames.at(-1)?.sequence??0)+1,nativePosition:next.nativePosition,caption:next.caption,...next.recordedAt===undefined?{}:{recordedAt:next.recordedAt},state:frameState,deployment:runFrameDeployment(state,frameState)};
   let frames=[...prior?.frames??[],frame],omittedFrames=prior?.omittedFrames??0;
   const maximum=this.limits.maxFrames??128;if(frames.length>maximum){omittedFrames+=frames.length-maximum;frames=[frames[0]!,...frames.slice(-(maximum-1))];}
   const clocked=frames.every((row,index)=>row.recordedAt!==undefined&&(index===0||row.recordedAt>=frames[index-1]!.recordedAt!));
   const summary:RunSummary={id,runId:next.runId,label:next.label,kind:next.kind,status:next.status,sequence,frameCount:frames.length,replayAvailable:frames.length>1,timing:clocked?'recorded':'steps',
    ...next.targetId?{targetId:next.targetId}:{},...next.versionLabel?{versionLabel:next.versionLabel}:{},
    ...(next.startedAt??prior?.summary.startedAt)===undefined?{}:{startedAt:next.startedAt??prior?.summary.startedAt},
    ...next.finishedAt!==undefined?{finishedAt:next.finishedAt}:{},
    ...next.appUrl?{appUrl:next.appUrl}:{},appVerified:next.appVerified,limitations:[...next.limitations,...omittedFrames?['Some intermediate progress updates are outside this bounded replay. The native recording is retained separately.']:[]]};
   const native=next.status!=='running'?(state.run?.recording??state.recording):undefined;
   let deploymentSchedule=prior?.deploymentSchedule;
   if(!deploymentSchedule&&state.run?.chart?.runId===next.runId){
    try{
     const chart=readLensDeploymentChart(state.run.chart);
     if(chart.stack===state.graph?.name&&chart.graphDigest===state.graph?.digest&&chart.resources.some(resource=>resource.schedule))deploymentSchedule={firstSequence:frame.sequence,chart};
    }catch{/* Retain the original progress if this optional chart cannot be admitted. */}
   }
   const record=readRunRecord({version:1,summary,frames,omittedFrames,limitations:summary.limitations,...native?{recording:native}:{},...deploymentSchedule?{deploymentSchedule}:{}});
   this.records.set(id,record);this.entries=[...this.entries.filter(row=>row.summary.id!==id),{summary:record.summary,digest:entry?.digest??''}];this.changed.add(id);
   const excess=Math.max(0,this.entries.length-(this.limits.maxRuns??12));if(excess){const removed=this.entries.sort((a,b)=>a.summary.sequence-b.summary.sequence).splice(0,excess);this.omitted+=excess;for(const old of removed){this.records.delete(old.summary.id);this.changed.delete(old.summary.id);}}
   this.schedule();
  }catch{if(!this.limitations.includes('Some native progress could not be added to run history. The current run and its original evidence remain available.'))this.limitations.push('Some native progress could not be added to run history. The current run and its original evidence remain available.');}
 }
 whenIdle():Promise<void>{return this.completion;}
 private async reopenCaptures(state?:DashboardState):Promise<void>{
  const next=state&&deriveRunObservation(state),currentId=next&&digest(next.identity);
  for(const entry of this.entries){
   if(entry.summary.status!=='running'&&entry.summary.id!==currentId)continue;
   try{
    let record=await this.read(entry.summary.id);if(!record)continue;
    const orphaned=record.summary.status==='incomplete'&&record.summary.limitations.includes(UNCONFIRMED_CAPTURE);
    if(entry.summary.id===currentId&&orphaned&&next?.status!=='incomplete'){
     const limitations=record.limitations.filter(text=>text!==UNCONFIRMED_CAPTURE);
     record=readRunRecord({...record,summary:{...record.summary,status:'running',limitations:record.summary.limitations.filter(text=>text!==UNCONFIRMED_CAPTURE)},limitations});
    }else if(entry.summary.id!==currentId&&record.summary.status==='running'){
     const {appUrl:_appUrl,finishedAt:_finishedAt,...previous}=record.summary;
     const limitations=[...record.limitations,UNCONFIRMED_CAPTURE];
     record=readRunRecord({...record,summary:{...previous,status:'incomplete',appVerified:false,limitations:[...record.summary.limitations,UNCONFIRMED_CAPTURE]},limitations});
    }
    this.records.set(entry.summary.id,record);
    if(JSON.stringify(entry.summary)!==JSON.stringify(record.summary)){entry.summary=record.summary;this.changed.add(entry.summary.id);}
   }catch{this.limitations.push('A saved run could not be reopened. Its archive is retained; its continuation is not confirmed.');}
  }
  if(this.changed.size)this.schedule();
 }
 private seedSummaries(state:DashboardState):void{
  for(const row of state.recordedDiagnostics?.runs??[]){
   if(row.kind!=='deployment'||row.runId===state.run?.id)continue;
   const id=digest(JSON.stringify({source:'recorded-diagnostic-summary',binding:state.recordedDiagnostics!.binding,runId:row.runId,runtimeRunId:row.runtimeRunId}));
   if(this.entries.some(entry=>entry.summary.runId===row.runId))continue;
   const summary:RunSummary={id,runId:row.runId,label:state.onboarding?.label??state.target?.label??'Application update',kind:'deployment',status:row.outcome==='passed'?'ready':'failed',sequence:this.entries.length+1,frameCount:0,replayAvailable:false,timing:'steps',appVerified:false,limitations:['Only the saved result is available for this earlier run. Progress replay was not captured by this viewer.'],...state.target?.id?{targetId:state.target.id}:{}};
   const record=readRunRecord({version:1,summary,frames:[],omittedFrames:0,limitations:summary.limitations});this.entries.push({summary:record.summary,digest:''});this.records.set(id,record);this.changed.add(id);
  }
  if(this.changed.size)this.schedule();
 }
 private schedule():void{
  if(this.scheduled||this.blocked)return;this.scheduled=true;
  this.completion=this.completion.then(async()=>{
   while(this.changed.size){
    const file=join(this.directory,'index.json'),lock=join(this.directory,'index.lock');let handle;
    try{
     handle=await open(lock,'wx',0o600);
     const current=await readFileBounded(file,1024*1024).catch(error=>{if(error.code==='ENOENT')return;throw error;});
     if((current===undefined?undefined:digest(current))!==this.diskDigest)throw Error('Another writer changed the run history');
     const ids=[...this.changed];this.changed.clear();
     const entries=this.entries.map(row=>({...row})),records=new Map(ids.map(id=>[id,this.records.get(id)])),omitted=this.omitted,batch=new Map<string,RunRecord>();
     for(const id of ids){const record=records.get(id),entry=entries.find(row=>row.summary.id===id);if(!record||!entry)continue;
      const text=JSON.stringify(record)+'\n';if(Buffer.byteLength(text)>MAX_BYTES)throw Error('Run archive exceeds its bound');
      entry.digest=digest(text);const path=join(this.directory,id+'-'+entry.digest+'.json');
      try{if(await readFileBounded(path)!==text)throw Error('Run archive checksum differs');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await this.atomic(path,text);this.ownedBlobs.add(path);}
      batch.set(id,record);
     }
     const text=JSON.stringify({version:1,entries,omitted})+'\n';await this.atomic(file,text);this.diskDigest=digest(text);
     const previous=this.diskEntries;this.diskEntries=entries;
     for(const entry of entries){const current=this.entries.find(row=>row.summary.id===entry.summary.id);if(current?.summary===entry.summary)current.digest=entry.digest;}
     // Remove only this process's superseded cache blobs when the replacement retains every original progress frame.
     for(const [id,record] of batch){const old=previous.find(row=>row.summary.id===id),prior=this.written.get(id);this.written.set(id,record);
      if(!old||!prior)continue;const oldPath=join(this.directory,id+'-'+old.digest+'.json');
      if(old.digest!==entries.find(row=>row.summary.id===id)?.digest&&this.ownedBlobs.has(oldPath)&&prior.frames.every(frame=>record.frames.some(next=>next.sequence===frame.sequence&&next.nativePosition===frame.nativePosition))){
       if(digest(await readFileBounded(oldPath))===old.digest)await unlink(oldPath);
       this.ownedBlobs.delete(oldPath);
      }
     }
    }finally{if(handle){await handle.close();await unlink(lock);}}
   }
  }).catch(()=>{this.blocked=true;this.limitations.push('Run history could not be saved. Earlier archives are retained; this session can still show new progress.');}).finally(()=>{this.scheduled=false;if(this.changed.size&&!this.blocked)this.schedule();});
 }
 private async atomic(path:string,text:string):Promise<void>{const temporary=path+'.'+randomUUID()+'.next';try{await writeFile(temporary,text,{flag:'wx',mode:0o600});await rename(temporary,path);}finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}}
}
