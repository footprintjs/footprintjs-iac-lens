import {Position,type NodeHandle} from '@xyflow/react';
import type {TraceGraph} from 'footprint-explainable-ui/flowchart';
import type {SystemTopologyView,TopologyBoundaryView,TopologyNodeView} from 'footprintjs-iac/system-topology';
import type {DiagramSymbolDefinition} from '../../../src/core/system-symbols.ts';
import {createSystemGraphPlacement,type SystemGraphData,type SystemGraphNode,type SystemGraphPlacement} from './create-system-graph.ts';
import {componentArtworkSize,type TopologyBox,type TopologyGeometryProfile} from './topology-layout.ts';
import type {TopologyPoint,TopologyRoute} from './topology-routing.ts';
import {placeIsometricLabel} from './place-isometric-label.ts';
import {routeIsometricObjectConnections,type IsometricArtworkPort} from './isometric-object-routing.ts';
import {createIsometricLabelClearance} from './isometric-label-clearance.ts';

const SCALE=1.35,COS_30=Math.sqrt(3)/2;
interface Rectangle {x:number;y:number;width:number;height:number}
interface PhysicalObject {box:TopologyBox;floor:TopologyPoint[];card?:TopologyBox;anchor?:TopologyPoint;header?:{x:number;y:number;width:number;height:number}}
const corners=(box:Rectangle)=>[{x:box.x,y:box.y},{x:box.x+box.width,y:box.y},{x:box.x+box.width,y:box.y+box.height},{x:box.x,y:box.y+box.height}];
const center=(box:Rectangle)=>({x:box.x+box.width/2,y:box.y+box.height/2});
const bounds=(points:readonly TopologyPoint[])=>{
  const x=Math.min(...points.map(point=>point.x)),y=Math.min(...points.map(point=>point.y));
  return{x,y,width:Math.max(...points.map(point=>point.x))-x,height:Math.max(...points.map(point=>point.y))-y};
};
/** A single physical projection transforms floor plates and every route point together. */
export function projectSystemFloor(point:TopologyPoint):TopologyPoint {
  return{x:COS_30*(point.x-point.y)*SCALE,y:.5*(point.x+point.y)*SCALE};
}
export const isometricSystemPath=(points:readonly TopologyPoint[])=>points.map((point,index)=>`${index?'L':'M'} ${point.x} ${point.y}`).join(' ');

/** Match DiagramSymbol's xMidYMid meet transform in the upright artwork viewport. */
function artworkPorts(ground:TopologyPoint,height:number,symbol?:DiagramSymbolDefinition):IsometricArtworkPort[]|undefined {
  if(symbol?.presentation!=='object'||!symbol.ports)return;
  const {width:sourceWidth,height:sourceHeight}=symbol.viewBox;
  const scale=Math.min(componentArtworkSize.width/sourceWidth,height/sourceHeight);
  return symbol.ports.map(port=>({
    side:port.side,
    point:{
      x:ground.x+(port.x-sourceWidth/2)*scale,
      y:ground.y-height/2+(port.y-sourceHeight/2)*scale,
    },
  }));
}

/** A single upright drawing needs a small base. The full layout still reserves its caption and wire space. */
function compactFloor(component:TopologyBox):Rectangle {
  const anchor=center(component);
  const size=Math.min(component.width,component.height)-24;
  return {x:anchor.x-size/2+12,y:anchor.y-size/2+12,width:size,height:size};
}

