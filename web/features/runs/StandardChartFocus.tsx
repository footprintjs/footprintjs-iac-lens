import {useEffect} from 'react';
import {useReactFlow} from '@xyflow/react';

export interface StepFocus {id:string;sequence:number}

/** User navigation changes only the standard chart camera, never its replay cursor. */
export function StandardChartFocus({request}:{request?:StepFocus}) {
 const {fitView}=useReactFlow();
 useEffect(()=>{
  if(!request)return;
  void fitView({nodes:[{id:request.id}],padding:.4,minZoom:.4,maxZoom:1.2,
   duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:280});
 },[request,fitView]);
 return null;
}
