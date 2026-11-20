import assert from 'node:assert/strict';
import test from 'node:test';
import {defineSystemTopology,projectSystemTopology} from 'footprintjs-iac/system-topology/node';
import type {DiagramSymbolDefinition} from '../src/core/system-symbols.ts';
import {createIsometricSystemPlacement} from '../web/features/system-topology/create-isometric-system-graph.ts';
import {labelRect} from '../web/features/system-topology/topology-route-geometry.ts';
import {routeIsometricObjectConnections} from '../web/features/system-topology/isometric-object-routing.ts';
import {componentArtworkSize,objectGeometryProfile,symbolGeometryProfile} from '../web/features/system-topology/topology-layout.ts';

function topology(){
 const binding={targetId:'office',graphDigest:'b'.repeat(64)};
 const definition=defineSystemTopology({id:'placement',label:'Office services',boundaries:[{id:'host',kind:'server',label:'Registered host'},{id:'runtime',kind:'runtime',label:'Registered runtime',parentId:'host'},{id:'remote',kind:'container',label:'Separate existing system'}],nodes:[
  {id:'api',label:'Recorded application',category:'compute',origin:'existing',boundaryId:'runtime',bindings:{resourceIds:['services'],componentIds:['app']}},
  {id:'tools',label:'Companion process',category:'compute',origin:'existing',boundaryId:'runtime',bindings:{resourceIds:[]}},
  {id:'sessions',label:'Process sessions',category:'storage',origin:'embedded',boundaryId:'runtime',bindings:{resourceIds:[]}},
  {id:'data',label:'Existing database',category:'storage',origin:'existing',boundaryId:'host',bindings:{resourceIds:[]}},
  {id:'files',label:'Configuration files',category:'storage',origin:'existing',boundaryId:'host',bindings:{resourceIds:[]}},
  {id:'http',label:'Application endpoint',category:'network',origin:'existing',boundaryId:'host',bindings:{resourceIds:[]}},
  {id:'identity',label:'Existing identity',category:'identity',origin:'existing',boundaryId:'remote',bindings:{resourceIds:[]}},
 ],connections:[
  ...[['api','data'],['tools','data'],['api','files'],['http','api'],['api','identity']].map(([from,to])=>({id:`${from}-${to}`,from:from!,to:to!,kind:'communicatesWith' as const})),
  {id:'api-sessions',from:'api',to:'sessions',kind:'dependsOn'},
 ]},binding);
 const view=projectSystemTopology(definition,{...binding,definitionDigest:definition.digest,configurationDigest:'c'.repeat(64),resources:[],components:[],checks:[]});
 return{...view,nodes:view.nodes.map(node=>node.id==='api'?{...node,status:'checking' as const,statusLabel:'Checking',progress:{completed:1,total:3,indeterminate:true},actions:[{resourceId:'services',componentId:'app',phase:'observe' as const,status:'running' as const,scope:'component' as const,label:'Checking component',evidence:{kind:'adapter' as const,runId:'actual-native-run',runtimeStageId:'provider/observe#3',complete:false}}]}:node)};
}

const axis=(a:{x:number;y:number},b:{x:number;y:number})=>Math.abs(Math.abs(b.y-a.y)*Math.sqrt(3)-Math.abs(b.x-a.x))<.001;

test('wires attach to distinct outline ports on both ends of letterboxed SVG drawings',()=>{
 const view=topology();
 const symbol:DiagramSymbolDefinition={
  id:'wide-device',presentation:'object',viewBox:{width:160,height:96},
  paths:[{d:'M 20 16 L 140 16 L 140 80 L 20 80 Z'}],
  ports:[20,32,44,56,68].flatMap(y=>[{x:20,y,side:'left' as const},{x:140,y,side:'right' as const}]),
 };
 const symbols=new Map(view.nodes.map(node=>[`component:${node.id}`,symbol]));
 const placement=createIsometricSystemPlacement(view,objectGeometryProfile,symbols);
 const used=new Set<string>();
 for(const edge of view.connections){
  const route=placement.routes.get(edge.id)!;
  assert(route.path,`${edge.id} has an outline-to-outline route`);
  for(const [id,point] of [[edge.from,route.points[0]!],[edge.to,route.points.at(-1)!]] as const){
   const ground=placement.objects.get(id)!.anchor!;
   const scale=componentArtworkSize.width/160;
   const port=symbol.ports!.find(port=>Math.abs(point.x-(ground.x+(port.x-80)*scale))<1e-7
      &&Math.abs(point.y-(ground.y-componentArtworkSize.height/2+(port.y-48)*scale))<1e-7);
   assert(port,`${edge.id} lands on ${id}'s drawing`);
   const endpoint=JSON.stringify([id,port.x,port.y]);
   assert(!used.has(endpoint),`${id} uses separate ports for separate wires`);
   used.add(endpoint);
  }
  for(let i=1;i<route.points.length;i++)assert(axis(route.points[i-1]!,route.points[i]!),edge.id);
 }
});

