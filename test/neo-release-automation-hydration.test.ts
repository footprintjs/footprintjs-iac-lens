import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {checkConnections,type ConnectionRunResult} from 'footprintjs-iac/connections';
import {checkIdentityAccess} from 'footprintjs-iac/identity';
import {createIdentityGraph,neoIdentityChecks,type IdentityTarget} from 'footprintjs-iac/integration/identity';
import {neoDeliveryTarget,type NeoDeliveryBaseline} from 'footprintjs-iac/integration/identity/github-delivery';
import {defineReleaseManifest} from 'footprintjs-iac/releases/node';
import {PipelineWorkflow,FilePipelineStore,FilePipelineTargetStore,directStrategy,type PipelineDefinition} from 'footprintjs-iac/pipeline/node';
import {ChangeAssessmentWorkflow,FileChangeAssessmentStore,DeclaredContractAssessmentAdapter,conservativeChangeStrategy} from 'footprintjs-iac/change-assessment/node';
import type {ReleaseAutomationState} from 'footprintjs-iac/release-automation';
import {pipelineFingerprint} from '../src/server/pipeline-binding.ts';
import {hydrateNeoReleaseWatcher} from '../examples/neo-release-automation/hydration.ts';
import type {NeoEnvironmentView} from '../examples/neo-release-pipeline/environment-projection.ts';

