import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {compileGraph} from 'footprintjs-iac/graph';
import {defineSystemTopology,projectSystemTopology} from 'footprintjs-iac/system-topology/node';
import type {DashboardState} from '../src/core/types.ts';

const root=join(import.meta.dirname,'..'),compiled=await build({stdin:{contents:"export {Sidebar} from './web/components/Sidebar.tsx';export {InfrastructureWorkspace} from './web/components/InfrastructureWorkspace.tsx';",resolveDir:root,loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'});
await mkdir(join(root,'.artifacts'),{recursive:true});const directory=await mkdtemp(join(root,'.artifacts/topology-counts-'));let components:{Sidebar:import('react').ComponentType<any>;InfrastructureWorkspace:import('react').ComponentType<any>};
try{const file=join(directory,'render.mjs');await writeFile(file,compiled.outputFiles[0]!.text);components=await import(pathToFileURL(file).href);}finally{await rm(directory,{recursive:true,force:true});}
function state():DashboardState{
 const graph=compileGraph({name:'shared-deployment',resources:[{id:'services',provider:'registered',spec:{kind:'SystemdServiceGroup'}}],boundaries:[],memberships:[],relations:[]});
 const categories=['compute','compute','storage','storage','storage','network','identity']as const;
 const definition=defineSystemTopology({id:'components',label:'Components',boundaries:[],connections:[],nodes:categories.map((category,index)=>({id:'component-'+index,label:'Component '+index,category,origin:'existing',bindings:{resourceIds:[]}}))},{targetId:'server',graphDigest:graph.digest});
 return{revision:1,busy:false,graph,systemTopology:projectSystemTopology(definition,{...definition.binding,definitionDigest:definition.digest,configurationDigest:'a'.repeat(64),resources:[],components:[],checks:[]})};
}
const noop=()=>{};
function sidebar(value:DashboardState){return renderToStaticMarkup(createElement(components.Sidebar,{state:value,view:'system',onView:noop}));}
function workspace(value:DashboardState){return renderToStaticMarkup(createElement(components.InfrastructureWorkspace,{state:value,view:'artifacts',evidenceKind:'deployment',onView:noop,onSelect:noop,onConnectionSelect:noop,onEvidenceKind:noop}));}
test('declared component counts remain separate from the one physical grouped deployment',()=>{
 const value=state(),html=sidebar(value);assert.match(html,/>COMPONENTS</);for(const[category,count]of[['compute',2],['storage',3],['network',1],['identity',1]])assert.match(html,new RegExp(`<span>${category}</span><strong>${count}</strong>`));
 assert.match(workspace(value),/7 components · 1 deployment resource</);
});
test('legacy hosts retain their original physical resource family counts',()=>{
 const value=state();delete value.systemTopology;const html=sidebar(value);assert.match(html,/>RESOURCE FAMILIES</);assert.match(html,/<span>compute<\/span><strong>1<\/strong>/);assert.match(html,/<span>storage<\/span><strong>0<\/strong>/);assert.match(html,/<span>network<\/span><strong>0<\/strong>/);assert.match(workspace(value),/>1 resources</);
});
