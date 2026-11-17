import {useCallback,useEffect,useMemo,useState} from 'react';
import {createRunHistoryClient,type RunCatalog,type RunRecord} from '../../../src/core/run-history.ts';
import type {DashboardState} from '../../../src/core/types.ts';

/** Fetching viewer history is read-only; live execution stays with the existing host. */
export function useRunHistory(baseUrl:string,state:DashboardState,selectedId:string|undefined) {
 const client=useMemo(()=>createRunHistoryClient({baseUrl}),[baseUrl]);
 const [catalog,setCatalog]=useState<RunCatalog>(),[record,setRecord]=useState<RunRecord>(),[catalogError,setCatalogError]=useState<string>(),[recordError,setRecordError]=useState<string>(),[attempt,setAttempt]=useState(0),[loading,setLoading]=useState(false);
 const refresh=useCallback(()=>setAttempt(value=>value+1),[]);
 const catalogActive=!!catalog?.runs.some(run=>run.status==='running'),selectedActive=!!catalog?.runs.some(run=>run.id===selectedId&&run.status==='running');
 useEffect(()=>{
  let live=true,request=0;const controller=new AbortController();
  const list=()=>{const current=++request;void client.list(controller.signal).then(value=>{if(live&&current===request){setCatalog(value);setCatalogError(undefined);}},()=>{if(live&&current===request)setCatalogError('Recent runs could not be opened.');});};
  list();const timer=state.busy||catalogActive?setInterval(list,1000):undefined;
  return()=>{live=false;controller.abort();if(timer)clearInterval(timer);};
 },[client,state.run?.id,state.run?.status,state.busy,state.onboarding?.status,state.onboarding?.busy,catalogActive,attempt]);
 useEffect(()=>{
  setRecord(previous=>previous?.summary.id===selectedId?previous:undefined);setRecordError(undefined);if(!selectedId){setLoading(false);return;}
  setLoading(true);
  let live=true,request=0;const controller=new AbortController();
  const read=()=>{const current=++request;void client.read(selectedId,controller.signal).then(value=>{if(live&&current===request){setRecord(value);setRecordError(undefined);setLoading(false);}},()=>{if(live&&current===request){setRecordError('This recording could not be opened.');setLoading(false);}});};
  read();const timer=state.busy||selectedActive?setInterval(read,1000):undefined;
  return()=>{live=false;controller.abort();if(timer)clearInterval(timer);};
 },[client,selectedId,state.run?.id,state.run?.status,state.busy,state.onboarding?.status,state.onboarding?.busy,selectedActive,attempt]);
 return {catalog,record,error:recordError??catalogError,refresh,loading};
}
