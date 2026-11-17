import assert from 'node:assert/strict';
import test from 'node:test';
import {defineSystemTopology,projectSystemTopology} from 'footprintjs-iac/system-topology/node';
import {createSystemGraph,createSystemGraphPlacement,systemGraphBounds,type SystemGraphNode} from '../web/features/system-topology/create-system-graph.ts';
import {fitDiagramCamera} from '../web/lib/diagram-camera.ts';
import {labelRect,overlaps} from '../web/features/system-topology/topology-route-geometry.ts';
import {createIsometricSystemGraph,createIsometricSystemPlacement,projectSystemFloor} from '../web/features/system-topology/create-isometric-system-graph.ts';

function topology(){
 const binding={targetId:'office',graphDigest:'b'.repeat(64)};
 const definition=defineSystemTopology({id:'placement',label:'Office services',boundaries:[{id:'host',kind:'server',label:'Office server'},{id:'runtime',kind:'runtime',label:'systemd',parentId:'host'}],nodes:[
  {id:'api',label:'Backend',category:'compute',origin:'existing',boundaryId:'runtime',bindings:{resourceIds:['services']}},
  {id:'data',label:'Database',category:'storage',origin:'existing',boundaryId:'host',bindings:{resourceIds:[]}},
 ],connections:[{id:'database-link',from:'api',to:'data',kind:'communicatesWith',label:'SQL connection',checkIds:['sql-check']}]},binding);
 return projectSystemTopology(definition,{...binding,definitionDigest:definition.digest,configurationDigest:'c'.repeat(64),resources:[],components:[],checks:[]});
}

test('system adapter uses the shared renderer contract while keeping physical placement and communication semantics',()=>{
 const view=topology(),before=structuredClone(view),placement=createSystemGraphPlacement(view),graph=createSystemGraph(view,placement);
 const nodes=new Map((graph.nodes as SystemGraphNode[]).map(node=>[node.id,node]));
 assert.equal(nodes.get('runtime')!.parentId,'host');assert.equal(nodes.get('api')!.parentId,'runtime');assert.equal(nodes.get('data')!.parentId,'host');
 assert.equal(nodes.get('api')!.type,'system-component');assert.equal(nodes.get('runtime')!.type,'system-boundary');
 assert.equal(nodes.get('api')!.data.component!.origin,'existing');assert.equal(nodes.get('api')!.data.component!.status,view.nodes.find(node=>node.id==='api')!.status);
 for(const node of graph.nodes){assert.deepEqual(node.data.prevIds,[]);assert.deepEqual(node.data.nextIds,[]);assert.equal(node.data.active,undefined);assert.equal(node.data.done,undefined);assert.equal(node.draggable,false);}
 assert.equal(graph.edges.length,1);assert.equal(graph.edges[0]!.id,'database-link');assert.equal(graph.edges[0]!.type,'system-connection');
 assert.equal(graph.edges[0]!.source,'api');assert.equal(graph.edges[0]!.target,'data');assert.equal(graph.edges[0]!.data,undefined,'communication is never declared a workflow next/read/causal edge');
 const api=nodes.get('api')!,runtime=placement.boxes.get('runtime')!,absolute=placement.boxes.get('api')!;
 assert.equal(api.position.x+runtime.x,absolute.x);assert.equal(api.position.y+runtime.y,absolute.y);
 assert.equal(api.data.box.width,184);assert.equal(api.data.box.height,104);assert(api.handles?.some(handle=>handle.id==='out:database-link'));
 assert.deepEqual(view,before,'renderer adaptation never writes back to admitted native facts');
});

test('system graph progress updates retain placement, route identity, origins and exact admitted evidence',()=>{
 const view=topology(),placement=createSystemGraphPlacement(view),initial=createSystemGraph(view,placement);
 const evidence={kind:'check' as const,runId:'measured-check-run',runtimeStageId:'check-sql#2',complete:true};
 const changed={...view,nodes:view.nodes.map(node=>({...node,status:'connected' as const,statusLabel:'Connected',evidence:[evidence],progress:{completed:1,total:1,indeterminate:false}})),connections:view.connections.map(edge=>({...edge,status:'connected' as const,evidence:[evidence]}))};
 const graph=createSystemGraph(changed,placement);
 assert.deepEqual(graph.nodes.map(node=>[node.id,node.position,node.parentId,node.width,node.height]),initial.nodes.map(node=>[node.id,node.position,node.parentId,node.width,node.height]));
 const geometry=(edges:typeof graph.edges)=>edges.map(({ariaLabel,...edge})=>edge);
 assert.deepEqual(geometry(graph.edges),geometry(initial.edges),'a measured connection updates its accessible status without changing physical edge identity or geometry');
 assert.equal(graph.edges[0]!.ariaLabel,'SQL connection: connected');assert.equal(graph.edges[0]!.data,undefined,'connection observations never become execution overlays');
 const api=(graph.nodes as SystemGraphNode[]).find(node=>node.id==='api')!;
 assert.equal(api.data.component!.origin,'existing');assert.deepEqual(api.data.component!.evidence,[evidence]);assert.equal(api.data.component!.progress.completed,1);
});

