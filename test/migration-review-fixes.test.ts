import assert from 'node:assert/strict';
import { mkdtemp,rm,copyFile,rename,chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSqliteMigrationHost } from '../examples/sqlite-migration/create-host.ts';
import { MigrationReview } from '../src/server/migration.ts';
import { migrationChangeLabel } from '../src/core/migration.ts';
import { projectMigrationState } from '../src/core/migration-project.ts';
import type { PreparedMigration } from '../src/server/index.ts';
import type { MigrationOperation,MigrationState } from 'footprintjs-iac/migration';
async function prepared(t:{after(fn:()=>unknown):void}){
  const directory=await mkdtemp(join(tmpdir(),'lens-migration-review-'));t.after(()=>rm(directory,{recursive:true,force:true}));const created=await createSqliteMigrationHost(directory),options=created.host.migration!,original=options.prepare;let selected:PreparedMigration|undefined;
  options.prepare=async(planId,report)=>selected=await original(planId,report);const review=new MigrationReview(options,()=>{},()=>{});t.after(()=>review.dispose());await review.initialize();await review.action({action:'assess',hostId:options.id});await review.whenIdle();let view=review.snapshot();await review.action({action:'preview',hostId:options.id,planId:view.plans[0]!.id,assessmentDigest:view.assessment.report!.digest});view=review.snapshot();return{...created,review,options,selected:selected!,view,directory};
}
function lostReceipt(state:MigrationState,phase:'cutover'|'resume'):MigrationState {
  const changed=structuredClone(state);changed.status='waiting';changed.pendingAction={executionId:changed.executionId!,token:'0'.repeat(64),checkpointDigest:'1'.repeat(64),kind:'inspect'};
  const step={id:phase,phase,operation:phase};const existing=changed.operations.find(operation=>operation.id===phase);
  if(existing){existing.status='unknown';delete existing.receipt;delete existing.observation;}
  else{const previous=changed.operations.at(-1)!;const operation:MigrationOperation={id:phase,phase,operation:phase,status:'unknown',request:{...previous.request,step}};changed.operations.push(operation);}
  return changed;
}
test('unknown cutover or unpause without a new observation cannot reuse old original/new routing or fence facts',async t=>{
  const value=await prepared(t);await value.review.action({action:'start',hostId:value.options.id,reviewId:value.view.review!.id});await value.review.whenIdle();let state=await value.selected.workflow.snapshot();
  const unknownSwitch=projectMigrationState(lostReceipt(state,'cutover'),value.selected.plan);assert.equal(unknownSwitch.facts.activeStore,'unknown');assert.equal(unknownSwitch.facts.writesPaused,null);assert.equal(unknownSwitch.canCutover,false);assert.equal(unknownSwitch.needsInspection,true);
  const view=value.review.snapshot();await value.review.action({action:'cutover',hostId:value.options.id,executionId:view.execution!.id});await value.review.whenIdle();state=await value.selected.workflow.snapshot();
  const unknownUnpause=projectMigrationState(lostReceipt(state,'resume'),value.selected.plan);assert.equal(unknownUnpause.facts.activeStore,'unknown');assert.equal(unknownUnpause.facts.writesPaused,null);assert.equal(unknownUnpause.canRecover,false);
});
test('a verified selected migration cannot label another assessed replacement as safe',async t=>{
  const value=await prepared(t);await value.review.action({action:'start',hostId:value.options.id,reviewId:value.view.review!.id});await value.review.whenIdle();const view=value.review.snapshot(),selected=view.assessment.report!.changes[0]!,other={...selected,id:'another-store-change',label:'Another store'};
  assert.equal(view.review?.changeId,selected.id);assert.equal(view.execution?.changeId,selected.id);assert.equal(migrationChangeLabel(selected,view.execution,view.review),'Replace safely');assert.equal(migrationChangeLabel(other,view.execution,view.review),'Needs attention');assert.equal(migrationChangeLabel(selected,view.execution),'Needs attention');
});
test('same-schema physical SQLite source replacement after assessment is refused before plan admission',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'lens-sqlite-identity-'));t.after(()=>rm(directory,{recursive:true,force:true}));const {host,fixture}=await createSqliteMigrationHost(directory),options=host.migration!,review=new MigrationReview(options,()=>{},()=>{});t.after(()=>review.dispose());await review.initialize();await review.action({action:'assess',hostId:options.id});await review.whenIdle();const view=review.snapshot(),path=fixture.consumer.store.databasePath('conversations-v1'),replacement=path+'.new',retained=path+'.original';
  await copyFile(path,replacement);await chmod(replacement,0o600);await rename(path,retained);await rename(replacement,path);
  await assert.rejects(()=>review.action({action:'preview',hostId:options.id,planId:view.plans[0]!.id,assessmentDigest:view.assessment.report!.digest}),/plan was refused/);assert.equal(review.snapshot().review,undefined);assert.equal((await fixture.consumer.status()).writesPaused,false);
});
