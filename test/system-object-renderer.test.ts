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
import {createIsometricSystemGraph,createIsometricSystemPlacement,projectSystemFloor} from '../web/features/system-topology/create-isometric-system-graph.ts';
import {componentArtworkSize,layoutSystemTopology,objectGeometryProfile,symbolGeometryProfile} from '../web/features/system-topology/topology-layout.ts';
import {readFileSync} from 'node:fs';
import {fitDiagramCamera} from '../web/lib/diagram-camera.ts';
import {labelRect,overlaps} from '../web/features/system-topology/topology-route-geometry.ts';

const root=join(import.meta.dirname,'..');
const compiled=await build({stdin:{contents:"export {default as Graph} from './web/features/system-topology/SystemTopologyGraph.tsx';export {SystemSymbolProvider as Provider} from './web/features/system-topology/symbol-context.tsx';export {TopologyObjectNode} from './web/features/system-topology/TopologyObjectNode.tsx';",resolveDir:root,loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic',logLevel:'silent'});
const work=join(root,'work');await mkdir(work,{recursive:true});const directory=await mkdtemp(join(work,'object-renderer-'));
let ui:{Graph:import('react').ComponentType<any>;Provider:import('react').ComponentType<any>;TopologyObjectNode:import('react').ComponentType<any>};
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
const fixture=topology();
const pack:DiagramSymbolPack={version:1,id:'consumer-objects',symbols:[{id:'physical-shape',presentation:'object',viewBox:{width:96,height:96},paths:[{d:'M 15 28 L 48 10 L 81 28 L 81 68 L 48 86 L 15 68 Z',fill:'surface',stroke:'ink'},{d:'M 15 28 L 48 46 L 81 28 M 48 46 L 48 86',fill:'subtle',stroke:'muted'}]}],bindings:[
 ...fixture.nodes.map(node=>({targetId:'office',topologyId:'placement',subject:'component' as const,subjectId:node.id,symbolId:'physical-shape'})),
 ...fixture.boundaries.map(boundary=>({targetId:'office',topologyId:'placement',subject:'boundary' as const,subjectId:boundary.id,symbolId:'physical-shape'})),
]};
const render=(view:ReturnType<typeof projectSystemTopology>,adapter=createSystemSymbolAdapter(pack),renderer='isometric')=>renderToStaticMarkup(createElement(ui.Provider,{adapter},createElement(ui.Graph,{view,renderer,simple:true,inspectable:true,executionFocus:{componentIds:['api'],boundaryIds:['host','runtime']}}))).replace(/<style>[\s\S]*?<\/style>/g,'');

test('the consumer drawing is the main isometric object, with no card or component tile',()=>{
 const view=topology(),before=structuredClone(view),html=render(view);
 assert.equal((html.match(/data-system-object="component"/g)??[]).length,7);
 assert.equal((html.match(/data-system-object="boundary"/g)??[]).length,3);
 assert.equal((html.match(/class="topology-object-art" width="144" height="124"/g)??[]).length,7);
 assert.equal((html.match(/data-physical-floor="boundary"/g)??[]).length,3);
 assert.doesNotMatch(html,/<article class="topology-node|topology-symbol-card|data-physical-floor="component"/);
 assert.match(html,/width:224px;height:216px/);assert.match(html,/class="topology-object-boundary-summary"/);
 assert.match(html,/data-component-id="api" data-origin="existing" data-execution-focus="true"/);
 assert.match(html,/class="topology-object-summary" aria-label="Compute · Recorded application · Existing · Checking"/);
 for(const text of ['Recorded application','Companion process','Process sessions','Existing database','Configuration files','Application endpoint','Existing identity','Embedded in app','Existing','Checking component','1 step recorded','1 of 3 checks verified'])assert(html.includes(text),text);
 assert.match(html,/data-recorded-work-count="1"/);assert.match(html,/class="topology-node-status"/);assert.match(html,/class="topology-node-progress"/);
 assert.doesNotMatch(html,/Creating database|>100%</);assert.deepEqual(view,before);
});

test('object CSS reserves large art and transparent unframed annotations, including focus',()=>{
 const css=readFileSync(join(root,'web/features/system-topology/objects.css'),'utf8');
 assert.match(css,/\.topology-boundary-object-art\{[^}]*width:80px;height:80px/);
 assert.match(css,/\.topology-object\{[^}]*background:none;border:0;box-shadow:none/);
 assert.match(css,/\.topology-object-boundary\{[^}]*background:none;border:0;box-shadow:none/);
 assert.match(css,/data-execution-focus="true"[^}]*filter:drop-shadow/);
 assert.doesNotMatch(css,/outline:2px|animation:[^;}]*progress|Date\.now/);
});

test('flat, glyph and unmapped presentations retain card compatibility',()=>{
 const view=topology(),flat=render(view,undefined,'flat');
 assert.equal((flat.match(/<article class="topology-node /g)??[]).length,7);assert.doesNotMatch(flat,/data-system-object=/);
 assert.match(flat,/width:224px;height:128px/);
 const glyph=createSystemSymbolAdapter({...pack,symbols:pack.symbols.map(({presentation,...symbol})=>symbol)}),legacy=render(view,glyph);
 assert.equal((legacy.match(/<article class="topology-node /g)??[]).length,7);assert.doesNotMatch(legacy,/data-system-object=/);
 assert.match(legacy,/width:224px;height:128px/);
 const unmapped=createSystemSymbolAdapter({...pack,bindings:[]}),plain=render(view,unmapped);
 assert.equal((plain.match(/<article class="topology-node /g)??[]).length,7);assert.match(plain,/width:184px;height:104px/);
});

test('native action remains a link to the exact recorded instance when admitted',()=>{
 const node=topology().nodes.find(node=>node.id==='api')!;
 const step={deploymentRunId:'deploy',nativeRunId:'actual-native-run',resourceId:'services',stageId:'observe',runtimeStageId:'provider/observe#3',scope:'component'};
 const html=renderToStaticMarkup(createElement(ui.TopologyObjectNode,{node,symbol:pack.symbols[0],box:{id:'api',kind:'node',x:0,y:0,width:224,height:216,depth:1},step,onRecordedStep:()=>{}}));
 assert.match(html,/<button type="button" class="topology-node-action action-running" aria-label="Show deployment step for Recorded application"/);
 assert.match(html,/Checking component/);assert.doesNotMatch(html,/Unconfirmed|Native deployment step unavailable/);
 const missing=renderToStaticMarkup(createElement(ui.TopologyObjectNode,{node,symbol:pack.symbols[0],box:{id:'api',kind:'node',x:0,y:0,width:224,height:216,depth:1}}));
 assert.doesNotMatch(missing,/<button[^>]*topology-node-action/);assert.match(missing,/Native deployment step unavailable/);
});

test('the shared renderer shows active removal and fades only an admitted removed object',()=>{
 const view=topology();
 const capture=(status:'deploying'|'deleted',complete:boolean)=>projectSystemTopology(view.definition,{
  ...view.observations,
  resources:[{
   id:'services',action:'delete',status,
   evidence:{kind:'deployment',runId:'recorded-run',runtimeStageId:'reconcile-services#2',complete},
  }],
 });
 const removing=render(capture('deploying',false));
 assert.match(removing,/data-fp="diagram-node-appearance" data-activity="removing"/);
 assert.doesNotMatch(removing,/data-fp="diagram-node-paint" data-presence="removed"/);
 assert.doesNotMatch(render(capture('deleted',false)),/data-fp="diagram-node-paint" data-presence="removed"/);
 const removed=render(capture('deleted',true));
 assert.match(removed,/data-fp="diagram-node-paint" data-presence="removed" style="[^"]*opacity:/);
 assert.equal((removed.match(/data-system-object="component"/g)??[]).length,7,'the confirmed object geometry stays available to replay');
});

test('all seven object bodies, boundary captions, wire anchors and labels have measured non-overlapping geometry',()=>{
 const view=topology(),placement=createIsometricSystemPlacement(view,objectGeometryProfile),graph=createIsometricSystemGraph(view,placement);
 const bodies=[...placement.objects.values()].flatMap(object=>object.card?[object.card]:[]),headers=[...placement.objects.values()].flatMap(object=>object.header?[object.header]:[]);
 assert(bodies.every(box=>box.width===224&&box.height===216));assert(headers.every(box=>box.width===332&&box.height===80));
 for(const [index,body]of bodies.entries()){
  assert(bodies.slice(index+1).every(other=>!overlaps(body,other,0)),`object body ${body.id} is clear of other drawings/captions`);
  assert(headers.every(header=>!overlaps(body,header,0)),`object body ${body.id} is clear of boundary drawings/captions`);
 }
 for(const [index,header]of headers.entries())assert(headers.slice(index+1).every(other=>!overlaps(header,other,0)),'boundary object captions remain separate');
 for(const node of graph.nodes){
  assert.equal(node.data.active,undefined);assert.equal(node.data.done,undefined);
  const box=placement.boxes.get(node.id)!;
  if(node.parentId){const parent=placement.boxes.get(node.parentId)!;assert(box.x>=parent.x);assert(box.y>=parent.y);assert(box.x+box.width<=parent.x+parent.width+.001);assert(box.y+box.height<=parent.y+parent.height+.001);}
 }
 for(const edge of view.connections){
  const route=placement.routes.get(edge.id)!,source=placement.objects.get(edge.from)!,target=placement.objects.get(edge.to)!;
  assert(route.path,edge.id);
  for(const [point,object]of [[route.points[0]!,source],[route.points.at(-1)!,target]]as const){assert(Math.abs(point.x-object.anchor!.x)<=52.00001);assert(point.y<=object.anchor!.y-7.99999&&point.y>=object.anchor!.y-48.00001);}
  assert.equal(source.anchor!.y,source.card!.y+componentArtworkSize.height,'actual object base meets the physical wire anchor');
  const sourceNode=graph.nodes.find(node=>node.id===edge.from)!,port=sourceNode.handles!.find(port=>port.id===`out:${edge.id}`)!;
  assert(Math.abs(source.box.x+port.x!+3-route.points[0]!.x)<.00001);assert(Math.abs(source.box.y+port.y!+3-route.points[0]!.y)<.00001);
  if(edge.kind!=='dependsOn')assert(!route.labelHidden,`${edge.id} keeps its native connection badge`);
  if(!route.labelHidden)assert([...bodies,...headers].every(object=>!overlaps(labelRect(route),object,0)),`${edge.id} badge does not cover artwork/captions`);
 }
 for(const node of view.nodes){
  const ports=view.connections.flatMap(edge=>{const route=placement.routes.get(edge.id)!;return[...edge.from===node.id?[route.points[0]!]:[],...edge.to===node.id?[route.points.at(-1)!]:[]];});
  for(const [index,port]of ports.entries())for(const other of ports.slice(index+1))assert(Math.hypot(port.x-other.x,port.y-other.y)>=9.99999,`${node.id} arrowheads do not merge`);
 }
 const bounds=systemGraphBounds(placement);
 for(const size of [{width:1024,height:640},{width:331,height:500}]){
  const camera=fitDiagramCamera(bounds,size)!;
  for(const box of placement.boxes.values())for(const point of [{x:box.x,y:box.y},{x:box.x+box.width,y:box.y+box.height}]){assert(point.x*camera.zoom+camera.x>=23);assert(point.x*camera.zoom+camera.x<=size.width-23);assert(point.y*camera.zoom+camera.y>=23);assert(point.y*camera.zoom+camera.y<=size.height-23);}
 }
});

test('a boundary with one object gets a compact floor without moving its object or covering its label',()=>{
 const view=topology();
 const authored=layoutSystemTopology(view,objectGeometryProfile).boxes;
 const placement=createIsometricSystemPlacement(view,objectGeometryProfile);
 const remote=placement.objects.get('remote')!;
 const oldFloor=authored.find(box=>box.id==='remote')!;
 const [back,right,front,left]=remote.floor;
 const compactArea=(front!.y-back!.y)*(right!.x-left!.x)/2;
 const authoredArea=oldFloor.width*oldFloor.height*Math.sqrt(3)/2*1.35**2;
 assert(compactArea<authoredArea/2,'the platform takes less than half its previous area');

 const identity=placement.objects.get('identity')!;
 const child=authored.find(box=>box.id==='identity')!;
 assert.deepEqual(identity.anchor,projectSystemFloor({x:child.x+child.width/2,y:child.y+child.height/2}));
 assert(remote.header!.y+remote.header!.height<identity.card!.y,'the boundary label clears the drawing');
 assert(placement.routes.get('api-identity')?.path,'the remote connection remains visible');

 const host=authored.find(box=>box.id==='host')!;
 assert.deepEqual(placement.objects.get('host')!.floor[0],projectSystemFloor(host));
 assert.deepEqual(placement.objects.get('host')!.floor[2],projectSystemFloor({x:host.x+host.width,y:host.y+host.height}));
});

test('ready, failed and replayed native states change evidence without moving objects or implying installation',()=>{
 const view=topology(),placement=createIsometricSystemPlacement(view,objectGeometryProfile),before=createIsometricSystemGraph(view,placement);
 for(const status of ['pending','ready','failed']as const){
  const changed={...view,nodes:view.nodes.map(node=>({...node,status,statusLabel:status,actions:status==='pending'?[]:node.actions}))},after=createIsometricSystemGraph(changed,placement),html=render(changed);
  assert.deepEqual(after.nodes.map(node=>[node.id,node.position,node.width,node.height,node.handles]),before.nodes.map(node=>[node.id,node.position,node.width,node.height,node.handles]));
  assert.equal((html.match(/data-system-object="component"/g)??[]).length,7);assert.match(html,/>Existing<\/span>/);assert.match(html,/>Embedded in app<\/span>/);
  if(status==='pending')assert.doesNotMatch(html,/Checking component|data-recorded-work-count=/);
 }
 assert.deepEqual(createIsometricSystemPlacement(view,{}),createIsometricSystemPlacement(view),'empty profiles retain previous geometry');
 assert.equal(createIsometricSystemPlacement(view,symbolGeometryProfile).objects.get('api')!.anchor,undefined,'glyphs keep their existing floor ports');
});
