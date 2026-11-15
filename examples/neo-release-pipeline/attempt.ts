import { randomUUID } from 'node:crypto';
import { readFile,stat,writeFile,rename,mkdir,rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { readPipelineSelection, type PipelineSelection } from '../../src/core/pipeline.ts';
export interface NeoLensAttempt { version:1; hostDigest:string; id:string; selection:PipelineSelection }
export async function loadNeoLensAttempt(path:string,hostDigest:string):Promise<NeoLensAttempt|undefined>{
  try{const info=await stat(path);if(!info.isFile()||info.size>64*1024)throw Error('Invalid retained Neo attempt');
    const value=JSON.parse(await readFile(path,'utf8')) as Record<string,unknown>;
    if(Object.keys(value).some(key=>!['version','hostDigest','id','selection'].includes(key))||value.version!==1||value.hostDigest!==hostDigest||typeof value.id!=='string'||!/^neo-[a-f0-9-]{36}$/.test(value.id))throw Error('The retained Neo attempt belongs to another host configuration');
    return{version:1,hostDigest,id:value.id,selection:readPipelineSelection(value.selection)};
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
}
export async function saveNeoLensAttempt(path:string,attempt:NeoLensAttempt):Promise<void>{
  await mkdir(dirname(path),{recursive:true,mode:0o700});const temporary=path+'.'+randomUUID()+'.tmp';
  try{await writeFile(temporary,JSON.stringify(attempt,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temporary,path);}finally{await rm(temporary,{force:true});}
}