test('all six Neo-shaped object connections follow the isometric axes through their terminal approach',()=>{
 const view=topology(),placement=createIsometricSystemPlacement(view,objectGeometryProfile);
 assert.equal(placement.routes.size,6);
 for(const edge of view.connections){
  const route=placement.routes.get(edge.id)!;
  assert(route.path&&route.points.length>=2,`${edge.id} remains visible`);
  for(let index=1;index<route.points.length;index++)assert(axis(route.points[index-1]!,route.points[index]!),`${edge.id} segment ${index} follows ±30° axes: ${JSON.stringify([route.points[index-1],route.points[index]])}`);
  const end=route.points.at(-1)!,prior=route.points.at(-2)!;
  assert(Math.hypot(end.x-prior.x,end.y-prior.y)>=14,`${edge.id} has a clear terminal arrow approach`);
 }
});

const intersects=(a:{x:number;y:number},b:{x:number;y:number},box:{x:number;y:number;width:number;height:number})=>{
 for(let index=0;index<=200;index++){const x=a.x+(b.x-a.x)*index/200,y=a.y+(b.y-a.y)*index/200;if(x>box.x+.01&&x<box.x+box.width-.01&&y>box.y+.01&&y<box.y+box.height-.01)return true;}
 return false;
};

test('isometric object wires avoid all captions, headers and unrelated artwork rather than only moving badges',()=>{
 const view=topology(),placement=createIsometricSystemPlacement(view,objectGeometryProfile),objects=[...placement.objects.values()];
 for(const edge of view.connections){
  const route=placement.routes.get(edge.id)!;
  for(let index=1;index<route.points.length;index++){
   const a=route.points[index-1]!,b=route.points[index]!;
   for(const object of objects){
    if(object.header)assert(!intersects(a,b,object.header),`${edge.id} clears the measured boundary artwork/caption`);
    if(!object.card||!object.anchor)continue;
    const caption={x:object.card.x,y:object.anchor.y+1,width:object.card.width,height:object.card.y+object.card.height-object.anchor.y-1};
    assert(!intersects(a,b,caption),`${edge.id} clears ${object.box.id} native captions, including its own`);
    const terminal=object.box.id===edge.from&&index===1||object.box.id===edge.to&&index===route.points.length-1;
    if(!terminal)assert(!intersects(a,b,{x:object.anchor.x-componentArtworkSize.width/2,y:object.card.y,...componentArtworkSize}),`${edge.id} clears ${object.box.id} artwork away from its own short terminal`);
   }
  }
  if(edge.kind==='communicatesWith')assert(!route.labelHidden,`${edge.id} retains its status badge`);
 }
});

test('object paths and separated approach ports remain stable across state changes and connection input order',()=>{
 const view=topology(),before=structuredClone(view),placement=createIsometricSystemPlacement(view,objectGeometryProfile);
 const changed={...view,nodes:view.nodes.map(node=>({...node,status:'failed' as const,statusLabel:'Failed'})),connections:[...view.connections].reverse().map(edge=>({...edge,status:'failed' as const}))};
 const next=createIsometricSystemPlacement(changed,objectGeometryProfile);
 for(const [id,route]of placement.routes)assert.deepEqual(next.routes.get(id),route,`${id} remains in its original physical corridor`);
 for(const node of view.nodes){const ports=view.connections.flatMap(edge=>{const route=placement.routes.get(edge.id)!;return[...edge.from===node.id?[route.points[0]!]:[],...edge.to===node.id?[route.points.at(-1)!]:[]];});for(const [index,port]of ports.entries())for(const other of ports.slice(index+1))assert(Math.hypot(port.x-other.x,port.y-other.y)>=9.9999,`${node.id} terminal arrows stay separate`);}
 assert.deepEqual(view,before);
 const legacy=createIsometricSystemPlacement(view,symbolGeometryProfile),legacyNext=createIsometricSystemPlacement(changed,symbolGeometryProfile);
 assert.equal(legacy.objects.get('api')!.anchor,undefined,'glyph/card routing remains on the existing physical floor');
 assert.equal(legacyNext.objects.get('api')!.anchor,undefined);
});

