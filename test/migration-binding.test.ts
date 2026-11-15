import assert from 'node:assert/strict';
import { mkdtemp,rm,lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSqliteMigrationHost } from '../examples/sqlite-migration/create-host.ts';
import { MigrationReview } from '../src/server/migration.ts';
import type { MigrationState,MigrationWorkflowPort } from 'footprintjs-iac/migration';

test('changed final migration bindings are quarantined even without subscriptions, before any unsafe UI approval or repeat action',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'lens-migration-binding-'));t.after(()=>rm(directory,{recursive:true,force:true}));const {host,fixture}=await createSqliteMigrationHost(directory),options=host.migration!,prepare=options.prepare;let starts=0;
  options.prepare=async(planId,report)=>{const prepared=await prepare(planId,report),idle=await prepared.workflow.snapshot(),changed=structuredClone(idle);changed.definition.destination.id='unregistered-store';
    const workflow:MigrationWorkflowPort={async snapshot(){return idle;},async start(){starts++;return changed;},async cutover(){throw Error('No approval expected');},async recover(){throw Error('No recovery expected');},subscribe(){return()=>{};}};return{plan:prepared.plan,workflow};};
  const review=new MigrationReview(options,()=>{},()=>{});t.after(()=>review.dispose());await review.initialize();await review.action({action:'assess',hostId:options.id});await review.whenIdle();let view=review.snapshot();
  await review.action({action:'preview',hostId:view.id,planId:view.plans[0]!.id,assessmentDigest:view.assessment.report!.digest});view=review.snapshot();await review.action({action:'start',hostId:view.id,reviewId:view.review!.id});await review.whenIdle();view=review.snapshot();
  assert.equal(starts,1);assert.equal(view.execution?.status,'incomplete');assert.equal(view.execution?.needsInspection,true);assert.equal(view.execution?.canCutover,false);assert.equal(view.execution?.canRecover,false);assert.equal((await fixture.consumer.status()).writesPaused,false);await assert.rejects(()=>lstat(fixture.consumer.store.databasePath('conversations-v2')),{code:'ENOENT'});
  await assert.rejects(()=>review.action({action:'start',hostId:view.id,reviewId:view.review!.id}),/binding before another action/);
});
test('changed native subscription identities do not silently leave a stale actionable migration view',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'lens-migration-subscription-'));t.after(()=>rm(directory,{recursive:true,force:true}));const {host}=await createSqliteMigrationHost(directory),options=host.migration!,prepare=options.prepare;let emit:((state:MigrationState)=>void)|undefined,initial:MigrationState|undefined;
  options.prepare=async(planId,report)=>{const prepared=await prepare(planId,report);initial=await prepared.workflow.snapshot();return{plan:prepared.plan,workflow:{...prepared.workflow,snapshot:prepared.workflow.snapshot.bind(prepared.workflow),start:prepared.workflow.start.bind(prepared.workflow),cutover:prepared.workflow.cutover.bind(prepared.workflow),recover:prepared.workflow.recover.bind(prepared.workflow),subscribe(listener){emit=listener;return()=>{};}}};};
  const review=new MigrationReview(options,()=>{},()=>{});t.after(()=>review.dispose());await review.initialize();await review.action({action:'assess',hostId:options.id});await review.whenIdle();let view=review.snapshot();await review.action({action:'preview',hostId:view.id,planId:view.plans[0]!.id,assessmentDigest:view.assessment.report!.digest});
  const changed=structuredClone(initial!);changed.definitionDigest='0'.repeat(64);emit!(changed);view=review.snapshot();assert.equal(view.execution?.status,'incomplete');assert.match(view.error!,/binding changed/);assert.equal(view.execution?.canCutover,false);
});
