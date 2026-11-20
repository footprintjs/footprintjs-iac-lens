import {useEffect,useRef} from 'react';
import {useReactFlow,type Rect} from '@xyflow/react';
import {fitDiagramCamera} from '../../lib/diagram-camera.ts';
import {fitSystemCameraFocus,type SystemCameraFocus} from './system-camera-focus.ts';

/** The released canvas animates only area transitions, never individual work steps. */
export function SystemChartFocus({bounds,size,focus,enabled,runKey}:{bounds:Rect;size:{width:number;height:number};focus?:SystemCameraFocus;enabled:boolean;runKey:string}) {
 const {setViewport,getViewport,viewportInitialized}=useReactFlow();
 const applied=useRef<string>(),previousSize=useRef<string>();
 const sizeKey=`${size.width}:${size.height}`;
 const geometryKey=JSON.stringify([bounds,focus?.bounds,focus?.contextBounds]);
 const requestKey=`${runKey}:${focus?.key??'overview'}:${sizeKey}:${geometryKey}`;
 useEffect(()=>{
  if(!viewportInitialized||size.width<=0||size.height<=0)return;
  if(!enabled&&previousSize.current){applied.current=undefined;return;}
  if(applied.current===requestKey)return;
  const target=enabled&&focus?fitSystemCameraFocus(bounds,focus.bounds,size,focus.contextBounds):fitDiagramCamera(bounds,size);
  if(!target)return;
  const resized=previousSize.current!==sizeKey;
  const duration=resized||window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:420;
  previousSize.current=sizeKey;applied.current=requestKey;
  void setViewport(target,{duration,interpolate:'linear'});
  // A manual pan/zoom disables Follow and interrupts an in-flight transition.
  return()=>{void setViewport(getViewport(),{duration:0});};
 },[enabled,requestKey,sizeKey,viewportInitialized,setViewport,getViewport]);
 return null;
}
