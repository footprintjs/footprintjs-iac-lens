import {useEffect,useRef,useState} from 'react';
import {getViewportForBounds,type Rect,type Viewport} from '@xyflow/react';

interface DiagramCameraOptions {padding?:number;maxFitZoom?:number;minZoom?:number}

/** Fit the complete authored geometry, including routes outside node bounds. */
export function fitDiagramCamera(bounds:Rect,size:{width:number;height:number},options:DiagramCameraOptions={}):Viewport|undefined {
  if(![bounds.x,bounds.y,bounds.width,bounds.height,size.width,size.height].every(Number.isFinite)
    ||bounds.width<=0||bounds.height<=0||size.width<=0||size.height<=0)return;
  return getViewportForBounds(bounds,size.width,size.height,options.minZoom??.01,options.maxFitZoom??1,`${options.padding??24}px`);
}

/** One controlled EUI camera; progress updates preserve the user's pan and zoom. */
export function useDiagramCamera(bounds:Rect,{padding=24,maxFitZoom=1,minZoom=.01}:DiagramCameraOptions={}) {
  const containerRef=useRef<HTMLDivElement>(null);
  const [size,setSize]=useState({width:0,height:0});
  const [viewport,setViewport]=useState<Viewport>({x:0,y:0,zoom:1});
  const hasBounds=bounds.width>0&&bounds.height>0;
  useEffect(()=>{
    const element=containerRef.current;if(!element)return;
    const measure=()=>{const {width,height}=element.getBoundingClientRect();setSize(previous=>previous.width===width&&previous.height===height?previous:{width,height});};
    measure();
    const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();
  },[hasBounds]);
  useEffect(()=>{
    const fitted=fitDiagramCamera(bounds,size,{padding,maxFitZoom,minZoom});if(fitted)setViewport(fitted);
  },[bounds.x,bounds.y,bounds.width,bounds.height,size.width,size.height,padding,maxFitZoom,minZoom]);
  return{containerRef,viewport,onViewportChange:setViewport};
}