/** Upright drawings or cards sit on physical footprints. Text and status evidence are never tilted. */
export function createIsometricSystemPlacement(view:SystemTopologyView,profile?:TopologyGeometryProfile,symbols?:ReadonlyMap<string,DiagramSymbolDefinition>):SystemGraphPlacement&{objects:ReadonlyMap<string,PhysicalObject>} {
  const authored=createSystemGraphPlacement(view,profile),objects=new Map<string,PhysicalObject>();
  for(const source of authored.boxes.values()){
    if(source.kind==='boundary'){
      const nodes=view.nodes.filter(node=>node.boundaryId===source.id);
      const singleton=nodes.length===1&&!view.boundaries.some(boundary=>boundary.parentId===source.id)
        ?authored.boxes.get(nodes[0]!.id):undefined;
      const anchorHeight=profile?.nodeAnchorHeight;
      const compact=singleton&&typeof anchorHeight==='number'&&anchorHeight>=32&&anchorHeight<=singleton.height
        &&(!symbols||symbols.get(`component:${singleton.id}`)?.presentation==='object');
      const floor=corners(compact?compactFloor(singleton):source).map(projectSystemFloor);
      const width=profile?.boundaryHeaderWidth,height=profile?.boundaryHeaderHeight;
      const headerHeight=typeof height==='number'&&Number.isFinite(height)&&height>=32&&height<=512?height:36;
      const headerBase=compact?Math.min(floor[0]!.y,projectSystemFloor(center(singleton)).y-anchorHeight-8):floor[0]!.y;
      const header={x:floor[0]!.x+8,y:headerBase-(height===undefined?31:headerHeight),width:typeof width==='number'&&Number.isFinite(width)&&width>=32&&width<=512?width:260,height:headerHeight};
      const box={...source,...bounds([...floor.map(point=>({...point,y:point.y+9})),...floor,...corners(header)])};
      objects.set(source.id,{box,floor,header});
    }else{
      const floor=corners(source).map(projectSystemFloor);
      const ground=projectSystemFloor(center(source));
      const height=profile?.nodeAnchorHeight,anchor=typeof height==='number'&&Number.isFinite(height)&&height>=32&&height<=source.height?height:undefined;
      const card={...source,x:ground.x-source.width/2,y:ground.y-(anchor??source.height+10)};
      const box={...source,...bounds([...floor,...floor.map(point=>({...point,y:point.y+7})),...corners(card)])};
      objects.set(source.id,{box,floor,card,...anchor===undefined?{}:{anchor:ground}});
    }
  }
  const parent=(id:string)=>view.boundaries.find(row=>row.id===id)?.parentId??view.nodes.find(row=>row.id===id)?.boundaryId;
  // Containment is still physical: parent AABBs include the elevated cards and nested plates.
  for(const source of [...authored.boxes.values()].filter(box=>box.kind==='boundary').sort((a,b)=>b.depth-a.depth)){
    const object=objects.get(source.id)!,children=[...objects.values()].filter(child=>parent(child.box.id)===source.id);
    const union=bounds([object,...children].flatMap(child=>corners(child.box)));
    object.box={...object.box,x:union.x-8,y:union.y-8,width:union.width+16,height:union.height+16};
  }
  const boxes=new Map([...objects].map(([id,object])=>[id,object.box]));
  const routes=new Map<string,TopologyRoute>();
  const objectMode=[...objects.values()].some(object=>object.anchor!==undefined);
  const objectRoutes=objectMode?routeIsometricObjectConnections(
    view.connections,
    [...objects.values()].flatMap(({box,card,anchor})=>card&&anchor?[{
      id:box.id,body:card,ground:anchor,
      ports:artworkPorts(anchor,anchor.y-card.y,symbols?.get(`component:${box.id}`)),
    }]:[]),
    [...objects.values()].flatMap(object=>object.header?[object.header]:[]),
  ):undefined;
  const obstacles=[...objects.values()].flatMap(object=>object.card?[object.card]:object.header?[object.header]:[]);
  const symbolLayout=(profile?.nodeWidth??184)>184||(profile?.nodeHeight??104)>104||(profile?.boundaryHeaderWidth??260)>260;
  const labelled=new Set(view.connections.filter(edge=>edge.kind==='communicatesWith').map(edge=>edge.id));
  for(const [id,route]of objectRoutes??authored.routes){
    const points=objectMode?route.points:route.points.map(projectSystemFloor),label=objectMode?route:projectSystemFloor(route);
    // Symbol cards have a larger upright footprint. A hidden flat badge can
    // still fit beside its projected wire, with a leader to its actual anchor.
    const projected={...route,...label,points,path:route.path?isometricSystemPath(points):'',
      ...objectMode&&!labelled.has(id)?{labelHidden:true}:{},
      ...symbolLayout&&labelled.has(id)?{labelHidden:false}:{}};
    const placed=[...routes.values()];
    const clearance=objectRoutes?createIsometricLabelClearance(id,objectRoutes,obstacles,placed):undefined;
    routes.set(id,placeIsometricLabel(projected,obstacles,placed,symbolLayout,clearance));
  }
  const extent=bounds([...boxes.values()].flatMap(corners));
  return{boxes,routes,objects,geometry:{width:extent.width,height:extent.height,boxes:[...boxes.values()]}};
}

