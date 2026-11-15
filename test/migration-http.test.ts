import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,rm,lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSqliteMigrationHost } from '../examples/sqlite-migration/create-host.ts';
import { startDashboard } from '../src/server/index.ts';
import { createDashboardClient } from '../src/core/client.ts';
async function fixture(t:{after(fn:()=>unknown):void},scenario:'normal'|'bad-data'|'consumer-failure'='normal'){
  const directory=await mkdtemp(join(tmpdir(),'lens-real-sqlite-'));await mkdir(join(directory,'static'));await writeFile(join(directory,'static/index.html'),'real sqlite example');
  const created=await createSqliteMigrationHost(directory,{scenario});const app=await startDashboard({...created.host,staticDirectory:join(directory,'static')});let active=app;
  t.after(async()=>{await active.close();await rm(directory,{recursive:true,force:true});});
  return{...created,directory,app,client:createDashboardClient({baseUrl:app.url}),setActive(value:typeof app){active=value;}};
}
async function prepare(value:Awaited<ReturnType<typeof fixture>>){
  const hostId=value.host.migration!.id;await value.client.migration({action:'assess',hostId});await value.app.controller.whenIdle();let view=(await value.client.getState()).migration!;
  assert.equal(view.assessment.status,'complete');assert.equal(view.assessment.report?.changes[0]?.disposition,'replace');
  await value.client.migration({action:'preview',hostId,planId:view.plans[0]!.id,assessmentDigest:view.assessment.report!.digest});view=(await value.client.getState()).migration!;
  assert.equal(view.execution?.status,'idle');assert.equal(view.execution?.operations.length,0);assert.equal(view.review?.steps.length,10);return view;
}
test('read-only assessment and preview cannot mutate real SQLite; exact manual cutover survives a fresh host and preserves conversation records',async t=>{
  const value=await fixture(t),hostId=value.host.migration!.id,before=await value.fixture.consumer.read('records');
  // The host resolves all private registration and database paths; no HTTP input constructs them.
  const post=(body:unknown,headers:Record<string,string>={})=>fetch(value.app.url+'/api/migration',{method:'POST',headers:{'content-type':'application/json',origin:value.app.url,...headers},body:JSON.stringify(body)});
  const state=await value.client.getState();assert.equal(state.graph,null);assert.equal(state.run,undefined);
  for(const extra of [{sql:'DROP TABLE messages'},{path:'/private/not-owned'},{target:'other'},{token:'browser-token'},{checkpointDigest:'0'.repeat(64)}])assert.equal((await post({action:'assess',hostId,...extra})).status,400);
  assert.equal((await post({action:'assess',hostId},{origin:'https://outside.example'})).status,403);assert.equal((await post({action:'assess',hostId},{'content-type':'text/plain'})).status,415);
  assert.equal((await post({action:'assess',hostId,padding:'x'.repeat(3000)})).status,413);
  let view=await prepare(value);assert.deepEqual(await value.fixture.consumer.read('records'),before);assert.equal((await value.fixture.consumer.status()).writesPaused,false);
  await assert.rejects(()=>lstat(value.fixture.consumer.store.databasePath('conversations-v2')),{code:'ENOENT'});
  assert.equal((await post({action:'start',hostId,reviewId:'0'.repeat(64)})).status,409);
  await value.client.migration({action:'start',hostId,reviewId:view.review!.id});await value.app.controller.whenIdle();view=(await value.client.getState()).migration!;
  assert.equal(view.execution?.status,'waiting');assert.equal(view.execution?.canCutover,true);assert.equal(view.execution?.facts.activeStore,'original');assert.equal(view.execution?.facts.writesPaused,true);assert.equal(view.execution?.facts.backupSaved,true);assert.equal(view.execution?.facts.dataChecked,true);
  assert.ok(view.execution?.recording?.snapshot);assert.ok(view.assessment.recording?.snapshot);assert.deepEqual(await value.fixture.consumer.read('records'),before);await assert.rejects(()=>value.fixture.appendExampleMessage(),/paused/);
  const serialized=JSON.stringify(view);for(const privateValue of [value.directory,'Private π conversation','Bob message history','DROP TABLE'])assert.equal(serialized.includes(privateValue),false);
  const executionId=view.execution!.id;await value.app.close();const reopened=await createSqliteMigrationHost(value.directory);const app=await startDashboard({...reopened.host,staticDirectory:join(value.directory,'static')});value.setActive(app);const client=createDashboardClient({baseUrl:app.url});
  view=(await client.getState()).migration!;assert.equal(view.execution?.id,executionId);assert.equal(view.execution?.canCutover,true);assert.equal(view.execution?.recordings.length,1);
  await client.migration({action:'cutover',hostId,executionId});await app.controller.whenIdle();view=(await client.getState()).migration!;
  assert.equal(view.execution?.status,'passed');assert.equal(view.execution?.facts.activeStore,'new');assert.equal(view.execution?.facts.appChecked,true);assert.equal(view.execution?.facts.previousStoreKept,true);assert.equal(view.execution?.facts.writesResumed,true);assert.equal(view.execution?.facts.writesPaused,false);assert.equal(view.execution?.recordings.length,2);
  assert.deepEqual(await reopened.fixture.consumer.read('records'),before);assert.equal((await reopened.fixture.consumer.status()).schemaVersion,2);assert.ok((await lstat(reopened.fixture.consumer.store.databasePath('conversations-v1'))).isFile());
  await reopened.fixture.appendExampleMessage();assert.equal((await reopened.fixture.readSummary()).messages,4);await assert.rejects(()=>client.migration({action:'cutover',hostId,executionId}));
});
test('a real data-preservation failure keeps original data active and paused until explicit safe recovery',async t=>{
  const value=await fixture(t,'bad-data'),hostId=value.host.migration!.id,before=await value.fixture.consumer.read('records');let view=await prepare(value);
  await value.client.migration({action:'start',hostId,reviewId:view.review!.id});await value.app.controller.whenIdle();view=(await value.client.getState()).migration!;
  assert.equal(view.execution?.canCutover,false);assert.equal(view.execution?.facts.dataChecked,false);assert.equal(view.execution?.facts.activeStore,'original');assert.equal(view.execution?.facts.writesPaused,true);assert.equal(view.execution?.steps.find(step=>step.phase==='verify-data')?.status,'failed');assert.equal(view.execution?.canRecover,true);
  assert.deepEqual(await value.fixture.consumer.read('records'),before);await assert.rejects(()=>value.client.migration({action:'cutover',hostId,executionId:view.execution!.id}));
  await value.client.migration({action:'recover',hostId,executionId:view.execution!.id});await value.app.controller.whenIdle();view=(await value.client.getState()).migration!;
  assert.equal(view.execution?.status,'recovered');assert.equal(view.execution?.facts.activeStore,'original');assert.equal(view.execution?.facts.writesPaused,false);assert.equal(view.execution?.canRecover,false);assert.equal((await value.fixture.consumer.status()).schemaVersion,1);
  assert.deepEqual(await value.fixture.consumer.read('records'),before);await value.fixture.appendExampleMessage();assert.equal((await value.fixture.readSummary()).messages,4);assert.ok((await lstat(value.fixture.consumer.store.databasePath('conversations-v2'))).isFile());
});
test('a failed app check after switch discloses new active data and a held fence without offering unsafe restoration',async t=>{
  const value=await fixture(t,'consumer-failure'),hostId=value.host.migration!.id;let view=await prepare(value);
  await value.client.migration({action:'start',hostId,reviewId:view.review!.id});await value.app.controller.whenIdle();view=(await value.client.getState()).migration!;
  await value.client.migration({action:'cutover',hostId,executionId:view.execution!.id});await value.app.controller.whenIdle();view=(await value.client.getState()).migration!;
  assert.equal(view.execution?.facts.activeStore,'new');assert.equal(view.execution?.facts.writesPaused,true);assert.equal(view.execution?.facts.appChecked,false);assert.equal(view.execution?.needsInspection,true);assert.equal(view.execution?.canRecover,false);assert.equal(view.execution?.canCutover,false);assert.equal(view.execution?.steps.find(step=>step.phase==='verify-consumer')?.status,'failed');await assert.rejects(()=>value.fixture.appendExampleMessage(),/paused/);
});
