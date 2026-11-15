import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSqliteMigrationHost } from '../examples/sqlite-migration/create-host.ts';
import { MigrationReview } from '../src/server/migration.ts';
import { readMigrationAction,readMigrationExecution,readMigrationReview } from '../src/core/migration.ts';
const compiled=await build({stdin:{contents:"export { MigrationPanel } from './web/components/MigrationPanel.tsx'; export { MigrationDetails } from './web/components/MigrationDetails.tsx';",resolveDir:import.meta.dirname+'/..',loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'});
const cache=join(import.meta.dirname,'../.artifacts');await mkdir(cache,{recursive:true});const renderDirectory=await mkdtemp(join(cache,'migration-render-'));let components;
try{const file=join(renderDirectory,'render.mjs');await writeFile(file,compiled.outputFiles[0]!.text);components=await import(pathToFileURL(file).href);}finally{await rm(renderDirectory,{recursive:true,force:true});}
const noop=()=>{};
test('a real migration stays planned and unproven until native data checks; only the exact recorded gate offers a switch',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'lens-migration-render-'));t.after(()=>rm(directory,{recursive:true,force:true}));const {host}=await createSqliteMigrationHost(directory),review=new MigrationReview(host.migration!,noop,noop);t.after(()=>review.dispose());await review.initialize();
  const render=()=>renderToStaticMarkup(createElement(components.MigrationPanel,{view:review.snapshot(),disabled:false,onAction:noop}));
  let html=render();assert.match(html,/Cooperative consumer/);assert.match(html,/Read-only review/);assert.match(html,/No deployment effects/);assert.doesNotMatch(html,/Replace safely|Approve switch/);assert.doesNotMatch(html,/type="(?:password|url)"|textarea/);
  await review.action({action:'assess',hostId:review.snapshot().id});await review.whenIdle();let view=review.snapshot();
  html=render();assert.match(html,/Needs attention/);assert.doesNotMatch(html,/Replace safely/);assert.match(html,/Preview the data move/);
  await review.action({action:'preview',hostId:view.id,planId:view.plans[0]!.id,assessmentDigest:view.assessment.report!.digest});view=review.snapshot();html=render();
  assert.match(html,/Ready to move data/);assert.match(html,/Planned migration/);assert.match(html,/No migration effects yet/);assert.equal((html.match(/class="migration-step migration-step-pending"/g)??[]).length,10);assert.doesNotMatch(html,/Approve switch|Replace safely/);
  assert.throws(()=>readMigrationReview({...view.review,steps:view.review!.steps.toReversed()}));
  await review.action({action:'start',hostId:view.id,reviewId:view.review!.id});await review.whenIdle();view=review.snapshot();html=render();
  assert.match(html,/Recorded migration/);assert.match(html,/Await approval/);assert.match(html,/Approve switch/);assert.match(html,/Original store/);assert.match(html,/Replace safely/);assert.match(html,/Writes are paused/);assert.equal((html.match(/class="migration-step migration-step-passed"/g)??[]).length,6);
  assert.throws(()=>readMigrationExecution({...view.execution,facts:{...view.execution!.facts,dataChecked:false}}));assert.throws(()=>readMigrationExecution({...view.execution,facts:{...view.execution!.facts,writesPaused:false}}));
  const details=renderToStaticMarkup(createElement(components.MigrationDetails,{view}));assert.match(details,/declared-contract/);assert.match(details,/Recorded operations/);assert.match(details,/Native segments/);
  for(const privateValue of [directory,'Private π conversation','Bob message history','UPDATE messages']){assert.equal(html.includes(privateValue),false);assert.equal(details.includes(privateValue),false);}
});
test('migration action admission never evaluates accessors or accepts database handles, approval bodies or deletion actions',()=>{
  let reads=0;const accessor={hostId:'host'};Object.defineProperty(accessor,'action',{enumerable:true,get(){reads++;return'assess';}});assert.throws(()=>readMigrationAction(accessor));assert.equal(reads,0);
  assert.throws(()=>readMigrationAction({action:'delete',hostId:'host'}));assert.throws(()=>readMigrationAction({action:'preview',hostId:'host',planId:'../database',assessmentDigest:'a'.repeat(64)}));
  assert.throws(()=>readMigrationAction({action:'cutover',hostId:'host',executionId:'execution',token:'server-owned'}));assert.throws(()=>readMigrationAction({action:'cutover',hostId:'host',executionId:'execution',checkpoint:{source:'/private'}}));
});
