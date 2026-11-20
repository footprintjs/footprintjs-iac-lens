import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import test,{type TestContext} from 'node:test';
import {startDashboard} from '../src/server/index.ts';
import type {DiagramSymbolPack} from '../src/core/system-symbols.ts';

function pack():DiagramSymbolPack {return{version:1,id:'consumer-vectors',symbols:[{id:'consumer-object',viewBox:{width:32,height:32},paths:[{d:'M2 2 H30 V30 H2 Z',fill:'surface',stroke:'ink'}]}],bindings:[{targetId:'registered-target',topologyId:'registered-system',subject:'component',subjectId:'app',symbolId:'consumer-object'}]};}
async function fixture(t:TestContext,diagramSymbols?:DiagramSymbolPack) {
 const directory=await mkdtemp(join(tmpdir(),'iac-lens-symbols-')),staticDirectory=join(directory,'public');
 let running:Awaited<ReturnType<typeof startDashboard>>|undefined;
 t.after(async()=>{await running?.close();await rm(directory,{recursive:true,force:true});});
 await mkdir(staticDirectory);await writeFile(join(staticDirectory,'index.html'),'<p>Consumer test</p>');
 running=await startDashboard({directory:join(directory,'state'),staticDirectory,diagramSymbols,readinessDelay:0});
 return running;
}
function hostileHost(url:string):Promise<number> {return new Promise((accept,reject)=>{const outgoing=request(url+'/api/diagram-symbols',{headers:{Host:'external.example'}},response=>{response.resume();response.on('end',()=>accept(response.statusCode!));});outgoing.on('error',reject);outgoing.end();});}

test('consumer symbols have a read-only same-origin route without changing recorded infrastructure state',async t=>{
 const input=pack(),running=await fixture(t,input),before=running.controller.getSnapshot();
 const response=await fetch(running.url+'/api/diagram-symbols');assert.equal(response.status,200);assert.match(response.headers.get('content-type')??'',/application\/json/);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),input);
 const mutate=await fetch(running.url+'/api/diagram-symbols',{method:'POST',headers:{origin:running.url,'content-type':'application/json'},body:JSON.stringify({command:'deploy'})});assert.equal(mutate.status,405);
 assert.equal((await fetch(running.url+'/api/diagram-symbols',{headers:{origin:'https://external.example'}})).status,403);assert.equal(await hostileHost(running.url),403);
 assert.deepEqual(running.controller.getSnapshot(),before);assert.equal((before as unknown as Record<string,unknown>).diagramSymbols,undefined,'presentation is not injected into native evidence');
});

test('hosts without a symbol pack return an explicit empty presentation',async t=>{
 const running=await fixture(t);assert.equal((await fetch(running.url+'/api/diagram-symbols')).status,200);assert.equal(await(await fetch(running.url+'/api/diagram-symbols')).json(),null);
});

test('invalid presentation is refused before creating a controller state directory',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'iac-lens-invalid-symbols-'));t.after(()=>rm(directory,{recursive:true,force:true}));const stateDirectory=join(directory,'not-created');
 await assert.rejects(startDashboard({directory:stateDirectory,staticDirectory:directory,diagramSymbols:{...pack(),symbols:[{id:'bad',viewBox:{width:32,height:32},paths:[{d:'<script/>'}]}]}}),/Invalid diagram symbol pack/);
 await assert.rejects(access(stateDirectory),{code:'ENOENT'});
});
