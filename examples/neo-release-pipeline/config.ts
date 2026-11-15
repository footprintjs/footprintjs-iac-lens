import { readFile,stat } from 'node:fs/promises';
import type { NeoReleasePipelineOptions } from 'footprintjs-iac/integration/identity/release-pipeline';
/** This is a private local host file. HTTP clients can select none of its paths or provider options. */
export async function readNeoReleaseHostConfig(path:string):Promise<NeoReleasePipelineOptions>{
  const info=await stat(path);if(!info.isFile()||info.size>2*1024*1024)throw Error('Choose a regular host configuration smaller than 2 MiB');
  const value=JSON.parse(await readFile(path,'utf8')) as Record<string,unknown>;
  if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(key=>!['id','directory','environments','releases'].includes(key))||!Array.isArray(value.environments)||!value.environments.length||value.environments.length>12||!Array.isArray(value.releases)||!value.releases.length||value.releases.length>64)throw Error('Configure registered Neo environments and prepared releases');
  // The base consumer performs full manifest, publication, canonical-target and capability admission.
  return value as unknown as NeoReleasePipelineOptions;
}
