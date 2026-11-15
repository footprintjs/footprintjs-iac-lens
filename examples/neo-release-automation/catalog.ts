import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {GitHubReleaseCatalog} from 'footprintjs-iac/releases/github';
import {readResolvedReleaseChoice,type ReleaseCatalog,type ReleaseChoice} from 'footprintjs-iac/releases';
import type {NeoReleaseWatcherConfig} from './config.ts';
const execute=promisify(execFile);
/** No token reaches URLs, state, browser payloads or diagnostic text. */
export async function localGitHubToken():Promise<string|undefined>{
  if(process.env.GITHUB_TOKEN)return process.env.GITHUB_TOKEN;
  try{return(await execute('gh',['auth','token'],{timeout:10_000,maxBuffer:16_384})).stdout.trim()||undefined;}catch{return undefined;}
}
/** Composition over catalog ports. Published GitHub releases and reviewed manual pins keep separate IDs. */
export function neoReleaseWatcherCatalog(config:NeoReleaseWatcherConfig,github:ReleaseCatalog=new GitHubReleaseCatalog({id:config.id+'-github',repository:config.repository,token:localGitHubToken})):ReleaseCatalog{
  let listed=new Map<string,'github'|'manual'>();
  return{id:config.id+'-sources',async list(){
    const published=await github.list(),manual=config.manualSources.map(readResolvedReleaseChoice);
    const choices:ReleaseChoice[]=[...published,...manual];
    if(new Set(choices.map(choice=>choice.id)).size!==choices.length)throw Error('Release catalogs contain colliding IDs');
    listed=new Map([...published.map(choice=>[choice.id,'github'] as const),...manual.map(choice=>[choice.id,'manual'] as const)]);
    return choices;
  },async resolve(id){
    if(listed.get(id)==='github')return github.resolve(id);
    if(listed.get(id)==='manual')return readResolvedReleaseChoice(config.manualSources.find(choice=>choice.id===id));
    throw Error('Choose a discovered source ID');
  }};
}
