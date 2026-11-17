import {Position,type NodeHandle} from '@xyflow/react';
import type {TraceGraph,TraceNode,TraceNodeData} from 'footprint-explainable-ui/flowchart';
import type {SystemTopologyView,TopologyBoundaryView,TopologyNodeView} from 'footprintjs-iac/system-topology';
import {layoutSystemTopology,type TopologyBox} from './topology-layout.ts';
import {routeTopologyConnections} from './topology-routes.ts';
import {labelRect} from './topology-route-geometry.ts';
import type {TopologyPoint,TopologyRoute} from './topology-routing.ts';

export interface SystemGraphData extends TraceNodeData {
  component?:TopologyNodeView;
  boundary?:TopologyBoundaryView;
  box:TopologyBox;
  ports:readonly NodeHandle[];
  isometric?:{
    floor:readonly TopologyPoint[];
    header?:{x:number;y:number;width:number};
  };
}
export type SystemGraphNode=TraceNode&{data:SystemGraphData};
export interface SystemGraphPlacement {
  geometry:ReturnType<typeof layoutSystemTopology>;
  boxes:ReadonlyMap<string,TopologyBox>;
  routes:ReadonlyMap<string,TopologyRoute>;
}

/** Physical placement is authored topology, never workflow order or trace ancestry. */
export function createSystemGraphPlacement(view:SystemTopologyView):SystemGraphPlacement {
  const geometry=layoutSystemTopology(view),boxes=new Map(geometry.boxes.map(box=>[box.id,box]));
  return{geometry,boxes,routes:routeTopologyConnections(view.definition.connections,boxes)};
}

/** Include outer wires and their badges when fitting the physical system. */
export function systemGraphBounds(placement:SystemGraphPlacement) {
  const corners=(box:{x:number;y:number;width:number;height:number})=>[{x:box.x,y:box.y},{x:box.x+box.width,y:box.y+box.height}];
  const points=[...placement.boxes.values()].flatMap(corners).concat([...placement.routes.values()].flatMap(route=>[
    ...route.points,...route.path&&!route.labelHidden?corners(labelRect(route)):[],
  ]));
  if(!points.length)return{x:0,y:0,width:1,height:1};
  const x=Math.min(...points.map(point=>point.x)),y=Math.min(...points.map(point=>point.y));
  return{x,y,width:Math.max(...points.map(point=>point.x))-x,height:Math.max(...points.map(point=>point.y))-y};
}

function port(box:TopologyBox,point:TopologyPoint,id:string,type:'source'|'target'):NodeHandle {
  const position=point.x===box.x?Position.Left:point.x===box.x+box.width?Position.Right:point.y===box.y?Position.Top:Position.Bottom;
  return{id,type,position,x:point.x-box.x-3,y:point.y-box.y-3,width:6,height:6};
}

/** Translate admitted physical facts to the released EUI canvas contract, without a runtime overlay. */
export function createSystemGraph(view:SystemTopologyView,placement=createSystemGraphPlacement(view)):TraceGraph {
  const {boxes,routes}=placement,handles=new Map<string,NodeHandle[]>();
  for(const connection of view.connections){
    const route=routes.get(connection.id),from=boxes.get(connection.from),to=boxes.get(connection.to);
    if(!route?.path||!route.points.length||!from||!to)continue;
    handles.set(from.id,[...handles.get(from.id)??[],port(from,route.points[0]!,`out:${connection.id}`,'source')]);
    handles.set(to.id,[...handles.get(to.id)??[],port(to,route.points.at(-1)!,`in:${connection.id}`,'target')]);
  }
  const node=(item:TopologyNodeView|TopologyBoundaryView,boundary:boolean):SystemGraphNode=>{
    const box=boxes.get(item.id)!,parentId=boundary?(item as TopologyBoundaryView).parentId:(item as TopologyNodeView).boundaryId,parent=parentId?boxes.get(parentId):undefined;
    const ports=handles.get(item.id)??[];
    return{id:item.id,type:boundary?'system-boundary':'system-component',position:{x:box.x-(parent?.x??0),y:box.y-(parent?.y??0)},
      ...parentId?{parentId,extent:'parent' as const}:{},width:box.width,height:box.height,initialWidth:box.width,initialHeight:box.height,
      style:{width:box.width,height:box.height},handles:ports,zIndex:boundary?box.depth:20,draggable:false,connectable:false,
      data:{label:item.label,isDecider:false,isFork:false,isSubflow:false,isStreaming:false,prevIds:[],nextIds:[],
        box:{...box,x:0,y:0},ports,...boundary?{boundary:item as TopologyBoundaryView}:{component:item as TopologyNodeView}},
      ariaLabel:boundary?`${item.label}, physical boundary`:`${item.label}, ${(item as TopologyNodeView).originLabel}, ${(item as TopologyNodeView).statusLabel}`};
  };
  return{
    nodes:[...view.boundaries].sort((a,b)=>boxes.get(a.id)!.depth-boxes.get(b.id)!.depth).map(item=>node(item,true)).concat(view.nodes.map(item=>node(item,false))),
    edges:view.connections.filter(edge=>routes.get(edge.id)?.path&&boxes.has(edge.from)&&boxes.has(edge.to)).map(edge=>({
      id:edge.id,source:edge.from,target:edge.to,sourceHandle:`out:${edge.id}`,targetHandle:`in:${edge.id}`,type:'system-connection',zIndex:10,
      markerEnd:'',selectable:false,focusable:false,ariaLabel:`${edge.label??edge.kind}: ${edge.status}`,
      // No workflow data.kind: a communication/dependency line is not a recorded "next" transition.
    })),
  };
}
