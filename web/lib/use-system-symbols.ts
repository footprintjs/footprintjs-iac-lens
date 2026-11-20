import {useEffect,useState} from 'react';
import {createSystemSymbolAdapter,type SystemSymbolAdapter} from '../../src/core/system-symbols.ts';

/** Optional presentation only. Loading a pack never changes the selected run or its evidence. */
export function useResolvedSystemSymbols(baseUrl:string,provided?:SystemSymbolAdapter):SystemSymbolAdapter|undefined {
 const [remote,setRemote]=useState<{baseUrl:string;adapter?:SystemSymbolAdapter}>();
 useEffect(()=>{
  if(provided)return;
  const controller=new AbortController();let current=true;
  const load=async()=>{
   try{
    const response=await fetch(`${baseUrl.replace(/\/$/,'')}/api/diagram-symbols`,{signal:controller.signal});
    if(!response.ok)throw Error('Optional symbol adapter unavailable');
    const pack:unknown=await response.json();
    const adapter=pack===null?undefined:createSystemSymbolAdapter(pack);
    if(current)setRemote({baseUrl,adapter});
   }catch{if(current)setRemote({baseUrl});}
  };
  void load();return()=>{current=false;controller.abort();};
 },[baseUrl,provided]);
 return provided??(remote?.baseUrl===baseUrl?remote.adapter:undefined);
}
