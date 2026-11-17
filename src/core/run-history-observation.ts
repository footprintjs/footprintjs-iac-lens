import { readDashboardState } from './client.ts';
import { onboardingVersionAllowsReadiness } from './onboarding-versions.ts';
import { copyRunData, registeredRunAppUrl } from './run-history-data.ts';
import { runObservationIdentity } from './run-history-identity.ts';
import type { RunObservation, RunStatus } from './run-history.ts';
import type { DashboardState, Recording } from './types.ts';

type Row=Record<string,any>;
const row=(input:unknown):Row|undefined=>input&&typeof input==='object'&&!Array.isArray(input)?input as Row:undefined;
const safeId=(input:unknown):input is string=>typeof input==='string'&&input.length>0&&input.length<=1024&&!/[\x00-\x1f\x7f]/.test(input);
const time=(input:unknown):input is number=>typeof input==='number'&&Number.isFinite(input)&&input>=0&&input<=8_640_000_000_000_000;
function snapshot(recording:Recording|undefined,runId:string,graphDigest?:string):Row|undefined{
 if(!recording)return;
 if(recording.provenance&&(recording.provenance.runId!==runId||recording.provenance.graphDigest!==undefined&&recording.provenance.graphDigest!==graphDigest))return;
 const data=row(recording.snapshot);return data&&safeId(data.runId)&&row(recording.structure)?data:undefined;
}
/** Only clocks supplied with actual native positions participate; viewer time is never consulted. */
function nativeStages(data:Row|undefined){
 const recorders=Array.isArray(data?.recorders)?data.recorders:[];
 const captures=recorders.filter((value:unknown)=>row(value)?.id==='iac-native-stage-progress');
 if(captures.length!==1)return[];
 const capture=row(captures[0].data);
 if(!capture||capture.version!==1||capture.runId!==data!.runId||capture.droppedEvents!==0||capture.observerFailures!==0||!Array.isArray(capture.events)||capture.events.length>20_000)return[];
 let previous=0;
 for(const event of capture.events){if(!row(event)||!Number.isSafeInteger(event.sequence)||event.sequence<=previous||!safeId(event.runtimeStageId)||!['start','end','decision','executed','error'].includes(event.type))return[];previous=event.sequence;}
 return capture.events as Row[];
}
function phaseCaption(state:DashboardState,status:RunStatus,appVerified:boolean):string{
 if(status==='incomplete')return 'This run could not be confirmed';
 if(status==='failed')return 'This run needs attention';
 if(status==='ready')return appVerified?'Your app is ready':'Run complete';
 const actions=state.systemTopology?.nodes.flatMap(node=>(node.actions??[]).filter(action=>action.status==='running').map(action=>({node,action})))??[];
 const unique=new Map(actions.map(value=>[value.action.evidence.runtimeStageId,value]));
 if(unique.size>1)return 'Several steps are running';
 const active=[...unique.values()][0];
 if(active){
  const captions={inspect:'Checking what is available',revalidate:'Checking the current setup',configure:'Preparing the update',reload:'Loading the updated settings',start:'Starting services',apply:'Applying the update',observe:active.action.scope==='component'?`Checking ${active.node.label}`:'Checking services'};
  return captions[active.action.phase];
 }
 if(state.run?.status==='passed')return 'Checking the result';
 const action=state.run?.events.at(-1)?.action??state.run?.resources.find(resource=>resource.action)?.action;
 return action==='create'?'Building your setup':action==='noop'||action==='verify'?'Checking your setup':'Updating your setup';
}
/** Project one associated deployment. Preparation/check child captures remain associated facts, not extra runs. */
export function deriveRunObservation(input:DashboardState):RunObservation|undefined {
 const state=readDashboardState(copyRunData(input)),run=state.run;
 if(!run?.id||run.status==='idle')return;
 const native=snapshot(run.recording,run.id,state.graph?.digest);
 // A foreign envelope is an error, not permission to fall back to an unbound observer.
 if(run.recording&&!native)return;
 const events=run.events.filter(event=>event.version===1&&event.runId===run.id&&Number.isSafeInteger(event.sequence)&&event.sequence!>0&&safeId(event.runtimeStageId));
 if(!native&&!events.length)return;
 const stages=nativeStages(native),lastEvent=events.at(-1),lastStage=stages.at(-1),clocks=[...events,...stages].flatMap(value=>time(value.timestamp)?[value.timestamp]:[]);
 const targetId=state.onboarding?.targetId??state.application?.selection?.targetId??state.target?.id;
 const identity=runObservationIdentity(state,run.id);
 const onb=state.onboarding,app=state.application;
 let status:RunStatus=run.status==='running'?'running':run.status==='failed'?'failed':'ready';
 if(onb?.status==='incomplete'||app?.phase==='incomplete'||row(run.report)?.outcome==='unconfirmed')status='incomplete';
 else if(onb?.status==='failed'||app?.phase==='failed')status='failed';
 else if(onb&&onb.status!=='ready'||app&&app.phase!=='ready'||onb?.busy||app?.busy)status='running';
 const appVerified=status==='ready'&&onboardingVersionAllowsReadiness(state.onboardingRegistry)&&!!(onb?onb.deployment?.promoted&&onb.status==='ready':app?app.deployment?.promoted&&app.phase==='ready':state.appAccess?.status==='ready');
 const appUrl=appVerified?registeredRunAppUrl(state.neoUrl??app?.deployment?.appUrl):undefined;
 const checks=state.systemTopology?.observations;
 const position={nativeRunId:native?.runId??null,commits:Array.isArray(native?.commitLog)?native.commitLog.length:null,
  progress:lastEvent?[lastEvent.sequence,lastEvent.runtimeStageId,lastEvent.status,lastEvent.action]:null,
  stage:lastStage?[lastStage.sequence,lastStage.runtimeStageId,lastStage.type]:null,
  resources:run.resources.map(resource=>[resource.id,resource.sequence,resource.runtimeStageId,resource.status,resource.action]),
  topology:checks?{components:checks.components.map(component=>[component.id,component.phase,component.status,component.installed,component.running,component.evidence.runId,component.evidence.runtimeStageId,component.evidence.complete]),checks:checks.checks.map(check=>[check.id,check.status,check.evidence.runId,check.evidence.runtimeStageId,check.evidence.complete]),actions:checks.actions?.map(action=>[action.resourceId,action.componentId,action.phase,action.status,action.evidence.runId,action.evidence.runtimeStageId,action.evidence.complete])}:null,
  onboarding:onb?[onb.recording?.runId,onb.status,onb.stages.map(stage=>[stage.id,stage.status]),onb.checks.map(check=>[check.id,check.status]),onb.deployment?.status,onb.deployment?.checks?.map(check=>[check.id,check.status])]:null,
  application:app?[app.phase,app.deployment?.status,app.deployment?.checks?.map(check=>[check.id,check.status])]:null,
  access:state.appAccess?[state.appAccess.status,state.appAccess.checkedAt]:null};
 // Once application verification owns the frame, a stale deployment clock cannot date its result.
 const postDeployment=run.status==='passed'&&(!!onb||!!app);
 const currentTime=postDeployment?undefined:time(lastStage?.timestamp)?lastStage!.timestamp:time(lastEvent?.timestamp)?lastEvent!.timestamp:undefined;
 const label=onb?.label??app?.label??state.target?.label??state.graph?.name??'Recorded run';
 const versionLabel=state.onboardingRegistry?.versions.find(version=>version.id===state.onboardingRegistry!.activeVersionId)?.label;
 const limitations=[...(!clocks.length?['This recording has step order but no native clock.']:[]),...(!native?['The detailed native recording was not available for this update.']:[]),...(state.mode==='simulator'?['Simulation: this run does not provision real infrastructure.']:[])];
 return{identity,nativePosition:JSON.stringify(position),runId:run.id,...targetId?{targetId}:{},label,...versionLabel?{versionLabel}:{},kind:'deployment',status,caption:phaseCaption(state,status,appVerified),
  ...(currentTime===undefined?{}:{recordedAt:currentTime}),...(clocks.length?{startedAt:clocks.reduce((minimum,value)=>Math.min(minimum,value),Infinity)}:{}),
  ...(status==='ready'&&!postDeployment&&lastStage?.type==='end'&&time(lastStage.timestamp)?{finishedAt:lastStage.timestamp}:{}),...(appUrl?{appUrl}:{}),appVerified,limitations};
}
