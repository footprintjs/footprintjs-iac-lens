import {createHash} from 'node:crypto';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {loadEvidence,verifyEvidenceTrace,validateInfraGraph} from 'footprintjs-iac';
import {readReleaseAutomationState,type ReleaseAutomationState} from 'footprintjs-iac/release-automation/node';
import {readCheckResult,type CheckResult} from 'footprintjs-iac/checks';
import type {ConnectionRunResult,ConnectionSnapshot} from 'footprintjs-iac/connections';
import type {IdentityRunResult,IdentitySnapshot} from 'footprintjs-iac/identity';
import {createIdentityGraph,neoIdentityChecks} from 'footprintjs-iac/integration/identity';
import {neoDeliveryTarget} from 'footprintjs-iac/integration/identity/github-delivery';
import type {DeliveryPublication} from '../../src/server/delivery.ts';
import {pipelineFingerprint} from '../../src/server/pipeline-binding.ts';
import {neoDeliveryConnections,neoDeliveryIdentity} from '../neo-github-delivery/projection.ts';
import type {NeoEnvironmentView} from '../neo-release-pipeline/environment-projection.ts';
import {hydrateNeoStageAssessment} from './hydration-assessment.ts';

export interface NeoReleaseHydrationInput {state:ReleaseAutomationState;environments:NeoEnvironmentView[];directory:string}
const digest=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
async function fixedFile(path:string,max:number):Promise<Buffer>{
  const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>max||await realpath(path)!==path)throw Error('Neo check receipt left its fixed native directory');
  return readFile(path);
}
function same(left:unknown,right:unknown){return pipelineFingerprint(left)===pipelineFingerprint(right);}

