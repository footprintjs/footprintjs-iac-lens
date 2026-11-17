import type { JsonFetch } from './client.ts';
import { readRunCatalog, readRunRecord, runOpaqueId } from './run-history-data.ts';
import type { RunCatalog, RunRecord } from './run-history.ts';
export interface RunHistoryClient { list(signal?:AbortSignal):Promise<RunCatalog>; read(id:string,signal?:AbortSignal):Promise<RunRecord|undefined> }
export interface RunHistoryClientOptions { baseUrl?:string; fetch?:JsonFetch }
/** An observation-only client. No replay action can call deployment or source preparation. */
export function createRunHistoryClient(options:RunHistoryClientOptions={}):RunHistoryClient {
 const base=(options.baseUrl??'').replace(/\/$/,''),request=options.fetch??((url,init)=>globalThis.fetch(url,init));
 return Object.freeze({
  async list(signal?:AbortSignal){const response=await request(base+'/api/runs',{method:'GET',signal});if(!response.ok)throw Error('Recent runs could not be read');return readRunCatalog(await response.json());},
  async read(id:string,signal?:AbortSignal){runOpaqueId(id);const response=await request(base+'/api/runs/'+id,{method:'GET',signal});if(response.status===404)return;if(!response.ok)throw Error('The recorded run could not be read');return readRunRecord(await response.json());},
 });
}
