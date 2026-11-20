import assert from 'node:assert/strict';
import test from 'node:test';
import {defineSystemTopology,projectSystemTopology} from 'footprintjs-iac/system-topology/node';
import {fitDiagramCamera} from '../web/lib/diagram-camera.ts';
import {createSystemGraphPlacement,systemGraphBounds} from '../web/features/system-topology/create-system-graph.ts';
import {createIsometricSystemPlacement} from '../web/features/system-topology/create-isometric-system-graph.ts';
import {objectGeometryProfile} from '../web/features/system-topology/topology-layout.ts';
import {fitSystemCameraFocus,selectSystemCameraFocus} from '../web/features/system-topology/system-camera-focus.ts';

function topology(nestedRemote=false){
  const binding={targetId:'office',graphDigest:'b'.repeat(64)};
  const definition=defineSystemTopology({id:'camera',label:'Office services',boundaries:[
    {id:'host',kind:'server',label:'Office server'},
    {id:'runtime',kind:'runtime',label:'systemd',parentId:'host'},
    {id:'directory',kind:'container',label:'Directory server',...nestedRemote?{parentId:'remote-host'}:{}},
    ...nestedRemote?[{id:'remote-host',kind:'server' as const,label:'Remote directory host'}]:[],
  ],nodes:[
    {id:'api',label:'Backend',category:'compute',origin:'existing',boundaryId:'runtime',bindings:{resourceIds:['services']}},
    {id:'worker',label:'Worker',category:'compute',origin:'existing',boundaryId:'runtime',bindings:{resourceIds:['services']}},
    {id:'data',label:'Database',category:'storage',origin:'existing',boundaryId:'host',bindings:{resourceIds:[]}},
    {id:'identity',label:'Sign in',category:'identity',origin:'existing',boundaryId:'directory',bindings:{resourceIds:[]}},
  ],connections:[
    {id:'sql',from:'api',to:'data',kind:'communicatesWith'},
    {id:'login',from:'api',to:'identity',kind:'communicatesWith'},
  ]},binding);
  return projectSystemTopology(definition,{...binding,definitionDigest:definition.digest,configurationDigest:'c'.repeat(64),resources:[],components:[],checks:[]});
}

const inside=(box:{x:number;y:number;width:number;height:number},viewport:{x:number;y:number;zoom:number},size:{width:number;height:number})=>{
  for(const point of [{x:box.x,y:box.y},{x:box.x+box.width,y:box.y+box.height}]){
    const x=point.x*viewport.zoom+viewport.x,y=point.y*viewport.zoom+viewport.y;
    assert(x>=23.99&&x<=size.width-23.99,JSON.stringify({box,viewport,size,x}));
    assert(y>=23.99&&y<=size.height-23.99,JSON.stringify({box,viewport,size,y}));
  }
};

test('physical area follows exact actors without moving for each stage or component in that area',()=>{
  const view=topology(),before=structuredClone(view);
  for(const placement of [createSystemGraphPlacement(view),createIsometricSystemPlacement(view)]){
    const first=selectSystemCameraFocus(view,placement,{componentIds:['api'],boundaryIds:['host','runtime']})!;
    const next=selectSystemCameraFocus(view,placement,{componentIds:['worker'],boundaryIds:['runtime','host']})!;
    const parallel=selectSystemCameraFocus(view,placement,{componentIds:['worker','api'],boundaryIds:['host','runtime']})!;
    assert.deepEqual(first.areaIds,['runtime']);
    assert.equal(first.key,next.key);assert.equal(first.key,parallel.key);
    assert.deepEqual(first.bounds,((({x,y,width,height})=>({x,y,width,height}))(placement.boxes.get('runtime')!)));
    assert.deepEqual(first.bounds,next.bounds);assert.deepEqual(first.bounds,parallel.bounds);
    assert.deepEqual(first.contextBounds,next.contextBounds,'context belongs to the physical area, not the current actor');
  }
  assert.deepEqual(view,before);assert(view.nodes.every(node=>node.origin==='existing'));
});