function handle(point:TopologyPoint,box:TopologyBox,id:string,type:'source'|'target'):NodeHandle {
  return{id,type,position:type==='source'?Position.Bottom:Position.Top,x:point.x-box.x-3,y:point.y-box.y-3,width:6,height:6};
}

/** This is a physical read model; communication never becomes a workflow transition. */
export function createIsometricSystemGraph(view:SystemTopologyView,placement=createIsometricSystemPlacement(view)):TraceGraph {
  const handles=new Map<string,NodeHandle[]>();
  for(const edge of view.connections){
    const route=placement.routes.get(edge.id),source=placement.boxes.get(edge.from),target=placement.boxes.get(edge.to);
    if(!route?.path||!route.points.length||!source||!target)continue;
    handles.set(source.id,[...handles.get(source.id)??[],handle(route.points[0]!,source,`out:${edge.id}`,'source')]);
    handles.set(target.id,[...handles.get(target.id)??[],handle(route.points.at(-1)!,target,`in:${edge.id}`,'target')]);
  }
  const node=(item:TopologyBoundaryView|TopologyNodeView,boundary:boolean):SystemGraphNode=>{
    const object=placement.objects.get(item.id)!,box=object.box,parentId=boundary?(item as TopologyBoundaryView).parentId:(item as TopologyNodeView).boundaryId;
    const parent=parentId?placement.boxes.get(parentId):undefined,ports=handles.get(item.id)??[];
    const relative=(point:TopologyPoint)=>({x:point.x-box.x,y:point.y-box.y});
    const card=object.card?{...object.card,...relative(object.card)}:{...box,x:0,y:0};
    const data:SystemGraphData={label:item.label,isDecider:false,isFork:false,isSubflow:false,isStreaming:false,prevIds:[],nextIds:[],box:card,ports,
      isometric:{floor:object.floor.map(relative),...object.header?{header:{...object.header,...relative(object.header)}}:{}},
      ...boundary?{boundary:item as TopologyBoundaryView}:{component:item as TopologyNodeView}};
    return{id:item.id,type:boundary?'system-boundary':'system-component',position:{x:box.x-(parent?.x??0),y:box.y-(parent?.y??0)},
      ...parentId?{parentId,extent:'parent' as const}:{},width:box.width,height:box.height,initialWidth:box.width,initialHeight:box.height,
      style:{width:box.width,height:box.height},handles:ports,zIndex:boundary?box.depth:20,draggable:false,connectable:false,data,
      ariaLabel:boundary?`${item.label}, physical boundary`:`${item.label}, ${(item as TopologyNodeView).originLabel}, ${(item as TopologyNodeView).statusLabel}`};
  };
  return{nodes:[...view.boundaries].sort((a,b)=>placement.boxes.get(a.id)!.depth-placement.boxes.get(b.id)!.depth).map(item=>node(item,true)).concat(view.nodes.map(item=>node(item,false))),
    edges:view.connections.filter(edge=>placement.routes.get(edge.id)?.path&&placement.boxes.has(edge.from)&&placement.boxes.has(edge.to)).map(edge=>({
      // ReactFlow adds the parented endpoint's layer (20); keep floor wires below upright cards.
      id:edge.id,source:edge.from,target:edge.to,sourceHandle:`out:${edge.id}`,targetHandle:`in:${edge.id}`,type:'system-connection',zIndex:-10,
      markerEnd:'',selectable:false,focusable:false,ariaLabel:`${edge.label??edge.kind}: ${edge.status}`,
    }))};
}
