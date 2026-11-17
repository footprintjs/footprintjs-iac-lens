import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startDashboard} from '../src/server/server.ts';
import type {RunCatalog,RunRecord,RunRepository} from '../src/core/run-history.ts';

test('the registered run-history adapter is read-only and browser IDs cannot select a file or another run',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'lens-run-api-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const id='a'.repeat(64),summary={id,runId:'recorded-script',label:'Process a report',kind:'workflow' as const,status:'ready' as const,sequence:1,frameCount:0,replayAvailable:false,timing:'steps' as const,appVerified:false,limitations:['Saved result only']};
 let lists=0,reads=0;const repository:RunRepository={async list():Promise<RunCatalog>{lists++;return{version:1,runs:[summary],omitted:0,limitations:[]};},async read(key):Promise<RunRecord|undefined>{reads++;assert.equal(key,id);return{version:1,summary,frames:[],omittedFrames:0,limitations:summary.limitations};}};
 const app=await startDashboard({directory,staticDirectory:directory,runRepository:repository});t.after(()=>app.close());
 const index=await fetch(app.url+'/api/runs');assert.equal(index.status,200);assert.equal((await index.json()).runs[0].label,'Process a report');
 const result=await fetch(app.url+'/api/runs/'+id);assert.equal(result.status,200);assert.equal((await result.json()).summary.runId,'recorded-script');
 for(const key of ['%2Fetc%2Fpasswd','not-a-run','a'.repeat(65)])assert.equal((await fetch(app.url+'/api/runs/'+key)).status,404);
 assert.equal(reads,1);assert.equal(lists,1);
 assert.equal((await fetch(app.url+'/api/runs',{headers:{origin:'https://foreign.example'}})).status,403);
 assert.equal((await fetch(app.url+'/api/runs/'+id,{method:'POST'})).status,405);
 assert.equal(app.controller.getSnapshot().run?.status,'idle','listing and replaying a script never executes any configured work');
});
test('history transport failures cannot expose private adapter exceptions',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'lens-run-private-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const secret='PRIVATE-ARCHIVE-CREDENTIAL';
 const repository:RunRepository={async list(){throw Error(secret);},async read(){throw Error(secret);}};
 const app=await startDashboard({directory,staticDirectory:directory,runRepository:repository});t.after(()=>app.close());
 for(const path of ['/api/runs','/api/runs/'+'b'.repeat(64)]){const response=await fetch(app.url+path);assert([409,503].includes(response.status));assert.doesNotMatch(await response.text(),new RegExp(secret));}
});
