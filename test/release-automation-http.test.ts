import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';
import test from 'node:test';
import {ReleaseAutomationHost,FileReleaseAutomationStore,type ReleaseAutomationPort,type ReleaseAutomationState} from 'footprintjs-iac/release-automation/node';
import {GitHubReleaseCatalog} from 'footprintjs-iac/releases/github';
import type {ResolvedReleaseChoice} from 'footprintjs-iac/releases';
import {compileGraph} from 'footprintjs-iac/graph';
import {startDashboard} from '../src/server/index.ts';
import {createDashboardClient,readDashboardState} from '../src/core/client.ts';
import {readReleaseAutomationAction,type ReleaseAutomationAction} from '../src/core/release-automation.ts';
import {neoReleaseWatcherCatalog} from '../examples/neo-release-automation/catalog.ts';
import type {NeoReleaseWatcherConfig} from '../examples/neo-release-automation/config.ts';

test('release HTTP controls are loopback, IDs-only, asynchronous and isolated from simulator and other deployment entry points',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'lens-release-http-'));await mkdir(join(directory,'static'));await writeFile(join(directory,'static/index.html'),'local protocol fixture');
  const listeners=new Set<(state:ReleaseAutomationState)=>void>(),calls:string[]=[];
  let state:ReleaseAutomationState={version:1,kind:'release-automation',definition:{version:1,id:'releases',label:'Application releases',catalogId:'sources',adapterId:'protocol-stub',configurationDigest:'a'.repeat(64),automatic:{enabled:false,initial:'observe'}},definitionDigest:'b'.repeat(64),initialized:false,choices:[],seenIds:[],attempts:[],recordings:[],discoveryStatus:'not-checked'};
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  const snapshot=async()=>structuredClone(state),emit=()=>{for(const listener of listeners)listener(structuredClone(state));};
  const host:ReleaseAutomationPort={snapshot,subscribe(listener){listeners.add(listener);return()=>{listeners.delete(listener);};},async refresh(){calls.push('refresh');state.discoveryStatus='available';state.choices=[{id:'published-1',label:'App version one',source:{repository:'https://github.com/private/app.git',ref:'refs/tags/v1'},publishedAt:'2026-11-01T00:00:00.000Z'}];emit();return snapshot();},async tick(){calls.push('tick');return snapshot();},async start(id){calls.push('start:'+id);state.attempts.push({id:'attempt-1',releaseId:id,trigger:'manual',status:'resolving',createdAt:1,recordings:[]});emit();await held;state.attempts[0]!.status='failed';state.attempts[0]!.reason='protocol-fixture-stopped-before-provider';emit();return snapshot();},async promote(){calls.push('promote');throw Error('No gate in this fixture');},async recover(){calls.push('recover');throw Error('No gate in this fixture');}};
  const graph=compileGraph({name:'existing-system',resources:[{id:'app',provider:'fixture',spec:{}}],boundaries:[],memberships:[],relations:[]});
  const app=await startDashboard({directory:join(directory,'lens'),staticDirectory:join(directory,'static'),releaseAutomation:{host,stages:[{id:'dev',label:'Dev',promotion:'automatic',rollback:'disabled'}]},initialReview:{graph,run:{id:'existing-native',status:'passed',mode:'managed',resources:[{id:'app',status:'ready'}],events:[]}}});
  t.after(async()=>{release();await app.close();await rm(directory,{recursive:true,force:true});});
  const client=createDashboardClient({baseUrl:app.url}),post=(body:unknown,headers:Record<string,string>={})=>fetch(app.url+'/api/releases',{method:'POST',headers:{'content-type':'application/json',origin:app.url,...headers},body:JSON.stringify(body)});
  assert.equal((await client.getState()).releaseAutomation!.attempts.length,0);assert.deepEqual(calls,[],'Serving Lens does not poll or deploy');
  for(const field of [{command:'rm -rf anything'},{repository:'https://outside.example/repo'},{path:'/private/app'},{token:'caller-token'},{configuration:{automatic:true}},{target:{scope:'elsewhere'}}])assert.equal((await post({action:'refresh',hostId:'releases',...field})).status,400);
  assert.equal((await post({action:'refresh',hostId:'releases'},{origin:'https://outside.example'})).status,403);
  const foreignHost=await new Promise<number>(resolve=>{const request=httpRequest(app.url+'/api/releases',{method:'POST',headers:{host:'outside.example','content-type':'application/json',origin:app.url}},response=>{response.resume();resolve(response.statusCode!);});request.end(JSON.stringify({action:'refresh',hostId:'releases'}));});
  assert.equal(foreignHost,403);
  assert.equal((await post({action:'refresh',hostId:'releases'},{'content-type':'text/plain'})).status,415);
  assert.equal((await post({action:'refresh',hostId:'releases',padding:'x'.repeat(5000)})).status,413);
  assert.equal((await post({action:'refresh',hostId:'other-host'})).status,400);
  assert.equal((await post({action:'deploy',hostId:'releases',releaseId:'not-discovered'})).status,400);
  assert.equal((await fetch(app.url+'/api/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scenario:'success'})})).status,409);
  await client.releaseAutomation({action:'refresh',hostId:'releases'});await app.controller.whenIdle();assert.deepEqual(calls,['refresh']);
  const refreshed=await client.getState();assert.equal(refreshed.graph?.digest,graph.digest);assert.equal(refreshed.run?.resources[0]?.status,'ready');
  assert.equal(refreshed.releaseAutomation?.choices[0]?.id,'published-1');assert.equal(refreshed.releaseAutomation?.attempts.length,0);
  assert.equal((await post({action:'deploy',hostId:'releases',releaseId:'published-1'})).status,202);
  assert.equal((await client.getState()).releaseAutomation?.busy,true);assert.equal((await post({action:'refresh',hostId:'releases'})).status,409);
  release();await app.controller.whenIdle();const ended=await client.getState();assert.equal(ended.releaseAutomation?.attempts[0]?.status,'failed');assert.equal(ended.busy,false);
  assert.equal((await post({action:'deploy',hostId:'releases',releaseId:'published-1'})).status,409);
  assert.equal((await post({action:'promote',hostId:'releases',attemptId:'attempt-1',stageId:'dev'})).status,409);
  assert.equal(JSON.stringify(ended.releaseAutomation).includes('https://github.com/private/app.git'),false);assert.equal(JSON.stringify(ended.releaseAutomation).includes(directory),false);assert.deepEqual(calls,['refresh','start:published-1']);
});

test('a real GitHub catalog with only draft releases contributes no automatic choice; reviewed source pins remain explicitly manual',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'lens-draft-sources-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const source:ResolvedReleaseChoice={id:'reviewed-local-v2',label:'Reviewed v2 source',source:{repository:'https://github.com/acme/app.git',ref:'refs/heads/reviewed-v2',commit:'2'.repeat(40),tree:'3'.repeat(40)}};
  const requests:string[]=[];
  const github=new GitHubReleaseCatalog({id:'github',repository:'acme/app',fetch:async input=>{requests.push(String(input));return new Response(JSON.stringify([{id:123,name:'Draft should stay hidden',tag_name:'v2-draft',draft:true,prerelease:false,published_at:null}]),{status:200,headers:{'content-type':'application/json'}});}});
  const config={id:'neo',repository:'acme/app',manualSources:[source]} as NeoReleaseWatcherConfig;
  const catalog=neoReleaseWatcherCatalog(config,github),rows=await catalog.list();assert.deepEqual(rows,[source]);await assert.rejects(()=>catalog.resolve('github-123'),/discovered/);
  assert.deepEqual(await catalog.resolve(source.id),source);assert.equal(requests.length,1);
  let preparations=0;const host=new ReleaseAutomationHost({definition:{version:1,id:'draft-review',label:'Draft-only catalog acceptance',catalogId:catalog.id,adapterId:'stop-before-provider',configurationDigest:'c'.repeat(64),automatic:{enabled:true,initial:'observe'}},catalog,adapter:{id:'stop-before-provider',async prepare(choice){preparations++;assert.deepEqual(choice.source,source.source);throw Error('Intentional fixture stop before a real build');},async pipeline(){throw Error('No pipeline should start');}},store:new FileReleaseAutomationStore(join(directory,'host'))});
  assert.equal((await host.tick()).attempts.length,0);assert.equal((await host.tick()).attempts.length,0);assert.equal(preparations,0);
  const manual=await host.start(source.id);assert.equal(manual.attempts[0]?.trigger,'manual');assert.equal(manual.attempts[0]?.source?.source.commit,source.source.commit);assert.equal(manual.attempts[0]?.status,'incomplete');assert.equal(preparations,1);
});

