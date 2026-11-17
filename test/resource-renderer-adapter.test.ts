import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import type {ConnectionStatus,DashboardState} from '../src/core/types.ts';
import {buildResourceView} from '../web/lib/resource-view.ts';
import {createResourceTraceGraph,resourceTraceBounds} from '../web/lib/create-resource-trace-graph.ts';
import {fitDiagramCamera} from '../web/lib/diagram-camera.ts';

/** Host projection fixture: resource readiness and measured communication are separate facts. */
function state(connectionStatus?:ConnectionStatus):DashboardState {
  return{revision:1,busy:false,graph:{kind:'infra-graph',version:1,name:'legacy-resources',digest:'a'.repeat(64),boundaries:[],memberships:[],
    relations:[{kind:'communicatesWith',from:'app',to:'database'}],resources:[
      {id:'database',provider:'fixture',spec:{kind:'Database',family:'storage'}},
      {id:'app',provider:'fixture',dependsOn:['database'],spec:{kind:'Service',family:'compute'}},
    ]},run:{id:'resource-run',status:'passed',events:[],resources:[{id:'database',status:'ready',action:'find'},{id:'app',status:'ready',action:'update'}]},
    ...connectionStatus?{connections:{id:'measured-check',status:connectionStatus==='failed'?'failed':connectionStatus==='checking'?'checking':'passed',events:[],
      checks:[{connectionId:'communication:0',from:'app',to:'database',status:connectionStatus,runtimeStageId:'probe-database#2'}]}}:{},
  };
}

test('the resource fallback retains authored geometry and domain facts without inventing workflow ancestry',()=>{
  for(const mode of ['deployment','running-system'] as const){
    const input=state(),before=structuredClone(input),view=buildResourceView(input,'app',mode),graph=createResourceTraceGraph(view);
    assert.deepEqual(graph.nodes.map(node=>node.id),view.nodes.map(node=>node.id));
    for(const node of graph.nodes){
      const original=view.nodes.find(row=>row.id===node.id)!;
      assert.deepEqual(node.position,original.position);assert.deepEqual(node.handles,original.handles);
      assert.equal(node.data.resourceView,original.data);
      assert.equal(node.data.resourceView.deploymentHandles,mode==='deployment');assert.equal(node.selected,node.id==='app');
      assert.deepEqual(node.data.prevIds,[]);assert.deepEqual(node.data.nextIds,[]);
      assert.equal(Object.hasOwn(node.data,'active'),false);assert.equal(Object.hasOwn(node.data,'done'),false);
      assert.equal(node.draggable,false);assert.equal(node.connectable,false);
    }
    assert.equal(graph.nodes.find(node=>node.id==='database')!.data.resourceView.progress.action,'find');
    assert.equal(view.edges.find(edge=>edge.id==='communication:0')!.data!.connectionStatus,'untested','ready nodes cannot manufacture a connection result');
    assert.deepEqual(graph.edges,view.edges.map(({data:_domainData,...edge})=>edge),'route-specific metadata stays in the custom edge context, outside EUI workflow data');
    assert(graph.edges.every(edge=>!Object.hasOwn(edge,'data')));
    assert.equal(graph.edges.some(edge=>edge.id.startsWith('order:')),mode==='deployment');
    assert.deepEqual(input,before);
  }
});

test('measured connection failure and recovery retain resource IDs, routes, labels and independently ready resources',()=>{
  let first:ReturnType<typeof buildResourceView>|undefined;
  for(const status of ['checking','connected','failed','connected'] as const){
    const input=state(status),before=structuredClone(input),view=buildResourceView(input,undefined,'running-system'),graph=createResourceTraceGraph(view);
    first??=view;
    const connection=view.edges.find(edge=>edge.id==='communication:0')!,edge=graph.edges.find(edge=>edge.id===connection.id)!;
    assert.equal(connection.data!.connectionStatus,status);assert.match(connection.data!.label!,new RegExp(status==='checking'?'Checking':status==='failed'?'Failed':'Connected'));
    assert.deepEqual(connection.data!.route,first.edges.find(row=>row.id===connection.id)!.data!.route);
    assert.deepEqual([edge.source,edge.target,edge.sourceHandle,edge.targetHandle],[connection.source,connection.target,connection.sourceHandle,connection.targetHandle]);
    assert.deepEqual(edge.style,connection.style);assert.deepEqual(edge.markerEnd,connection.markerEnd);assert.equal(edge.animated,status==='checking');
    assert.equal(edge.ariaLabel,connection.ariaLabel);assert.equal(Object.hasOwn(edge,'data'),false);
    assert(graph.nodes.every(node=>node.data.resourceView.progress.status==='ready'),'a failed connection does not rewrite deployment readiness');
    assert.deepEqual(input,before);
  }
});

test('the single camera fits all authored cards and outside connection lanes into small and large viewports',()=>{
  const view=buildResourceView(state('checking'),undefined,'running-system'),bounds=resourceTraceBounds(view);
  const points=view.nodes.flatMap(node=>[node.position,{x:node.position.x+node.data.size.width,y:node.position.y+node.data.size.height}])
    .concat(view.edges.flatMap(edge=>edge.data!.route.points));
  for(const size of [{width:430,height:260},{width:960,height:320},{width:1280,height:720}]){
    const viewport=fitDiagramCamera(bounds,size)!;
    for(const point of points){
      const x=point.x*viewport.zoom+viewport.x,y=point.y*viewport.zoom+viewport.y;
      assert(x>=23.99&&x<=size.width-23.99);assert(y>=23.99&&y<=size.height-23.99);
    }
    assert(viewport.zoom<=1);
  }
  const distantLane={x:0,y:0,width:400,height:5000},small={width:430,height:260};
  const fitted=fitDiagramCamera(distantLane,small)!;
  assert(fitted.zoom<.15,'full route geometry is not clipped by the former fixed zoom floor');
  assert(distantLane.height*fitted.zoom+fitted.y<=small.height-23.99);
  assert.equal(fitDiagramCamera(bounds,{width:0,height:0}),undefined);
});

test('legacy resource consumers mount the actual shared EUI canvas with custom routed edges and no second fitter',async()=>{
  const root=resolve(import.meta.dirname,'..');
  const result=await build({stdin:{contents:"export {ResourceCanvas} from './web/components/ResourceCanvas.tsx';",resolveDir:root,loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'});
  await mkdir(join(root,'.artifacts'),{recursive:true});const directory=await mkdtemp(join(root,'.artifacts/resource-renderer-'));
  try{
    const file=join(directory,'render.mjs');await writeFile(file,result.outputFiles[0]!.text);const {ResourceCanvas}=await import(pathToFileURL(file).href);
    const input=state('checking'),before=structuredClone(input);let actions=0;
    const html=renderToStaticMarkup(createElement(ResourceCanvas,{state:input,mode:'running-system',fitWindow:true,onSelect:()=>{actions++;},onConnectionSelect:()=>{actions++;}}));
    assert.match(html,/data-fp="traced-flow"/);assert.match(html,/data-fp-renderer="flat"/);assert.match(html,/data-unstyled="true"/);
    assert.equal(actions,0);assert.deepEqual(input,before);
    assert(!result.outputFiles[0]!.text.includes('function CanvasFit('),'the controlled camera is the only fitter mounted');
  }finally{await rm(directory,{recursive:true,force:true});}
});
