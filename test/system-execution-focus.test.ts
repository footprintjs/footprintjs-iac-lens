import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,rm,rmdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {defineSystemTopology,projectSystemTopology} from 'footprintjs-iac/system-topology/node';
import type {SystemTopologyView} from 'footprintjs-iac/system-topology';
import type {SystemExecutionFocus} from '../web/features/system-topology/execution-focus.ts';

const root=join(import.meta.dirname,'..');
const compiled=await build({stdin:{contents:"export {default as Graph} from './web/features/system-topology/SystemTopologyGraph.tsx';",resolveDir:root,loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic',logLevel:'silent'});
const work=join(root,'work');await mkdir(work,{recursive:true});
const directory=await mkdtemp(join(work,'system-follow-highlight-'));
let Graph:import('react').ComponentType<any>;
try{const file=join(directory,'render.mjs');await writeFile(file,compiled.outputFiles[0]!.text);({Graph}=await import(pathToFileURL(file).href));}
finally{await rm(directory,{recursive:true,force:true});await rmdir(work).catch(error=>{if(error.code!=='ENOTEMPTY')throw error;});}

function topology():SystemTopologyView {
 const binding={targetId:'office',graphDigest:'b'.repeat(64)};
 const definition=defineSystemTopology({id:'placement',label:'Office services',boundaries:[{id:'host',kind:'server',label:'Office server'},{id:'runtime',kind:'runtime',label:'systemd',parentId:'host'}],nodes:[
  {id:'api',label:'Backend',category:'compute',origin:'existing',boundaryId:'runtime',bindings:{resourceIds:['services']}},
  {id:'sessions',label:'Sessions',category:'storage',origin:'embedded',boundaryId:'runtime',bindings:{resourceIds:[]}},
  {id:'data',label:'Database',category:'storage',origin:'existing',boundaryId:'host',bindings:{resourceIds:[]}},
 ],connections:[{id:'database-link',from:'api',to:'data',kind:'communicatesWith',label:'SQL connection',checkIds:['sql-check']}]},binding);
 const view=projectSystemTopology(definition,{...binding,definitionDigest:definition.digest,configurationDigest:'c'.repeat(64),resources:[],components:[],checks:[]});
 return{...view,nodes:view.nodes.map(node=>node.id==='api'?{...node,status:'checking',statusLabel:'Checking',progress:{completed:1,total:3,indeterminate:true},actions:[{resourceId:'services',componentId:'api',phase:'observe',status:'running',scope:'component',label:'Checking component',evidence:{kind:'adapter',runId:'actual-native-run',runtimeStageId:'provider/observe#3',complete:false}}]}:node)};
}
const render=(view:SystemTopologyView,executionFocus?:SystemExecutionFocus,renderer='isometric')=>renderToStaticMarkup(createElement(Graph,{view,executionFocus,renderer,simple:true,inspectable:false}));
const markers=(html:string)=>[...html.matchAll(/<(?:article|div)\b[^>]*\bdata-(component|boundary)-id="([^"]+)"[^>]*\bdata-execution-focus="true"/g)].map(match=>`${match[1]}:${match[2]}`).sort();

test('follow highlights only exact physical IDs while retaining Existing labels and native action progress',()=>{
 const view=topology(),before=structuredClone(view);
 for(const renderer of ['flat','isometric']){
  const html=render(view,{componentIds:['api'],boundaryIds:['host','runtime']},renderer);
  assert.deepEqual(markers(html),['boundary:host','boundary:runtime','component:api']);
  assert.match(html,/data-component-id="api" data-origin="existing" data-execution-focus="true"/);
  assert.match(html,/data-component-id="sessions" data-origin="embedded"/);
  assert.match(html,/>Existing<\/span>/);assert.match(html,/>Embedded in app<\/span>/);
  assert.match(html,/>Checking<\/span>/);assert.match(html,/Checking component/);
  assert.match(html,/Backend: 1 of 3 checks verified/);assert.match(html,/aria-valuenow="1"/);assert.match(html,/1\/3 verified/);
  assert.match(html,/<title>SQL connection: Not checked<\/title>/);
  assert.doesNotMatch(html,/>100%<|Creating database/);
 }
 assert.deepEqual(view,before,'follow presentation never rewrites admitted facts or evidence');
});

test('unmapped and wrong-kind focus IDs do not highlight other components or their containing server',()=>{
 const view=topology();
 assert.deepEqual(markers(render(view)),[],'standalone consumers keep their current appearance');
 assert.deepEqual(markers(render(view,{componentIds:['missing','host'],boundaryIds:['missing','api']})),[]);
 const html=render(view,{componentIds:['data'],boundaryIds:[]});
 assert.deepEqual(markers(html),['component:data'],'the UI does not infer a host or sibling highlight');
 assert.match(html,/data-component-id="data" data-origin="existing" data-execution-focus="true"/);
 assert.match(html,/Storage · Database · Existing ·/);
 assert.equal((html.match(/data-component-id=/g)??[]).length,view.nodes.length,'unfocused components remain present');
});
