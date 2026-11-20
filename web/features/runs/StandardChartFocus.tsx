import {useCallback,useEffect,useRef} from 'react';
import {useNodes,useReactFlow,useStore} from '@xyflow/react';

export interface StepFocus {id:string;sequence:number}

/** A scope entry fits its whole chart; recorded step changes never move the camera. */
export function StandardChartFocus({request,followIds}:{request?:StepFocus;followIds?:readonly string[]}) {
 const nodes=useNodes(),{fitView,viewportInitialized}=useReactFlow();
 const mode=followIds!==undefined?'follow':request?'manual':'initial';
 const overview=mode!=='manual';
 // TracedFlow is keyed by the selected scope. Its running frontier may change
 // every publication, but only a new scope (or an explicit user request) fits.
 const ids=mode==='manual'?[request!.id]:nodes.filter(node=>!node.hidden).map(node=>node.id).sort();
 const idsKey=JSON.stringify(ids),requestKey=mode==='manual'?`manual:${request!.sequence}:${request!.id}`:mode;
 const geometry=useStore(useCallback(store=>{
  const rows=JSON.parse(idsKey) as string[];
  if(!rows.length)return '';
  const measured=rows.map(id=>store.nodeLookup.get(id));
  if(measured.some(node=>!node||!node.measured?.width||!node.measured?.height))return '';
  return JSON.stringify(measured.map(node=>[node!.id,node!.internals.positionAbsolute,node!.measured]));
 },[idsKey]));
 const fitted=useRef<string>();
 useEffect(()=>{
  if(!viewportInitialized||!geometry||(mode==='initial'&&fitted.current)||fitted.current===requestKey)return;
  // Let the standard renderer apply its measured layout before the one fit.
  // A measurement/position change cancels this presentation-only settling pass.
  let frame=requestAnimationFrame(()=>{
   frame=requestAnimationFrame(()=>{
    fitted.current=requestKey;
    void fitView({nodes:JSON.parse(idsKey).map((id:string)=>({id})),padding:overview?0.12:0.4,minZoom:.01,maxZoom:overview?1:1.2,
     duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:280});
   });
  });
  return()=>cancelAnimationFrame(frame);
 },[requestKey,geometry,viewportInitialized,fitView,mode,idsKey,overview]);
 return null;
}
