import assert from 'node:assert/strict';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defineReleaseManifest } from 'footprintjs-iac/releases/node';
import { neoReleasePipelineCatalog } from '../examples/neo-release-pipeline/catalog.ts';
import { loadNeoLensAttempt,saveNeoLensAttempt } from '../examples/neo-release-pipeline/attempt.ts';
import { readNeoReleaseHostConfig } from '../examples/neo-release-pipeline/config.ts';
import { readPipelineCatalog,admitPipelineSelection,defaultPipelineSelection } from '../src/core/pipeline.ts';
const manifest=defineReleaseManifest({id:'neo-v2',label:'Prepared Neo',source:{repository:'https://github.com/example/neo',ref:'v2',commit:'a'.repeat(40),tree:'b'.repeat(40)},recipe:{id:'build',digest:'c'.repeat(64)},artifacts:[{id:'neo',digest:'d'.repeat(64),reference:'example/neo:prepared'}]});
const options={id:'neo-host',directory:'/private/host-directory',environments:[{id:'local',label:'Local Neo',targetPath:'/private/canonical-target.json',promotion:'automatic' as const,rollback:'disabled' as const}],releases:[{manifest,publication:{artifacts:[...manifest.artifacts],metadata:{candidatePath:'/private/candidate',credential:'private-secret'}}}]};
test('Neo consumer catalog retains prepared identity and never exposes private publications or unsupported strategies',()=>{
  const catalog=readPipelineCatalog(neoReleasePipelineCatalog(options));const selection=defaultPipelineSelection(catalog);
  assert.equal(catalog.simulation,false);assert.equal(catalog.releases[0]?.digest,manifest.digest);assert.deepEqual(catalog.strategies.map(strategy=>strategy.id),['direct']);assert.deepEqual(catalog.checks,[]);assert.deepEqual(catalog.schedules,[]);
  const serialized=JSON.stringify(catalog);assert.equal(serialized.includes('/private'),false);assert.equal(serialized.includes('private-secret'),false);
  for(const patch of [{strategyId:'canary'},{rollback:'manual'},{checkIds:['skip-access']},{scheduleId:'timer'}]){const changed=structuredClone(selection);Object.assign(changed.stages[0]!,patch);assert.throws(()=>admitPipelineSelection(catalog,changed));}
});
test('retained Neo attempts bind private host configuration and local config refuses injected executable options',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'neo-lens-config-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,'current.json'),selection=defaultPipelineSelection(neoReleasePipelineCatalog(options));
  await saveNeoLensAttempt(path,{version:1,hostDigest:'a'.repeat(64),id:'neo-00000000-0000-0000-0000-000000000000',selection});
  assert.equal((await loadNeoLensAttempt(path,'a'.repeat(64)))?.selection.releaseId,'neo-v2');await assert.rejects(()=>loadNeoLensAttempt(path,'b'.repeat(64)),/another host configuration/);
  const config=join(directory,'host.json');await writeFile(config,JSON.stringify({...options,command:'unsafe',runner:'unapproved'}));await assert.rejects(()=>readNeoReleaseHostConfig(config),/Configure registered/);
});