/** Reopening a watcher reads its last actually executed environment, never probes or deploys again. */
export async function hydrateNeoReleaseWatcher(input:NeoReleaseHydrationInput):Promise<{environmentId:string;patch:DeliveryPublication}|undefined>{
  const state=readReleaseAutomationState(input.state),directory=resolve(input.directory);
  if(!input.environments.length||new Set(input.environments.map(environment=>environment.id)).size!==input.environments.length)throw Error('Register distinct Neo hydration environments');
  for(const attempt of [...state.attempts].reverse()){
    const pipeline=attempt.pipeline;if(!pipeline?.executionId)continue;
    const stage=[...pipeline.stages].reverse().find(stage=>stage.operations.length>0);if(!stage)continue;
    const definition=pipeline.definition.stages.find(definition=>definition.id===stage.id),environment=input.environments.find(environment=>environment.id===stage.id);
    if(!definition||!environment||!same(definition.target,neoDeliveryTarget(environment.target))||definition.label!==environment.label)throw Error('Neo recorded stage does not match this environment target');
    const graph=validateInfraGraph(environment.baseline.graph),expected=createIdentityGraph(environment.target,{includeNeo:true});
    if(graph.digest!==expected.digest)throw Error('Neo recorded graph differs from the selected environment');
    const action=stage.operations.findLast(operation=>operation.kind==='action');
    const assessment=action?await hydrateNeoStageAssessment(directory,environment,pipeline.executionId,action,graph):undefined;
    const checkOperation=stage.operations.findLast(operation=>operation.kind==='check');
    if(!checkOperation?.check)return{environmentId:environment.id,patch:assessment?{changeAssessment:assessment}:{}};
    const checked=readCheckResult(checkOperation.check),request=checked.request;
    if(request.invocationId!==pipelineFingerprint({executionId:pipeline.executionId,stageId:stage.id,id:checkOperation.id})
      ||request.stageId!==stage.id||!same(request.target,definition.target)||request.releaseId!==pipeline.release.id||request.releaseDigest!==pipeline.release.digest
      ||checkOperation.releaseDigest!==pipeline.release.digest||request.reason!=='after-deploy'||request.suiteId!=='neo-identity-access'||!definition.checks.some(check=>check.runnerId==='neo-live-access'&&check.suiteId===request.suiteId&&check.suiteDigest===request.suiteDigest))throw Error('Neo acceptance request differs from its recorded stage, source or target');
    const checksDirectory=join(directory,'pipelines','checks',request.invocationId);
    const artifacts=checked.artifacts;if(!artifacts||artifacts.length!==2||checked.checks.length!==10)throw Error('Neo acceptance requires two native receipts and ten checks');
    const results=new Map<string,ConnectionRunResult|IdentityRunResult>();
    for(const [kind,id] of [['connections','neo-connections'],['identity','neo-access']] as const){
      const artifact=artifacts.find(artifact=>artifact.id===id),runId=artifact?.reference.match(/^footprint-run:([A-Za-z0-9-]{1,128})$/)?.[1];
      if(!artifact||!runId)throw Error('Neo check artifact reference must identify a retained native run');
      const path=join(checksDirectory,kind,runId+'.json'),bytes=await fixedFile(path,16*1024*1024);
      if(digest(bytes)!==artifact.digest.replace(/^sha256:/,''))throw Error('Neo check artifact digest changed');
      const result=JSON.parse(bytes.toString('utf8')) as ConnectionRunResult|IdentityRunResult;
      const expectedTrace=join(checksDirectory,kind==='connections'?'connection-traces':'identity-traces',runId+'.jsonl');
      if(result.runId!==runId||result.stack!==graph.name||!result.structure||result.tracePath!==expectedTrace||result.version!==1)throw Error('Neo native check receipt belongs to another run or environment');
      await fixedFile(expectedTrace,64*1024*1024);await verifyEvidenceTrace(result);
      const evidence=await loadEvidence(path),shared=evidence.snapshot.sharedState;
      if(!same(result.checks,shared.checks)||result.ok!==shared.ok)throw Error('Neo check outcomes differ from native replay');
      if(kind==='connections'){
        const connections=result as ConnectionRunResult;
        const expectedConnections=graph.relations.flatMap((relation,index)=>relation.kind==='communicatesWith'?[{id:'communication:'+index,from:relation.from,to:relation.to}]:[]);
        if(connections.graph.digest!==graph.digest||Object.keys(connections.checks).length!==3||expectedConnections.some(expected=>{
          const actual=connections.checks[expected.id];return !actual||actual.from!==expected.from||actual.to!==expected.to;
        }))throw Error('Neo connection graph changed');
      }else if(Object.keys(result.checks).length!==7)throw Error('Neo access checks are incomplete');
      results.set(kind,result);
    }
    const connections=results.get('connections') as ConnectionRunResult,identity=results.get('identity') as IdentityRunResult;
    validateOutcomes(checked,connections,identity);
    const connectionSnapshot:ConnectionSnapshot={version:1,runId:connections.runId,sequence:connections.events.at(-1)?.sequence??0,
      connections:Object.fromEntries(connections.events.map(event=>[event.connectionId,event])),events:connections.events,ignoredEvents:0,subscriberFailures:0};
    const identitySnapshot:IdentitySnapshot={version:1,runId:identity.runId,sequence:identity.events.at(-1)?.sequence??0,
      checks:Object.fromEntries(identity.events.map(event=>[event.checkId,event])),events:identity.events,ignoredEvents:0,subscriberFailures:0};
    const patch:DeliveryPublication={connections:neoDeliveryConnections(graph,connectionSnapshot,connections),identity:neoDeliveryIdentity(identitySnapshot,identity),
      ...(assessment?{changeAssessment:assessment}:{}),appAccess:{status:connections.ok&&identity.ok?'ready':'failed',checkedAt:new Date(Math.max(...[...connections.events,...identity.events].map(event=>event.timestamp))).toISOString()}};
    // Keep the recorded measurement time, rather than presenting hydration as a new live check.
    patch.connections!.checkedAt=Math.max(...connections.events.map(event=>event.timestamp));patch.identity!.checkedAt=Math.max(...identity.events.map(event=>event.timestamp));
    return{environmentId:environment.id,patch};
  }
}
function validateOutcomes(result:CheckResult,connections:ConnectionRunResult,identity:IdentityRunResult):void {
  const projected=[...Object.values(connections.checks).map((check,index)=>({id:'connection-'+index,status:check.status==='connected'?'passed':'failed'})),
    ...Object.values(identity.checks).map(check=>({id:check.checkId,status:check.status}))];
  if(!same(projected,result.checks.map(({id,status})=>({id,status})))||neoIdentityChecks.some(expected=>{
    const actual=identity.checks[expected.id];return !actual||actual.kind!==expected.kind||actual.expected!==expected.expected;
  }))throw Error('Neo acceptance verdicts differ from their recorded native checks');
  for(const [record,key] of [[connections,'connectionId'],[identity,'checkId']] as const){
    const native=record.snapshot.sharedState as Record<string,{runId?:string;status?:string}>;
    const latest=new Map<string,typeof record.events[number]>();
    for(const [index,event] of record.events.entries()){
      if(event.runId!==record.runId||event.sequence!==index+1||!Number.isFinite(event.timestamp)||event.timestamp<=0)throw Error('Neo check event identity changed');
      const id=(event as unknown as Record<string,string>)[key]!;latest.set(id,event);
    }
    for(const check of Object.values(record.checks)){
      const id=(check as unknown as Record<string,string>)[key]!,event=latest.get(id);
      if(!event||event.status!==check.status||native['progress:'+id]?.status!==check.status||native['progress:'+id]?.runId!==record.runId)throw Error('Neo progress differs from its retained native outcome');
    }
    if(latest.size!==Object.keys(record.checks).length)throw Error('Neo native check event set changed');
  }
}