test('simultaneous work in separate hosts stays in one stable combined area',()=>{
  const view=topology(),placement=createIsometricSystemPlacement(view);
  const focus=selectSystemCameraFocus(view,placement,{componentIds:['api','identity'],boundaryIds:['host','runtime','directory']})!;
  const reordered=selectSystemCameraFocus(view,placement,{componentIds:['identity','api','api'],boundaryIds:['directory','runtime','host']})!;
  assert.deepEqual(focus.areaIds,['directory','runtime']);assert.equal(focus.key,reordered.key);assert.deepEqual(focus.bounds,reordered.bounds);
  const size={width:960,height:640},camera=fitSystemCameraFocus(systemGraphBounds(placement),focus.bounds,size,focus.contextBounds)!;
  inside(focus.bounds,camera,size);
  for(const id of focus.areaIds)inside(placement.boxes.get(id)!,camera,size);
});

test('component work and separate boundary-only work share the camera without inheriting broad actor ancestors',()=>{
  const view=topology(),placement=createIsometricSystemPlacement(view);
  const focus=selectSystemCameraFocus(view,placement,{componentIds:['api'],boundaryIds:['host','runtime','directory','missing']})!;
  assert.deepEqual(focus.areaIds,['directory','runtime']);
  const componentOnly=selectSystemCameraFocus(view,placement,{componentIds:['api'],boundaryIds:['host','runtime']})!;
  assert.deepEqual(componentOnly.areaIds,['runtime']);
  const size={width:960,height:640},camera=fitSystemCameraFocus(systemGraphBounds(placement),focus.bounds,size,focus.contextBounds)!;
  for(const id of focus.areaIds)inside(placement.boxes.get(id)!,camera,size);
  const containingActor=selectSystemCameraFocus(view,placement,{componentIds:['data'],boundaryIds:['host','runtime']})!;
  assert.deepEqual(containingActor.areaIds,['host'],'real host-level actor coverage retains a separately selected child area');
});

test('real component work on a containing host retains that whole area instead of dropping the actor',()=>{
  const view=topology(),placement=createSystemGraphPlacement(view);
  const focus=selectSystemCameraFocus(view,placement,{componentIds:['api','data'],boundaryIds:['host','runtime']})!;
  assert.deepEqual(focus.areaIds,['host']);
  const size={width:900,height:600},camera=fitSystemCameraFocus(systemGraphBounds(placement),focus.bounds,size,focus.contextBounds)!;
  inside(placement.boxes.get('api')!,camera,size);inside(placement.boxes.get('data')!,camera,size);
});

test('boundary-only work prefers its deepest declared areas; absent or wrong-kind identities create no target',()=>{
  const view=topology(),placement=createSystemGraphPlacement(view);
  assert.deepEqual(selectSystemCameraFocus(view,placement,{componentIds:[],boundaryIds:['host','runtime']})!.areaIds,['runtime']);
  for(const focus of [undefined,{componentIds:[],boundaryIds:[]},{componentIds:['missing'],boundaryIds:[]},{componentIds:['runtime'],boundaryIds:['api']}]){
    assert.equal(selectSystemCameraFocus(view,placement,focus),undefined);
  }
  const missing={...placement,boxes:new Map([...placement.boxes].filter(([id])=>id!=='api'))};
  assert.equal(selectSystemCameraFocus(view,missing,{componentIds:['api'],boundaryIds:[]}),undefined);
});

test('flat and isometric focus remain restrained and fit all active geometry at desktop and narrow widths',()=>{
  const view=topology();
  for(const placement of [createSystemGraphPlacement(view),createIsometricSystemPlacement(view)]){
    const bounds=systemGraphBounds(placement),focus=selectSystemCameraFocus(view,placement,{componentIds:['identity'],boundaryIds:['directory']})!;
    for(const size of [{width:960,height:640},{width:331,height:500}]){
      const overview=fitDiagramCamera(bounds,size)!,camera=fitSystemCameraFocus(bounds,focus.bounds,size,focus.contextBounds)!;
      assert(camera.zoom<=overview.zoom*1.18+1e-9);assert(camera.zoom<=1);assert(camera.zoom>=overview.zoom-1e-9);
      inside(focus.bounds,camera,size);inside(focus.contextBounds,camera,size);
    }
  }
});

