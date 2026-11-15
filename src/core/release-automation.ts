import {readPipelineExecution,type PipelineExecutionView} from './pipeline.ts';
import type {Recording} from './types.ts';

export interface ReleaseAutomationChoice {id:string;label:string;version?:string;publishedAt?:string;commit?:string}
export interface ReleaseAutomationAttemptView {
  id:string;releaseId:string;label:string;version?:string;commit?:string;trigger:'manual'|'automatic';
  status:'reserved'|'resolving'|'preparing'|'deploying'|'waiting'|'passed'|'failed'|'incomplete'|'skipped';
  build:{id:string;label:string;status:'pending'|'running'|'passed'|'failed'}[];
  pipeline?:PipelineExecutionView;recording?:Recording;
}
export interface ReleaseAutomationView {
  id:string;label:string;automatic:boolean;initialized:boolean;busy:boolean;discoveryStatus:'not-checked'|'available'|'unavailable';
  lastCheckedAt?:number;choices:ReleaseAutomationChoice[];attempts:ReleaseAutomationAttemptView[];
  stages:{id:string;label:string;promotion:'automatic'|'manual';rollback:'disabled'|'manual'|'automatic'}[];
  error?:string;
}
export type ReleaseAutomationAction={action:'refresh';hostId:string}|{action:'deploy';hostId:string;releaseId:string}|{action:'promote'|'recover';hostId:string;attemptId:string;stageId:string};
function object(input:unknown,keys:string[]):Record<string,unknown>{
  if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input))||Object.getOwnPropertySymbols(input).length
    ||Object.entries(Object.getOwnPropertyDescriptors(input)).some(([key,value])=>!keys.includes(key)||!value.enumerable||!('value'in value)))throw Error('Invalid release control fields');
  return input as Record<string,unknown>;
}
function id(input:unknown):string{if(typeof input!=='string'||!/^[-A-Za-z0-9_.:]{1,160}$/.test(input))throw Error('Choose a registered release ID');return input;}
function text(input:unknown):string{if(typeof input!=='string'||!input.trim()||input.length>400||/[\x00-\x1f\x7f]/.test(input))throw Error('Invalid release label');return input;}
function choice(input:unknown):ReleaseAutomationChoice{const value=object(input,['id','label','version','publishedAt','commit']);return{id:id(value.id),label:text(value.label),...(value.version!==undefined?{version:text(value.version)}:{}),...(value.publishedAt!==undefined?{publishedAt:text(value.publishedAt)}:{}),...(value.commit!==undefined?{commit:text(value.commit)}:{})};}
export function readReleaseAutomationAction(input:unknown):ReleaseAutomationAction{
  const value=object(input,['action','hostId','releaseId','attemptId','stageId']);const hostId=id(value.hostId);
  if(value.action==='refresh'&&Object.keys(value).length===2)return{action:'refresh',hostId};
  if(value.action==='deploy'&&Object.keys(value).length===3)return{action:'deploy',hostId,releaseId:id(value.releaseId)};
  if((value.action==='promote'||value.action==='recover')&&Object.keys(value).length===4)return{action:value.action,hostId,attemptId:id(value.attemptId),stageId:id(value.stageId)};
  throw Error('Choose a release action');
}
export function readReleaseAutomationView(input:unknown):ReleaseAutomationView{
  const value=object(input,['id','label','automatic','initialized','busy','discoveryStatus','lastCheckedAt','choices','attempts','stages','error']);
  if(typeof value.automatic!=='boolean'||typeof value.initialized!=='boolean'||typeof value.busy!=='boolean'||!['not-checked','available','unavailable'].includes(String(value.discoveryStatus))
    ||!Array.isArray(value.choices)||value.choices.length>1000||!Array.isArray(value.attempts)||value.attempts.length>1000||!Array.isArray(value.stages)||!value.stages.length||value.stages.length>12)throw Error('Invalid release host view');
  const stages=value.stages.map(input=>{const row=object(input,['id','label','promotion','rollback']);if(!['manual','automatic'].includes(String(row.promotion))||!['disabled','manual','automatic'].includes(String(row.rollback)))throw Error('Invalid release environment');return{id:id(row.id),label:text(row.label),promotion:row.promotion as 'manual'|'automatic',rollback:row.rollback as 'disabled'|'manual'|'automatic'};});
  const attempts=value.attempts.map(input=>{const row=object(input,['id','releaseId','label','version','commit','trigger','status','build','pipeline','recording']);
    if(!['manual','automatic'].includes(String(row.trigger))||!['reserved','resolving','preparing','deploying','waiting','passed','failed','incomplete','skipped'].includes(String(row.status))||!Array.isArray(row.build)||row.build.length>16)throw Error('Invalid release attempt');
    const build=row.build.map(input=>{const step=object(input,['id','label','status']);if(!['pending','running','passed','failed'].includes(String(step.status)))throw Error('Invalid build status');return{id:id(step.id),label:text(step.label),status:step.status as 'pending'|'running'|'passed'|'failed'};});
    return{id:id(row.id),releaseId:id(row.releaseId),label:text(row.label),...(row.version!==undefined?{version:text(row.version)}:{}),...(row.commit!==undefined?{commit:text(row.commit)}:{}),trigger:row.trigger as 'manual'|'automatic',status:row.status as ReleaseAutomationAttemptView['status'],build,...(row.pipeline?{pipeline:readPipelineExecution(row.pipeline)}:{}),...(row.recording?{recording:structuredClone(row.recording) as Recording}:{})};
  });
  const choices=value.choices.map(choice);
  for(const ids of [choices.map(item=>item.id),attempts.map(item=>item.id),stages.map(item=>item.id),...attempts.map(attempt=>attempt.build.map(step=>step.id))])if(new Set(ids).size!==ids.length)throw Error('Duplicate release view identity');
  for(const attempt of attempts)if(attempt.pipeline&&(attempt.pipeline.releaseId!==attempt.releaseId||attempt.pipeline.stages.length!==stages.length||attempt.pipeline.stages.some((stage,index)=>stage.id!==stages[index]?.id)))throw Error('Release pipeline differs from its host or attempt');
  if(value.lastCheckedAt!==undefined&&(!Number.isFinite(value.lastCheckedAt)||Number(value.lastCheckedAt)<0))throw Error('Invalid release check time');
  return{id:id(value.id),label:text(value.label),automatic:value.automatic,initialized:value.initialized,busy:value.busy,discoveryStatus:value.discoveryStatus as ReleaseAutomationView['discoveryStatus'],choices,attempts,stages,...(value.lastCheckedAt!==undefined?{lastCheckedAt:Number(value.lastCheckedAt)}:{}),...(value.error!==undefined?{error:text(value.error)}:{})};
}