test('client validates narrow actions before sending and rejects contradictory deployment frames',async()=>{
  const sent:{url:string;body:unknown}[]=[];const client=createDashboardClient({baseUrl:'http://127.0.0.1:12345',fetch:async(input,options)=>{sent.push({url:String(input),body:JSON.parse(String(options?.body))});return new Response('{}',{status:202});}});
  await client.releaseAutomation({action:'deploy',hostId:'releases',releaseId:'release-1'});assert.deepEqual(sent,[{url:'http://127.0.0.1:12345/api/releases',body:{action:'deploy',hostId:'releases',releaseId:'release-1'}}]);
  await assert.rejects(()=>client.releaseAutomation({action:'deploy',hostId:'releases',releaseId:'release-1',token:'injected'} as ReleaseAutomationAction));assert.equal(sent.length,1);
  assert.throws(()=>readReleaseAutomationAction({action:'promote',hostId:'releases',attemptId:'attempt',stageId:'gamma',releaseDigest:'0'.repeat(64)}));
  const view={id:'releases',label:'App',automatic:false,initialized:true,busy:false,discoveryStatus:'available',choices:[{id:'v1',label:'Version one'}],attempts:[],stages:[{id:'dev',label:'Dev',promotion:'automatic',rollback:'disabled'}]};
  const frame={revision:1,graph:null,busy:false,mode:'managed',scenarios:[],releaseAutomation:view};
  for(const field of ['choices','stages'] as const){const invalid=structuredClone(frame);invalid.releaseAutomation[field].push(structuredClone(invalid.releaseAutomation[field][0]!) as never);assert.throws(()=>readDashboardState(invalid),'duplicate '+field+' must be rejected');}
  const pipeline={id:'execution',status:'awaiting-promotion',releaseId:'v1',releaseDigest:'d'.repeat(64),stages:[{id:'dev',label:'Dev',strategyId:'direct',status:'awaiting-promotion',steps:[],checks:[],changes:[],recovery:'disabled',canPromote:true,canRecover:false}],recordings:[],events:[]};
  const attempt={id:'attempt',releaseId:'v1',label:'Version one',trigger:'manual',status:'waiting',build:[{id:'build',label:'Build',status:'passed'}],pipeline};
  const valid={...frame,releaseAutomation:{...view,attempts:[attempt]}};assert.doesNotThrow(()=>readDashboardState(structuredClone(valid)));
  const wrongSource=structuredClone(valid);wrongSource.releaseAutomation.attempts[0]!.pipeline.releaseId='another-version';assert.throws(()=>readDashboardState(wrongSource));
  const wrongStage=structuredClone(valid);wrongStage.releaseAutomation.attempts[0]!.pipeline.stages[0]!.id='prod';assert.throws(()=>readDashboardState(wrongStage));
  const duplicatedAttempt=structuredClone(valid);duplicatedAttempt.releaseAutomation.attempts.push(structuredClone(attempt));assert.throws(()=>readDashboardState(duplicatedAttempt));
  const duplicatedBuild=structuredClone(valid);duplicatedBuild.releaseAutomation.attempts[0]!.build.push(structuredClone(attempt.build[0]!));assert.throws(()=>readDashboardState(duplicatedBuild));
});