test('nearby connected context remains visible when it fits without increasing the focus zoom',()=>{
  const system={x:0,y:0,width:1800,height:1000},focus={x:100,y:100,width:200,height:100},context={x:100,y:100,width:1000,height:200},size={width:800,height:600};
  const centred=fitSystemCameraFocus(system,focus,size)!,withContext=fitSystemCameraFocus(system,focus,size,context)!;
  assert.equal(withContext.zoom,centred.zoom);assert(withContext.x<centred.x,'context can gently shift centering without another zoom');
  inside(focus,withContext,size);inside(context,withContext,size);
  const separateNeighbour={x:900,y:100,width:200,height:200};
  inside(focus,fitSystemCameraFocus(system,focus,size,separateNeighbour)!,size);
});

test('a remote connected card reduces the zoom increase instead of being clipped at the viewport edge',()=>{
  const system={x:0,y:0,width:1800,height:1000},focus={x:100,y:100,width:200,height:100},remote={x:1500,y:350,width:200,height:100},context={x:100,y:100,width:1600,height:350},size={width:800,height:600};
  const centred=fitSystemCameraFocus(system,focus,size)!,withContext=fitSystemCameraFocus(system,focus,size,context)!;
  assert(withContext.zoom<centred.zoom,'complete connection context takes priority over using the full 18% zoom increase');
  assert(withContext.zoom<=fitDiagramCamera(system,size)!.zoom*1.18);
  inside(focus,withContext,size);inside(remote,withContext,size);inside(context,withContext,size);
});

test('unmeasured or invalid geometry cannot initiate a camera move',()=>{
  const box={x:0,y:0,width:100,height:100},size={width:800,height:600};
  for(const dimensions of [{width:0,height:600},{width:800,height:0},{width:NaN,height:600},{width:48,height:600}])assert.equal(fitSystemCameraFocus(box,box,dimensions),undefined);
  for(const invalid of [{...box,x:NaN},{...box,width:0},{...box,height:-1}]){
    assert.equal(fitSystemCameraFocus(invalid,box,size),undefined);assert.equal(fitSystemCameraFocus(box,invalid,size),undefined);
  }
  const enormous={...box,width:100_000_000,height:100_000_000};
  assert.equal(fitSystemCameraFocus(enormous,enormous,size),undefined,'an area beyond the supported minimum zoom is not falsely declared fitted');
});


test('gentle object focus retains connected remote boundary artwork, captions, ground and ancestor placement',()=>{
 for(const nestedRemote of [false,true]){
  const view=topology(nestedRemote),before=structuredClone(view),placement=createIsometricSystemPlacement(view,objectGeometryProfile),nativeFocus={componentIds:['api'],boundaryIds:['host','runtime']},focusBefore=structuredClone(nativeFocus);
  const focus=selectSystemCameraFocus(view,placement,nativeFocus)!;
  assert.deepEqual(focus.areaIds,['runtime']);assert.equal(focus.key,JSON.stringify(['runtime']),'context does not become an active area');
  const remoteIds=['directory',...nestedRemote?['remote-host']:[]];
  for(const id of remoteIds){
   const box=placement.boxes.get(id)!,context=focus.contextBounds;
   const tolerance = 1e-7; // Projected coordinates can differ by a fraction of a pixel after subtraction.
   assert(
    context.x<=box.x+tolerance&&context.y<=box.y+tolerance
      &&context.x+context.width>=box.x+box.width-tolerance&&context.y+context.height>=box.y+box.height-tolerance,
    `${id} art, caption and ground are part of the camera context`,
   );
  }
  for(const size of [{width:960,height:640},{width:720,height:500},{width:331,height:500}]){
   const camera=fitSystemCameraFocus(systemGraphBounds(placement),focus.bounds,size,focus.contextBounds)!;
   for(const id of ['runtime',...remoteIds])inside(placement.boxes.get(id)!,camera,size);
  }
  const next=selectSystemCameraFocus(view,placement,{componentIds:['worker'],boundaryIds:['runtime','host']})!;
  assert.equal(focus.key,next.key);assert.deepEqual(focus.contextBounds,next.contextBounds,'no per-stage camera movement within one area');
  assert.deepEqual(view,before);assert.deepEqual(nativeFocus,focusBefore,'camera context does not create activity highlights');
 }
});
