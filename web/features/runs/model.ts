import type {DashboardState} from '../../../src/core/types.ts';
import {registeredRunAppUrl,type RunCatalog,type RunFrame,type RunRecord,type RunSummary} from '../../../src/core/run-history.ts';

export function orderedRuns(catalog:RunCatalog):RunSummary[]{return [...catalog.runs].sort((a,b)=>b.sequence-a.sequence||a.id.localeCompare(b.id));}
export function runStatusText(run:Pick<RunSummary,'status'|'appVerified'>):string {
 return run.status==='running'?'In progress':run.status==='ready'?(run.appVerified?'Ready':'Completed'):run.status==='failed'?'Needs help':'Not confirmed';
}
export function runTimeText(run:Pick<RunSummary,'startedAt'>):string|undefined {
 return run.startedAt===undefined?undefined:new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(run.startedAt));
}
export function recordedFrame(record:RunRecord,index:number):RunFrame|undefined {
 const bounded=Number.isFinite(index)?Math.min(record.frames.length-1,Math.max(0,Math.trunc(index))):0;
 return record.frames[bounded];
}
/** A previous run never borrows the current application's state or healthy URL. */
export function isCurrentRun(summary:RunSummary,state:DashboardState,record?:RunRecord):boolean {
 if(summary.runId!==state.run?.id||summary.targetId&&summary.targetId!==state.target?.id)return false;
 if(record){
  const captured=record.frames.at(-1)?.state;if(!captured)return false;
  if(captured.graph?.digest!==state.graph?.digest||captured.systemTopology?.definition.digest!==state.systemTopology?.definition.digest
    ||captured.systemTopology?.observations.configurationDigest!==state.systemTopology?.observations.configurationDigest)return false;
 }
 return true;
}
export function runAppLink(summary:RunSummary):string|undefined {
 return summary.status==='ready'&&summary.appVerified?registeredRunAppUrl(summary.appUrl):undefined;
}
export function runIsSimulation(summary:RunSummary):boolean{return summary.limitations.some(message=>message.startsWith('Simulation:'));}
export function momentText(record:RunRecord,index:number):string {
 const selected=recordedFrame(record,index),first=record.frames[0];
 if(record.summary.timing==='recorded'&&first?.recordedAt!==undefined&&selected?.recordedAt!==undefined){
  const seconds=Math.max(0,Math.floor((selected.recordedAt-first.recordedAt)/1000));
  return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
 }
 return `Moment ${Math.min(record.frames.length,Math.max(1,Math.trunc(index)+1))} of ${record.frames.length}`;
}
