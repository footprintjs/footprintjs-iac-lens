import {useLayoutEffect,useRef,useState} from 'react';
import {fitSystemTopology,type TopologySize} from './topology-fit.ts';
/** Observe the rendered viewport instead of assuming a particular laptop or sidebar size. */
export function useTopologyFit(geometry:TopologySize) {
 const viewportRef=useRef<HTMLDivElement>(null),[viewport,setViewport]=useState({width:0,height:0});
 useLayoutEffect(()=>{
  const element=viewportRef.current;if(!element)return;
  const measure=()=>{const width=element.clientWidth,height=element.clientHeight;setViewport(previous=>previous.width===width&&previous.height===height?previous:{width,height});};
  measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();
 },[]);
 return {viewportRef,...fitSystemTopology(geometry,viewport)};
}
