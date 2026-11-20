import type {Rect,Viewport} from '@xyflow/react';
import type {SystemTopologyView} from 'footprintjs-iac/system-topology';
import {fitDiagramCamera} from '../../lib/diagram-camera.ts';
import type {SystemGraphPlacement} from './create-system-graph.ts';
import type {SystemExecutionFocus} from './execution-focus.ts';

export interface SystemCameraFocus {
  /** Physical areas, not stage or execution identities. */
  key:string;
  areaIds:readonly string[];
  bounds:Rect;
  /** Neighbours are camera context only; this does not mark them active. */
  contextBounds:Rect;
}

const valid=(box:Rect)=>[box.x,box.y,box.width,box.height].every(Number.isFinite)&&box.width>0&&box.height>0;
function union(boxes:readonly Rect[]):Rect|undefined {
  const known=boxes.filter(valid);if(!known.length)return;
  const x=Math.min(...known.map(box=>box.x)),y=Math.min(...known.map(box=>box.y));
  return{x,y,width:Math.max(...known.map(box=>box.x+box.width))-x,height:Math.max(...known.map(box=>box.y+box.height))-y};
}

/** Follow exact recorded actors at their enclosing area, keeping one camera target across its steps. */
export function selectSystemCameraFocus(view:SystemTopologyView,placement:SystemGraphPlacement,focus?:SystemExecutionFocus):SystemCameraFocus|undefined {
  if(!focus)return;
  const boundaries=new Map(view.boundaries.map(row=>[row.id,row]));
  const contains=(ancestor:string,id:string)=>{
    const seen=new Set<string>();let current:string|undefined=id;
    while(current&&!seen.has(current)){if(current===ancestor)return true;seen.add(current);current=boundaries.get(current)?.parentId;}
    return false;
  };
  const actors=view.nodes.filter(node=>focus.componentIds.includes(node.id)&&placement.boxes.has(node.id));
  // Boundary highlights include all ancestors. Exact component placement wins over those broad rows.
  const actorAreas=actors.map(node=>node.boundaryId&&boundaries.has(node.boundaryId)&&placement.boxes.has(node.boundaryId)?node.boundaryId:node.id);
  const otherBoundaries=[...new Set(focus.boundaryIds)].filter(id=>boundaries.has(id)&&placement.boxes.has(id)
    &&!actors.some(node=>!!node.boundaryId&&contains(id,node.boundaryId)));
  const boundaryAreas=otherBoundaries.filter(id=>!otherBoundaries.some(other=>other!==id&&contains(id,other)));
  const unique=[...new Set([...actorAreas,...boundaryAreas])];
  // A real actor can require the containing host, covering a separately focused child area too.
  const areaIds=unique.filter(id=>!unique.some(other=>other!==id&&contains(other,id))).sort();
  const boxes=areaIds.flatMap(id=>{const box=placement.boxes.get(id);return box?[box]:[];}),bounds=union(boxes);
  if(!bounds)return;
  const areaComponents=new Set(view.nodes.filter(node=>areaIds.some(id=>id===node.id||!!node.boundaryId&&contains(id,node.boundaryId))).map(node=>node.id));
  const neighbours=new Set<string>();
  for(const edge of view.connections){
    if(areaComponents.has(edge.from))neighbours.add(edge.to);
    if(areaComponents.has(edge.to))neighbours.add(edge.from);
  }
  const components=new Map(view.nodes.map(node=>[node.id,node])),contextIds=new Set(neighbours);
  // A neighbour's physical enclosure owns its artwork, caption and ground. Fit
  // every measured ancestor too, without adding any of them to active area IDs.
  for(const id of neighbours){
    const seen=new Set<string>();let boundaryId=boundaries.has(id)?id:components.get(id)?.boundaryId;
    while(boundaryId&&!seen.has(boundaryId)){
      seen.add(boundaryId);contextIds.add(boundaryId);boundaryId=boundaries.get(boundaryId)?.parentId;
    }
  }
  const contextBounds=union([...boxes,...[...contextIds].flatMap(id=>{const box=placement.boxes.get(id);return box?[box]:[];})])!;
  return{key:JSON.stringify(areaIds),areaIds,bounds,contextBounds};
}

/** A restrained focus: at most 18% closer than overview, with the whole active area still visible. */
export function fitSystemCameraFocus(systemBounds:Rect,focusBounds:Rect,size:{width:number;height:number},contextBounds?:Rect):Viewport|undefined {
  const overview=fitDiagramCamera(systemBounds,size),focused=fitDiagramCamera(focusBounds,size);
  if(!overview||!focused||size.width<=48||size.height<=48)return;
  const context=contextBounds&&valid(contextBounds)?union([focusBounds,contextBounds]):undefined;
  const contextual=context?fitDiagramCamera(context,size):undefined;
  const zoom=Math.min(overview.zoom*1.18,focused.zoom,contextual?.zoom??1,1);
  const visible=context??focusBounds;
  if(visible.width*zoom>size.width-48+1e-7||visible.height*zoom>size.height-48+1e-7)return;
  let x=size.width/2-(focusBounds.x+focusBounds.width/2)*zoom;
  let y=size.height/2-(focusBounds.y+focusBounds.height/2)*zoom;
  // Keep connected objects and their complete enclosures in view, reducing the small zoom increase if necessary.
  // The active area remains as close to centre as that context allows.
  if(context){
    const clamp=(value:number,start:number,length:number,viewport:number)=>{
      const low=24-start*zoom,high=viewport-24-(start+length)*zoom;
      return low<=high+1e-7?Math.min(high,Math.max(low,value)):value;
    };
    x=clamp(x,context.x,context.width,size.width);
    y=clamp(y,context.y,context.height,size.height);
  }
  return{x,y,zoom};
}
