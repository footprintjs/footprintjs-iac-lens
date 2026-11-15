import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const fixture = `export function createApplicationHost({directory}) {
 return { version:1, id:'registered-app', label:'Registered application',
 strategies:[{id:'server',label:'Existing server',targets:[{id:'owned-server',label:'Owned target',requiresProfile:false,requiredInspectionCheckIds:['target'],requiredVerificationCheckIds:['health']}]}],
 async snapshot(){return{};}, async inspect(){return{ok:true,checks:[{id:'target',label:'Target',status:'passed'}]};},
 async plan(){return{ok:true,reviewId:'sealed-review',changes:[]};}, async apply(){throw Error('No deployment authorized by this CLI test');} };
}`;
async function temporary(t: test.TestContext) {
 const cwd=await mkdtemp(join(tmpdir(),'lens-app-cli-')); t.after(()=>rm(cwd,{recursive:true,force:true}));return cwd;
}
function launch(cwd:string,args:string[]) {
 const child=spawn(process.execPath,[cli,...args],{cwd,stdio:['ignore','pipe','pipe']});let output='';
 child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
 const exited=once(child,'exit');return{child,exited,output:()=>output};
}
test('the installed CLI accepts an operator-owned application module without a core checkout',{timeout:15000},async t=>{
 const cwd=await temporary(t), module=join(cwd,'host.mjs'), directory=join(cwd,'state');await writeFile(module,fixture);
 const run=launch(cwd,['--host',module,'--port','0','--directory',directory]);
 t.after(async()=>{if(run.child.exitCode===null)run.child.kill('SIGTERM');await run.exited;});
 const url=await new Promise<string>((accept,reject)=>{run.child.stdout.on('data',()=>{const m=run.output().match(/InfraChart Lens: (http:\/\/127\.0\.0\.1:\d+)/);if(m)accept(m[1]!);});run.child.once('error',reject);run.child.once('exit',()=>reject(Error(run.output())));});
 const state=await(await fetch(url+'/api/state')).json();assert.equal(state.application.id,'registered-app');assert.equal(state.application.phase,'choose');
 const meta=JSON.parse(await readFile(join(directory,'server.json'),'utf8'));assert.equal(meta.applicationAvailable,true);assert.equal(meta.neoAvailable,false);
 assert.match(run.output(),/Registered application/);assert.doesNotMatch(run.output(),/simulator only/);
});
test('host startup failures do not leak private errors or fall back to simulation',{timeout:15000},async t=>{
 const cwd=await temporary(t), module=join(cwd,'host.mjs');await writeFile(module,`export function createApplicationHost(){throw Error('PRIVATE_CONNECTION_TOKEN');}`);
 const run=launch(cwd,['--host',module,'--port','0']);const[code]=await run.exited;assert.notEqual(code,0);
 assert.match(run.output(),/Application host could not be loaded/);assert.doesNotMatch(run.output(),/PRIVATE_CONNECTION_TOKEN|InfraChart Lens:|simulator only/);
});
test('an application module cannot be mixed with legacy prepared-target flags',{timeout:15000},async t=>{
 const cwd=await temporary(t), module=join(cwd,'host.mjs');await writeFile(module,fixture);
 const run=launch(cwd,['--host',module,'--neo','--port','0']);const[code]=await run.exited;assert.notEqual(code,0);assert.match(run.output(),/Choose an application host or a prepared Neo target/);assert.doesNotMatch(run.output(),/InfraChart Lens:/);
});

test('deferred private catalog failures stay outside CLI errors',{timeout:15000},async t=>{
 const cwd=await temporary(t), module=join(cwd,'host.mjs');
 const source=fixture.replace("strategies:[", "connectionProfiles:{schemas(){return[{id:'connection',label:'Connection',fields:[{name:'endpoint',label:'Address',kind:'url',required:true}]}];},async list(){throw Error('PRIVATE_CATALOG_TOKEN');},async register(){throw Error('Not used');},async test(){throw Error('Not used');}},strategies:[");
 await writeFile(module,source);
 const run=launch(cwd,['--host',module,'--port','0']);const[code]=await run.exited;assert.notEqual(code,0);
 assert.match(run.output(),/Application dashboard could not be started/);assert.doesNotMatch(run.output(),/PRIVATE_CATALOG_TOKEN|InfraChart Lens:/);
});