test('physical camera includes outside connection lanes and status badges at laptop and narrow sizes',()=>{
 const placement=createSystemGraphPlacement(topology());
 // Authored routes can extend outside the host boxes; fitting cards alone clips them.
 placement.routes=new Map([...placement.routes].map(([id,route])=>[id,{...route,path:'M 0 0 L 900 700',labelHidden:false,y:700,points:[...route.points,{x:900,y:700}]}]));
 const bounds=systemGraphBounds(placement);
 const corners=(box:{x:number;y:number;width:number;height:number})=>[{x:box.x,y:box.y},{x:box.x+box.width,y:box.y+box.height}];
 const points=[...placement.boxes.values()].flatMap(corners).concat([...placement.routes.values()].flatMap(route=>[...route.points,...corners(labelRect(route))]));
 for(const size of [{width:1280,height:400},{width:331,height:500}]){
  const camera=fitDiagramCamera(bounds,size)!;
  for(const point of points){
   const x=point.x*camera.zoom+camera.x,y=point.y*camera.zoom+camera.y;
   // XYFlow rounds a fitted pixel inset, so allow one pixel of rounding.
   assert(x>=23&&x<=size.width-23,JSON.stringify({point,x,bounds,camera,size}));assert(y>=23&&y<=size.height-23,JSON.stringify({point,y,bounds,camera,size}));
  }
 }
});

test('isometric system projection keeps containment, origins, native evidence and every physical wire endpoint aligned',()=>{
 const view=topology(),before=structuredClone(view),flat=createSystemGraphPlacement(view),placement=createIsometricSystemPlacement(view),graph=createIsometricSystemGraph(view,placement);
 const nodes=new Map((graph.nodes as SystemGraphNode[]).map(node=>[node.id,node]));
 for(const item of [...view.boundaries,...view.nodes]){
  const node=nodes.get(item.id)!,box=placement.boxes.get(item.id)!;
  assert.equal(node.data.label,item.label);assert.deepEqual(node.data.prevIds,[]);assert.deepEqual(node.data.nextIds,[]);
  assert.equal(node.data.active,undefined);assert.equal(node.data.done,undefined);assert(node.data.isometric);
  assert.deepEqual(node.data.isometric.floor[0],{x:projectSystemFloor(flat.boxes.get(item.id)!).x-box.x,y:projectSystemFloor(flat.boxes.get(item.id)!).y-box.y});
  if(node.parentId){const parent=placement.boxes.get(node.parentId)!;assert.equal(node.position.x+parent.x,box.x);assert.equal(node.position.y+parent.y,box.y);assert(node.position.x>=0);assert(node.position.y>=0);assert(node.position.x+box.width<=parent.width+.001);assert(node.position.y+box.height<=parent.height+.001);}
  if(node.data.component){assert.equal(node.data.component.origin,'existing');assert.equal(node.data.component.status,view.nodes.find(row=>row.id===node.id)!.status);assert.deepEqual(node.data.component.evidence,view.nodes.find(row=>row.id===node.id)!.evidence);}
 }
 assert.equal(nodes.get('api')!.parentId,'runtime');assert.equal(nodes.get('runtime')!.parentId,'host');
 for(const edge of graph.edges){
  assert.equal(edge.data,undefined,'a communication edge has no workflow kind or causal ancestry');
  const endpointLayer=Math.max(nodes.get(edge.source)!.zIndex??0,nodes.get(edge.target)!.zIndex??0);
  const wireLayer=endpointLayer+(edge.zIndex??0);
  assert(wireLayer<endpointLayer,'parented connection wires remain below upright component text');
  assert(wireLayer>Math.max(...graph.nodes.filter(node=>node.data.boundary).map(node=>node.zIndex??0)),'floor wires remain visible above host/runtime plates');
  const route=placement.routes.get(edge.id)!,original=flat.routes.get(edge.id)!;
  assert.deepEqual(route.points,original.points.map(projectSystemFloor));
  for(const [id,type,endpoint]of [[edge.source,'source',route.points[0]!],[edge.target,'target',route.points.at(-1)!]] as const){
   const box=placement.boxes.get(id)!,port=nodes.get(id)!.handles!.find(port=>port.type===type)!;
   assert(Math.abs(port.x+3+box.x-endpoint.x)<1e-8);assert(Math.abs(port.y+3+box.y-endpoint.y)<1e-8);
  }
 }
 assert.deepEqual(view,before);
});

