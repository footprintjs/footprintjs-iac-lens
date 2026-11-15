import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FileDeliveryStore, DeliveryWorkflow } from 'footprintjs-iac/delivery/workflow';
import { projectDeliveryState, readDeliveryAction, deliveryPhases, readDeliveryView } from '../src/core/delivery.ts';
import { createDashboardClient } from '../src/core/client.ts';
import { startDashboard } from '../src/server/index.ts';
import type { DeliveryDefinition, DeliveryAdapters } from 'footprintjs-iac/delivery';
import { compileGraph } from 'footprintjs-iac/graph';
import { DeliveryReview } from '../src/server/delivery.ts';

const definition: DeliveryDefinition = { id: 'approved-version', label: 'Approved application update', target: { id: 'owned',scope: 'owned-scope' },
  source: { repository: 'https://github.com/example/app',ref: 'release' }, recipe: { id: 'container-build',digest: 'a'.repeat(64) }, configurationDigest: 'b'.repeat(64) };
const revision = { ...definition.source,commit: 'c'.repeat(40),tree: 'd'.repeat(40) };
function adapters(overrides: Partial<DeliveryAdapters['deployment']> = {}): DeliveryAdapters {
  return {
    source: { async resolve() { return revision; },async fetch() { return { revision,location: '/private/source-not-for-browser' }; } },
    build: { async build() { return { artifacts: [{ id: 'program',digest: 'e'.repeat(64),reference: 'registry.example/app@sha256:'+'e'.repeat(64) }],recipeDigest: definition.recipe.digest,
      metadata: { private: 'private-adapter-metadata-not-for-browser' } }; } },
    artifacts: { async publish(build) { return { artifacts: build.artifacts }; } },
    deployment: { async plan() { return { id: 'sealed-review',digest: 'f'.repeat(64),changes: [{ resourceId: 'program',action: 'update' },{ resourceId: 'database',action: 'noop' }] }; },
      async deploy() { return { ok: true,runId: 'native-provider-run',evidencePath: '/private/provider.json' }; },
      async verify() { return { ok: true,checks: [{ id: 'application-health',passed: true }] }; },...overrides },
  };
}
test('delivery HTTP admits only configured ID, streams native stages, preserves system view and hides host handles', { timeout: 30000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(),'lens-delivery-')); const staticDirectory = join(directory,'static');
  await mkdir(staticDirectory); await writeFile(join(staticDirectory,'index.html'),'<!doctype html>delivery');
  let release!: () => void, calls = 0; const gate = new Promise<void>(resolve => { release = resolve; });
  let enteredDeploy!: () => void;
  const deployed = new Promise<void>(resolve => { enteredDeploy = resolve; });
  const workflow = new DeliveryWorkflow({ definition,store: new FileDeliveryStore(join(directory,'delivery')),adapters: adapters({ async deploy() {
    calls++; enteredDeploy(); await gate; return { ok: true,runId: 'native-provider-run' };
  } }) });
  const graph=compileGraph({name:'owned-system',resources:[{id:'program',provider:'fixture',spec:{}},{id:'database',provider:'fixture',spec:{}}],boundaries:[],memberships:[],relations:[]});
  const app = await startDashboard({ directory: join(directory,'viewer'),staticDirectory,initialReview:{graph,target:{id:'owned',label:'Owned system'},
    run:{id:'existing-native',status:'passed',mode:'managed',resources:graph.resources.map(resource=>({id:resource.id,status:'ready'})),events:[]}},
    delivery: { id: definition.id,buttonLabel: 'Deploy from GitHub',workflow } });
  t.after(async () => { release(); await app.close(); await rm(directory,{ recursive:true,force:true }); });
  const post = (body: unknown,headers: Record<string,string> = {}) => fetch(app.url+'/api/delivery',{ method:'POST',headers:{ 'content-type':'application/json',origin:app.url,...headers },body:JSON.stringify(body) });
  const client = createDashboardClient({ baseUrl:app.url });
  assert.equal((await client.getState()).delivery?.status,'idle');
  assert.equal((await post({ deliveryId: definition.id,repository:'https://unapproved.example' })).status,400);
  assert.equal((await post({ deliveryId: definition.id,command:'private-command' })).status,400);
  assert.equal((await post({ deliveryId:'unapproved' })).status,400);
  assert.equal((await post({ deliveryId:definition.id },{ origin:'https://outside.example' })).status,403);
  assert.equal((await post({ deliveryId:definition.id },{ 'content-type':'text/plain' })).status,415);
  assert.equal((await post({ deliveryId:definition.id,padding:'x'.repeat(2048) })).status,413);
  assert.equal(calls,0);
  assert.equal((await post({ deliveryId:definition.id })).status,202);
  await deployed;
  const live = await client.getState();
  assert.equal(live.busy,true);assert.equal(live.delivery?.stages.find(stage=>stage.id==='deploy')?.status,'running');
  assert.equal(live.graph?.digest,graph.digest);assert.ok(live.run?.resources.every(resource=>resource.status==='ready'));
  assert.deepEqual(live.delivery?.changes.map(change=>change.action),['update','noop']);
  assert.equal((await post({ deliveryId:definition.id })).status,409);
  assert.equal((await fetch(app.url+'/api/run',{ method:'POST',headers:{ 'content-type':'application/json',origin:app.url },body:JSON.stringify({ scenario:'demo' }) })).status,409);
  release();await app.controller.whenIdle();
  const finished = await client.getState();
  assert.equal(finished.busy,false);assert.equal(finished.delivery?.status,'passed');assert.equal(calls,1);
  assert.ok(finished.delivery?.recording?.snapshot);assert.equal(finished.delivery?.recordings.length,1);
  const serialized=JSON.stringify(finished);
  for (const value of ['/private/source-not-for-browser','private-adapter-metadata-not-for-browser','/private/provider.json']) assert.equal(serialized.includes(value),false);
  assert.equal((await post({ deliveryId:definition.id })).status,409);
});