test('an impossible safe route is explicit rather than silently omitted or drawn through artwork',()=>{
 const objects=[{id:'a',body:{x:0,y:0,width:224,height:192},ground:{x:112,y:100}},{id:'b',body:{x:400,y:0,width:224,height:192},ground:{x:512,y:100}}];
 const routes=routeIsometricObjectConnections([{id:'blocked-link',from:'a',to:'b'}],objects,[{x:-1000,y:-1000,width:3000,height:3000}]);
 assert.equal(routes.size,1,'the exact connection is retained for the explicit unplaced-connection UI');
 assert.deepEqual(routes.get('blocked-link'),{path:'',x:0,y:0,points:[],labelHidden:true});
});


test('native connection badges avoid every foreign isometric wire after all six paths are known',()=>{
 const view=topology(),placement=createIsometricSystemPlacement(view,objectGeometryProfile);
 for(const edge of view.connections.filter(edge=>edge.kind==='communicatesWith')){
  const route=placement.routes.get(edge.id)!;assert(!route.labelHidden,`${edge.id} retains its native status badge`);
  for(const [otherId,other]of placement.routes){if(otherId===edge.id)continue;for(let index=1;index<other.points.length;index++)assert(!intersects(other.points[index-1]!,other.points[index]!,labelRect(route)),`${otherId} does not cross ${edge.id}'s status badge`);}
 }
});

test('high-degree object ports remain bounded and excess relationships remain explicit',()=>{
 const objects=[{id:'a',body:{x:0,y:0,width:224,height:192},ground:{x:112,y:100}},{id:'b',body:{x:500,y:300,width:224,height:192},ground:{x:612,y:400}}];
 const connections=Array.from({length:17},(_,index)=>({id:`link-${String(index).padStart(2,'0')}`,from:'a',to:'b'})),routes=routeIsometricObjectConnections(connections,objects,[]);
 assert.equal(routes.size,17);assert([...routes.values()].some(route=>route.path));assert.equal(routes.get('link-16')!.path,'','exhausted physical ports produce an explicit unplaced relationship');
 for(const route of routes.values())if(route.path)for(const [point,object]of [[route.points[0]!,objects[0]!],[route.points.at(-1)!,objects[1]!]]as const){assert(Math.abs(point.x-object.ground.x)<=58);assert(point.y>=object.ground.y-100&&point.y<=object.ground.y);}
});


test('invalid object anchor dimensions retain the existing card route fallback',()=>{
 const view=topology(),fallback=createIsometricSystemPlacement(view,{...objectGeometryProfile,nodeAnchorHeight:undefined});
 for(const nodeAnchorHeight of [NaN,0,999]){
  const placement=createIsometricSystemPlacement(view,{...objectGeometryProfile,nodeAnchorHeight});
  assert.deepEqual(placement.routes,fallback.routes);assert([...placement.objects.values()].every(object=>!object.anchor));
 }
});

test('status badge leaders avoid every component caption and boundary header',()=>{
 const view=topology(),placement=createIsometricSystemPlacement(view,objectGeometryProfile);
 const obstacles=[...placement.objects.values()].flatMap(object=>object.card?[object.card]:object.header?[object.header]:[]);
 for(const [id,route]of placement.routes){
  if(!route.labelAnchor||route.labelHidden)continue;
  for(const obstacle of obstacles)assert(!intersects(route.labelAnchor,route,obstacle),`${id}'s status leader stays outside recorded captions and drawings`);
 }
});