test('isometric progress and connection updates do not move objects or turn measured failures into deployment failures',()=>{
 const view=topology(),placement=createIsometricSystemPlacement(view),initial=createIsometricSystemGraph(view,placement);
 const evidence={kind:'check' as const,runId:'actual-sql-check',runtimeStageId:'verify-sql#4',complete:true};
 const updated={...view,nodes:view.nodes.map(node=>({...node,status:'ready' as const,statusLabel:'Ready',evidence:[evidence]})),connections:view.connections.map(edge=>({...edge,status:'failed' as const,evidence:[evidence]}))};
 const graph=createIsometricSystemGraph(updated,placement);
 assert.deepEqual(graph.nodes.map(node=>[node.id,node.position,node.parentId,node.width,node.height,node.handles]),initial.nodes.map(node=>[node.id,node.position,node.parentId,node.width,node.height,node.handles]));
 assert.equal(graph.edges[0]?.ariaLabel,'SQL connection: failed');assert.equal(graph.edges[0]?.data,undefined);
 assert((graph.nodes as SystemGraphNode[]).filter(node=>node.data.component).every(node=>node.data.component!.status==='ready'));
 const extent=systemGraphBounds(placement),camera=fitDiagramCamera(extent,{width:960,height:640})!;
 for(const box of placement.boxes.values())for(const point of [{x:box.x,y:box.y},{x:box.x+box.width,y:box.y+box.height}]){
  assert(point.x*camera.zoom+camera.x>=23);assert(point.y*camera.zoom+camera.y>=23);
  assert(point.x*camera.zoom+camera.x<=937);assert(point.y*camera.zoom+camera.y<=617);
 }
});

test('Neo-shaped isometric placement separates all seven upright cards and keeps measured communication badges clear',()=>{
 const binding={targetId:'neo',graphDigest:'b'.repeat(64)};
 const definition=defineSystemTopology({id:'neo',label:'Neo placement',boundaries:[{id:'host',label:'Linux host',kind:'server'},{id:'runtime',label:'systemd',kind:'runtime',parentId:'host'},{id:'directory',label:'Directory container',kind:'container'}],nodes:[
  ...['backend','tools','sessions'].map(id=>({id,label:id,category:'compute' as const,origin:'existing' as const,boundaryId:'runtime',bindings:{resourceIds:[]}})),
  ...['collectors','fleet','http'].map(id=>({id,label:id,category:'storage' as const,origin:'existing' as const,boundaryId:'host',bindings:{resourceIds:[]}})),
  {id:'identity',label:'Directory',category:'identity',origin:'existing',boundaryId:'directory',bindings:{resourceIds:[]}},
 ],connections:[
  ...[['http','backend'],['http','tools'],['tools','collectors'],['backend','identity'],['backend','fleet']].map(([from,to])=>({id:`${from}-${to}`,from:from!,to:to!,kind:'communicatesWith' as const})),
  {id:'backend-sessions',from:'backend',to:'sessions',kind:'dependsOn'},
 ]},binding);
 const view=projectSystemTopology(definition,{...binding,definitionDigest:definition.digest,configurationDigest:'c'.repeat(64),resources:[],components:[],checks:[]});
 const placement=createIsometricSystemPlacement(view),cards=[...placement.objects.values()].flatMap(object=>object.card?[object.card]:[]);
 const headings=[...placement.objects.values()].flatMap(object=>object.header?[{...object.header,height:36}]:[]);
 for(const [index,card]of cards.entries()){
  assert(cards.slice(index+1).every(other=>!overlaps(card,other,0)),`${card.id} stays clear of other upright cards`);
  assert(headings.every(heading=>!overlaps(card,heading,0)),`${card.id} stays clear of host/runtime labels`);
 }
 assert.equal(placement.routes.size,6);
 for(const edge of view.connections){
  const route=placement.routes.get(edge.id)!;assert(route.path,`${edge.id} keeps its physical path`);
  if(edge.kind==='dependsOn')continue;
  assert(!route.labelHidden,`${edge.id} retains its live connection badge`);
  assert([...cards,...headings].every(object=>!overlaps(labelRect(route),object,0)),`${edge.id} badge never covers readable text`);
 }
});