const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
async function fixture(t:{after(fn:()=>Promise<void>):void}){
  const directory=await realpath(await mkdtemp(join(tmpdir(),'lens-watcher-hydrate-')));t.after(()=>rm(directory,{recursive:true,force:true}));let calls=0;
  const environments:NeoEnvironmentView[]=['dev','gamma','prod'].map((id,index)=>{
    const root=join(directory,'environments',id),port=61000+index*3,targetId=String(index+1).repeat(8);
    const target:IdentityTarget={version:1,id:targetId,directory:root,stateDirectory:join(root,'state'),context:'kind-fixture-'+id,kubeconfig:join(root,'kubeconfig'),namespace:'neo-'+id,neoPort:port,providerPort:port+1,ldapPort:port+2,issuer:`http://127.0.0.1:${port+1}/realms/neo`,providerName:'footprint-identity-'+targetId+'-provider',directoryName:'footprint-identity-'+targetId+'-directory',fixtureDigest:'a'.repeat(64),sourceCommit:'2'.repeat(40),images:{nodeImage:'node:review-'+'2'.repeat(64),pythonImage:'python:review-'+'3'.repeat(64),ldapImage:'ldap-fixture',providerImage:'provider-fixture'}};
    const graph=createIdentityGraph(target,{includeNeo:true});return{id,label:id,target,baseline:{graph} as NeoDeliveryBaseline};
  });
  const release=defineReleaseManifest({id:'release-two',source:{repository:'https://github.com/acme/neo.git',ref:'refs/tags/v2',commit:'2'.repeat(40),tree:'3'.repeat(40)},recipe:{id:'fixture',digest:'b'.repeat(64)},artifacts:[{id:'app',digest:'2'.repeat(64),reference:'fixture/app:v2'}]});
  const definition:PipelineDefinition={version:1,id:'native-hydration',label:'Hydration acceptance fixture',configurationDigest:'c'.repeat(64),stages:environments.map(environment=>({id:environment.id,label:environment.label,target:neoDeliveryTarget(environment.target),strategyId:'direct',adapterId:'fixture',checks:[{runnerId:'neo-live-access',suiteId:'neo-identity-access',suiteDigest:'d'.repeat(64)}],promotion:'automatic',rollback:'disabled'}))};
  const deployed=new Map<string,string>();const results=new Map<string,{connections:ConnectionRunResult;files:string[]}>();
  const workflow=new PipelineWorkflow({definition,release,store:new FilePipelineStore(join(directory,'pipeline-attempt')),targetStore:new FilePipelineTargetStore(join(directory,'targets')),registry:{strategies:[directStrategy()],adapters:[{id:'fixture',label:'Explicit local fixture',capabilities:['deploy'],async execute(_action,version,context){
    calls++;const environment=environments.find(environment=>environment.id===context.stageId)!,graph=environment.baseline.graph;
    const previous=createIdentityGraph({...environment.target,images:{...environment.target.images,nodeImage:'node:review-'+'1'.repeat(64)}},{includeNeo:true});
    const reviewId=pipelineFingerprint({stageId:context.stageId,executionId:context.executionId});
    const assessment=await new ChangeAssessmentWorkflow({definition:{version:1,id:'neo-revalidate-'+reviewId,label:'Recorded compatibility fixture',target:context.target,configurationDigest:'e'.repeat(64),changes:graph.resources.map(desired=>({id:desired.id,label:desired.id,adapterId:desired.provider==='kubernetes'?'contract':'identity',strategyId:'conservative',data:'stateless',previous:previous.resources.find(resource=>resource.id===desired.id),desired}))},
      registry:{adapters:[new DeclaredContractAssessmentAdapter({id:'contract',provider:'kubernetes',scope:context.target.scope,mutablePaths:['/spec'],replacementPaths:[],async observe(change){return{exists:true,owned:true,ready:true,fingerprint:pipelineFingerprint(change.previous!.spec)};}}),
        {id:'identity',provider:'local-identity-fixture',scope:context.target.scope,async probe(change){return{observation:{exists:true,owned:true,ready:true,fingerprint:pipelineFingerprint(change.previous!.spec)},update:'not-needed',reasons:[],validation:'declared-contract'};}}],strategies:[conservativeChangeStrategy()]},
      store:new FileChangeAssessmentStore(join(directory,'pipelines','deployment',context.stageId,context.operationId,'assessments',reviewId,'revalidate'))}).start();
    assert.equal(assessment.status,'complete');deployed.set(context.target.scope,version.digest);
    return{status:'succeeded',metadata:JSON.parse(JSON.stringify({deployment:{metadata:{revalidation:{report:assessment.report!,recording:assessment.recording!}}}})),evidence:[{kind:'change-assessment-revalidate',digest:assessment.report!.digest,runId:assessment.recording!.runId}]};
  },async observe(context){return{known:true,releaseDigest:deployed.get(context.target.scope)??null};}}],checks:[{id:'neo-live-access',suites:()=>[{id:'neo-identity-access',label:'Native fixture checks',kind:'explicit-fixture',digest:'d'.repeat(64)}],async run(request){
    const graph=environments.find(environment=>environment.id===request.stageId)!.baseline.graph,root=join(directory,'pipelines','checks',request.invocationId);
    const connections=await checkConnections({graph,traceDirectory:join(root,'connection-traces'),adapter:{async check(){calls++;return{method:'explicit-local-fixture',target:'fixed-owned-fixture',observedAt:Date.now(),latencyMs:1,details:{}};}}});
    const identity=await checkIdentityAccess({stack:graph.name,checks:neoIdentityChecks,traceDirectory:join(root,'identity-traces'),adapter:{async check(check){calls++;return{verdict:check.expected,observedAt:Date.now(),latencyMs:1,details:{code:'verified'}};}}});
    const artifacts=[],files=[];
    for(const [kind,id,result] of [['connections','neo-connections',connections],['identity','neo-access',identity]] as const){await mkdir(join(root,kind),{recursive:true});const file=join(root,kind,result.runId+'.json'),bytes=Buffer.from(JSON.stringify(result));await writeFile(file,bytes);files.push(file);artifacts.push({id,digest:sha(bytes),reference:'footprint-run:'+result.runId});}
    results.set(request.stageId,{connections,files});return{request,status:'passed',checks:[...Object.values(connections.checks).map((_check,index)=>({id:'connection-'+index,status:'passed' as const})),...neoIdentityChecks.map(check=>({id:check.id,status:'passed' as const}))],artifacts};
  }}]}});
  return{directory,environments,workflow,release,results,calls:()=>calls};
}
async function completed(t:{after(fn:()=>Promise<void>):void}){
  const f=await fixture(t),pipeline=await f.workflow.start();assert.equal(pipeline.status,'passed');
  const state:ReleaseAutomationState={version:1,kind:'release-automation',definition:{version:1,id:'watcher',label:'Watcher',catalogId:'fixture',adapterId:'fixture',configurationDigest:'a'.repeat(64),automatic:{enabled:true,initial:'observe'}},definitionDigest:'b'.repeat(64),initialized:true,choices:[],seenIds:['github-2'],attempts:[{id:'attempt-two',releaseId:'github-2',trigger:'automatic',createdAt:1,status:'passed',pipeline,recordings:[]}],recordings:[],discoveryStatus:'available'};
  return{...f,state};
}
test('restart restores Prod native checks, their original timestamps and the latest preflight without running providers',async t=>{
  const f=await completed(t),before=f.calls(),restored=await hydrateNeoReleaseWatcher(f);
  assert.equal(restored?.environmentId,'prod');assert.equal(restored?.patch.connections?.status,'passed');assert.equal(restored?.patch.identity?.status,'passed');
  assert.equal(restored?.patch.connections?.checks.length,3);assert.equal(restored?.patch.identity?.checks.length,7);assert.equal(restored?.patch.appAccess?.status,'ready');
  assert.equal(restored?.patch.connections?.checkedAt,Math.max(...f.results.get('prod')!.connections.events.map(event=>event.timestamp)));
  assert.equal(restored?.patch.changeAssessment?.phase,'revalidate');assert.equal(restored?.patch.changeAssessment?.status,'complete');assert.ok(restored?.patch.changeAssessment?.recording);
  assert.equal(f.calls(),before,'Hydration must not call a provider or probe');
});
test('mixed stages, changed targets, forged artifact references and modified native check files are refused',async t=>{
  const f=await completed(t);
  const mixed=structuredClone(f.state);mixed.attempts[0]!.pipeline!.stages[2]!.operations.find(operation=>operation.kind==='check')!.check!.request.stageId='dev';await assert.rejects(()=>hydrateNeoReleaseWatcher({...f,state:mixed}),/request differs/);
  const wrong=structuredClone(f.state);wrong.attempts[0]!.pipeline!.definition.stages[2]!.target.scope='another-target';await assert.rejects(()=>hydrateNeoReleaseWatcher({...f,state:wrong}),/environment target/);
  const foreignPreflight=structuredClone(f.state),metadata=foreignPreflight.attempts[0]!.pipeline!.stages[2]!.operations.find(operation=>operation.kind==='action')!.receipt!.metadata as unknown as {deployment:{metadata:{revalidation:{recording:{evidencePath:string}}}}};
  metadata.deployment.metadata.revalidation.recording.evidencePath=join(f.directory,'another-environment.json');await assert.rejects(()=>hydrateNeoReleaseWatcher({...f,state:foreignPreflight}),/fixed stage deployment/);
  const forged=structuredClone(f.state);forged.attempts[0]!.pipeline!.stages[2]!.operations.find(operation=>operation.kind==='check')!.check!.artifacts![0]!.reference='footprint-run:../../other';await assert.rejects(()=>hydrateNeoReleaseWatcher({...f,state:forged}));
  const path=f.results.get('prod')!.files[0]!,original=await readFile(path),changed=JSON.parse(original.toString());changed.checks[Object.keys(changed.checks)[0]!].status='failed';await writeFile(path,JSON.stringify(changed));
  await assert.rejects(()=>hydrateNeoReleaseWatcher(f),/digest changed/);
  const forgedDigest=structuredClone(f.state);forgedDigest.attempts[0]!.pipeline!.stages[2]!.operations.find(operation=>operation.kind==='check')!.check!.artifacts![0]!.digest=sha(await readFile(path));
  await assert.rejects(()=>hydrateNeoReleaseWatcher({...f,state:forgedDigest}),/outcomes differ/);
});