test('failed deliveries retain native evidence and summaries without leaking adapter exceptions', async t => {
  const directory=await mkdtemp(join(tmpdir(),'lens-failed-delivery-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const workflow=new DeliveryWorkflow({ definition,store:new FileDeliveryStore(directory),adapters:adapters({ async verify(){throw Error('private-provider-error');} }) });
  const failed=await workflow.start(),view=projectDeliveryState(failed,'Deploy from GitHub');
  assert.equal(view.status,'failed');assert.equal(view.stages.at(-1)?.status,'failed');assert.equal(view.recordings.length,1);
  assert.equal(view.recordings[0]?.status,'failed');assert.equal(JSON.stringify(view).includes('private-provider-error'),false);
  assert.equal(deliveryPhases(view).at(-1)?.status,'failed');
});

test('delivery protocol rejects arbitrary inputs, malformed phases, credential URLs and completed status without completed phases', async t => {
  assert.throws(()=>readDeliveryAction({deliveryId:definition.id,path:'/private'}));
  assert.throws(()=>readDeliveryAction({deliveryId:'../run'}));
  const directory=await mkdtemp(join(tmpdir(),'lens-delivery-protocol-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const workflow=new DeliveryWorkflow({definition,store:new FileDeliveryStore(directory),adapters:adapters()});
  const view=projectDeliveryState(await workflow.snapshot(),'Deploy from GitHub');
  assert.deepEqual(deliveryPhases(view).map(phase=>phase.status),Array(6).fill('pending'));
  assert.throws(()=>readDeliveryView({...view,status:'passed'}));
  assert.throws(()=>readDeliveryView({...view,repository:'https://user:secret@github.com/example/app'}));
  assert.throws(()=>readDeliveryView({...view,stages:view.stages.slice().reverse()}));
  assert.throws(()=>readDeliveryView({...view,command:'build'}));
});

test('opening a stored in-progress attempt does not pretend the viewer owns a live execution or mutate its ledger',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'lens-uncertain-delivery-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const configured=adapters();configured.source.resolve=async()=>{await gate;return revision;};
  const workflow=new DeliveryWorkflow({definition,store:new FileDeliveryStore(directory),adapters:configured});
  const pending=workflow.start();
  try {
    let snapshot=await workflow.snapshot();
    for(let attempt=0;attempt<100 && snapshot.status!=='running';attempt++){await new Promise(resolve=>setTimeout(resolve,5));snapshot=await workflow.snapshot();}
    assert.equal(snapshot.status,'running');
    const review=new DeliveryReview({id:definition.id,workflow:{async snapshot(){return snapshot;},async start(){throw Error('must not repeat');},subscribe(){return()=>{};}}},()=>{},()=>{});
    await review.initialize();
    assert.equal(review.snapshot().status,'incomplete');assert.match(review.snapshot().error!,/Previous execution needs inspection/);
    assert.equal((await workflow.snapshot()).status,'running');
    assert.throws(()=>review.action({deliveryId:definition.id}),/retained delivery outcome/);
    review.dispose();
  }finally{release();await pending;}
});
