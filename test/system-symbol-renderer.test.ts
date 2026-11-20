import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,rm,rmdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {defineSystemTopology,projectSystemTopology} from 'footprintjs-iac/system-topology/node';
import {createSystemSymbolAdapter,type DiagramSymbolPack} from '../src/core/system-symbols.ts';
import {createSystemGraph,createSystemGraphPlacement,systemGraphBounds} from '../web/features/system-topology/create-system-graph.ts';
import {createIsometricSystemGraph,createIsometricSystemPlacement} from '../web/features/system-topology/create-isometric-system-graph.ts';
import {symbolGeometryProfile} from '../web/features/system-topology/topology-layout.ts';
import {fitDiagramCamera} from '../web/lib/diagram-camera.ts';
import {labelRect,overlaps} from '../web/features/system-topology/topology-route-geometry.ts';

const root=join(import.meta.dirname,'..');
const compiled=await build({stdin:{contents:"export {default as Graph} from './web/features/system-topology/SystemTopologyGraph.tsx';export {SystemSymbolProvider as Provider} from './web/features/system-topology/symbol-context.tsx';export {DiagramSymbol} from './web/features/system-topology/DiagramSymbol.tsx';",resolveDir:root,loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic',logLevel:'silent'});
const work=join(root,'work');await mkdir(work,{recursive:true});const directory=await mkdtemp(join(work,'symbol-renderer-'));
let ui:{Graph:import('react').ComponentType<any>;Provider:import('react').ComponentType<any>;DiagramSymbol:import('react').ComponentType<any>};
try{const file=join(directory,'render.mjs');await writeFile(file,compiled.outputFiles[0]!.text);ui=await import(pathToFileURL(file).href);}
finally{await rm(directory,{recursive:true,force:true});await rmdir(work).catch(error=>{if(!['ENOTEMPTY','ENOENT'].includes(error.code))throw error;});}

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
const pack:DiagramSymbolPack={version:1,id:'consumer-artwork',symbols:[{id:'consumer-object',viewBox:{width:64,height:48},paths:[{d:'M 4 4 L 60 4 L 60 44 L 4 44 Z',fill:'surface',stroke:'ink',strokeWidth:1.5},{d:'M 4 4 L 20 16 L 60 16',fill:'subtle',stroke:'muted'}]}],bindings:[
 {targetId:'office',topologyId:'placement',subject:'boundary',subjectId:'host',symbolId:'consumer-object'},
 {targetId:'office',topologyId:'placement',subject:'component',subjectId:'api',symbolId:'consumer-object'},
 {targetId:'office',topologyId:'placement',subject:'component',subjectId:'data',symbolId:'consumer-object'},
]};
const render=(view:ReturnType<typeof topology>,adapter= createSystemSymbolAdapter(pack),renderer='isometric')=>renderToStaticMarkup(createElement(ui.Provider,{adapter},createElement(ui.Graph,{view,renderer,simple:true,inspectable:false,executionFocus:{componentIds:['api'],boundaryIds:['host','runtime']}}))).replace(/<style>[\s\S]*?<\/style>/g,'');

test('consumer symbols retain recorded identities, Existing/Embedded origins, exact focus and measured progress',()=>{
 const view=topology(),before=structuredClone(view);
 for(const renderer of ['flat','isometric']){
  const html=render(view,undefined,renderer);
  assert.equal((html.match(/data-diagram-symbol="consumer-object"/g)??[]).length,3);
  assert.match(html,/data-component-id="api" data-origin="existing" data-execution-focus="true"/);
  assert.match(html,/data-component-id="sessions" data-origin="embedded"/);
  assert.match(html,/Recorded application/);assert.match(html,/>Existing<\/span>/);assert.match(html,/>Embedded in app<\/span>/);
  assert.match(html,/Checking component/);assert.match(html,/1 steps? recorded/);assert.match(html,/Recorded application: 1 of 3 checks verified/);
  assert.match(html,/width:224px;height:128px/);
  assert.doesNotMatch(html,/>VISITED<|Creating database|>100%</);
 }
 assert.deepEqual(view,before,'symbol presentation cannot overwrite recorded facts');
});

test('unmapped and foreign consumer packs retain the original label cards and default geometry',()=>{
 const view=topology(),foreign=createSystemSymbolAdapter({...pack,bindings:pack.bindings.map(binding=>({...binding,targetId:'another-office'}))});
 const plain=renderToStaticMarkup(createElement(ui.Graph,{view,simple:true,inspectable:false}));
 assert.doesNotMatch(plain,/data-diagram-symbol=/);assert.match(plain,/width:184px;height:104px/);
 const html=render(view,foreign);
 assert.doesNotMatch(html,/data-diagram-symbol=|topology-symbol-card/);
 assert.match(html,/width:184px;height:104px/);assert.match(html,/Recorded application/);
 const partial=render(view);
 assert.equal((partial.match(/topology-symbol-card/g)??[]).length,2,'only exact mapped components receive artwork');
 assert.equal((partial.match(/data-component-id=/g)??[]).length,7,'unmapped objects remain in the system');
});

test('passive paths inherit theme paint while labels and evidence supply the accessible meaning',()=>{
 const html=renderToStaticMarkup(createElement(ui.DiagramSymbol,{symbol:pack.symbols[0],className:'consumer-slot'}));
 assert.match(html,/viewBox="0 0 64 48"/);assert.match(html,/aria-hidden="true"/);assert.match(html,/focusable="false"/);
 assert.match(html,/var\(--fp-bg-elevated/);assert.match(html,/var\(--fp-text-primary/);assert.match(html,/var\(--fp-text-muted/);
 assert.doesNotMatch(html,/foreignObject|<image|href=|<script|https?:/);
});

test('symbol geometry fits glyph cards, headers, floors, ports and physical connections in both projections',()=>{
 const view=topology(),before=structuredClone(view),flat=createSystemGraphPlacement(view,symbolGeometryProfile),iso=createIsometricSystemPlacement(view,symbolGeometryProfile);
 for(const placement of [flat,iso]){
  const graph=placement===flat?createSystemGraph(view,placement):createIsometricSystemGraph(view,iso);
  assert.equal(graph.nodes.length,view.nodes.length+view.boundaries.length);assert.equal(graph.edges.length,view.connections.length);
  for(const node of graph.nodes){
   assert.equal(node.data.active,undefined);assert.equal(node.data.done,undefined);
   if(node.parentId){const box=placement.boxes.get(node.id)!,parent=placement.boxes.get(node.parentId)!;assert(box.x>=parent.x);assert(box.y>=parent.y);assert(box.x+box.width<=parent.x+parent.width+.001);assert(box.y+box.height<=parent.y+parent.height+.001);}
  }
  const bounds=systemGraphBounds(placement),points=[...placement.boxes.values()].flatMap(box=>[{x:box.x,y:box.y},{x:box.x+box.width,y:box.y+box.height}]);
  for(const size of [{width:1024,height:640},{width:331,height:500}]){
   const camera=fitDiagramCamera(bounds,size)!;
   for(const point of points){assert(point.x*camera.zoom+camera.x>=23);assert(point.x*camera.zoom+camera.x<=size.width-23);assert(point.y*camera.zoom+camera.y>=23);assert(point.y*camera.zoom+camera.y<=size.height-23);}
  }
 }
 const cards=[...iso.objects.values()].flatMap(object=>object.card?[object.card]:[]),headers=[...iso.objects.values()].flatMap(object=>object.header?[{...object.header,height:36}]:[]);
 assert(cards.every(card=>card.width===224&&card.height===128));assert(headers.every(header=>header.width===332));
 for(const [index,card]of cards.entries()){assert(cards.slice(index+1).every(other=>!overlaps(card,other,0)));assert(headers.every(header=>!overlaps(card,header,0)));}
 for(const edge of view.connections){const route=iso.routes.get(edge.id)!;assert(route.path,`${edge.id} keeps its physical connection`);if(edge.kind!=='dependsOn')assert(!route.labelHidden,`${edge.id} keeps its measured connection badge`);if(!route.labelHidden)assert([...cards,...headers].every(object=>!overlaps(labelRect(route),object,0)));}
 assert.deepEqual(view,before);
});

test('larger symbol cards keep a crowded projected badge visible within bounded offsets',()=>{
 const view=topology(),iso=createIsometricSystemPlacement(view,symbolGeometryProfile);
 const recovered=iso.routes.get('api-data')!;
 assert.equal(recovered.labelHidden,false,'projected geometry independently finds a safe measured badge');
 assert(recovered.labelAnchor,'the offset badge retains an anchor on its real physical wire');
 const anchor=recovered.labelAnchor!;
 const offset=Math.hypot(recovered.x-anchor.x,recovered.y-anchor.y);
 assert(offset>66,'the larger upright cards need more space than the default badge corridor');
 assert(offset<=144.001,'the search remains bounded');
 assert.deepEqual(createIsometricSystemPlacement(view,{}).routes,createIsometricSystemPlacement(view).routes,'an empty profile preserves default placement behavior');
});

test('native progress and failures change evidence without moving consumer artwork or physical links',()=>{
 const view=topology(),placement=createIsometricSystemPlacement(view,symbolGeometryProfile),before=createIsometricSystemGraph(view,placement);
 const changed={...view,nodes:view.nodes.map(node=>({...node,status:'failed' as const,statusLabel:'Failed'})),connections:view.connections.map(edge=>({...edge,status:'failed' as const}))};
 const after=createIsometricSystemGraph(changed,placement);
 assert.deepEqual(after.nodes.map(node=>[node.id,node.position,node.parentId,node.width,node.height,node.handles]),before.nodes.map(node=>[node.id,node.position,node.parentId,node.width,node.height,node.handles]));
 const html=render(changed);
 assert.equal((html.match(/data-diagram-symbol="consumer-object"/g)??[]).length,3);assert.match(html,/Failed/);assert.match(html,/>Existing<\/span>/);
});
