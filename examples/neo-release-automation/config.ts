import {readFile,stat} from 'node:fs/promises';
import {readResolvedReleaseChoice,type ResolvedReleaseChoice} from 'footprintjs-iac/releases';
import type {NeoPreparedRelease,NeoReleaseEnvironment} from 'footprintjs-iac/integration/identity/release-pipeline';

export interface NeoReleaseWatcherConfig {
  id:string;label:string;directory:string;repository:string;
  environments:NeoReleaseEnvironment[];baselineReleases:NeoPreparedRelease[];
  automatic:{enabled:boolean;initial:'observe'|'latest'};intervalMs:number;
  /** Private host registrations, useful before the repository publishes its first release. */
  manualSources:ResolvedReleaseChoice[];
}
export async function readNeoReleaseWatcherConfig(path:string):Promise<NeoReleaseWatcherConfig>{
  const info=await stat(path);if(!info.isFile()||info.size>2*1024*1024)throw Error('Choose a private bounded Neo release host file');
  const value=JSON.parse(await readFile(path,'utf8')) as NeoReleaseWatcherConfig;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['id','label','directory','repository','environments','baselineReleases','automatic','intervalMs','manualSources'].includes(key))
    ||!/^[-A-Za-z0-9_.]{1,100}$/.test(value.id)||typeof value.label!=='string'||!value.label.trim()||value.label.length>160||typeof value.directory!=='string'
    ||!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(value.repository)||!Array.isArray(value.environments)||!value.environments.length||value.environments.length>8
    ||!Array.isArray(value.baselineReleases)||!value.baselineReleases.length||value.baselineReleases.length>64||!value.automatic||typeof value.automatic.enabled!=='boolean'||!['observe','latest'].includes(value.automatic.initial)
    ||Object.keys(value.automatic).some(key=>!['enabled','initial'].includes(key))||!Number.isSafeInteger(value.intervalMs)||value.intervalMs<30_000||value.intervalMs>3_600_000
    ||!Array.isArray(value.manualSources)||value.manualSources.length>64)throw Error('Register explicit Neo release policies and targets');
  value.manualSources=value.manualSources.map(readResolvedReleaseChoice);
  if(value.manualSources.some(choice=>choice.publishedAt||choice.source.repository!==`https://github.com/${value.repository}.git`||!choice.id.startsWith('reviewed-'))
    ||new Set(value.manualSources.map(choice=>choice.id)).size!==value.manualSources.length)throw Error('Reviewed manual sources must bind this repository and cannot masquerade as published releases');
  return value;
}
