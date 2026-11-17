import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {defineSystemTopology,projectSystemTopology} from 'footprintjs-iac/system-topology/node';
import {resolveLensTheme} from '../web/theme/resolve-theme.ts';
import type {AdapterDeploymentResource} from '../src/core/adapter-deployment.ts';

test('standard deployment and isometric system inherit the same host token roles without a nested preset',async()=>{
 const root=join(import.meta.dirname,'..');
 const built=await build({stdin:{contents:"export {default as RunDeploymentScene} from './web/features/runs/RunDeploymentScene.tsx'; export {default as SystemTopologyGraph} from './web/features/system-topology/SystemTopologyGraph.tsx'; export {LensThemeProvider} from './web/theme/LensThemeContext.tsx';",resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'});
 await mkdir(join(root,'.artifacts'),{recursive:true});const directory=await mkdtemp(join(root,'.artifacts/standard-theme-'));
 try{
  const file=join(directory,'render.mjs');await writeFile(file,built.outputFiles[0]!.text);const components=await import(pathToFileURL(file).href);
  const binding={targetId:'local',graphDigest:'a'.repeat(64)};
  const definition=defineSystemTopology({id:'system',label:'App',boundaries:[{id:'host',kind:'server',label:'Server'}],nodes:[{id:'app',label:'App',category:'compute',origin:'existing',boundaryId:'host',bindings:{resourceIds:['services']}}],connections:[]},binding);
  const view=projectSystemTopology(definition,{...binding,definitionDigest:definition.digest,configurationDigest:'b'.repeat(64),resources:[],components:[],checks:[]});
  const resource:AdapterDeploymentResource={resourceId:'services',label:'App deployment',action:'update',rootScope:'execute-services',scopes:[{id:'execute-services',label:'App deployment'}],stages:[{id:'execute-services/check',stageId:'check',label:'Check app',kind:'stage',nativeKind:'stage',scope:'execute-services',resourceId:'services',status:'running',runtimeStageIds:['execute-services/check#0'],executions:1,column:0,row:0}],edges:[]};
  const value=resolveLensTheme({mode:'dark',tokens:{colors:{primary:'#dbaaff',nodeCursor:'#dbaaff',nodeVisited:'#8bcba3',bg:'#152438',bgPrimary:'#152438',bgSecondary:'#24364c',bgElevated:'#24364c',textPrimary:'#f0eaff',border:'#56738f'},fontFamily:{sans:'Host Sans'},nodes:{shadow:'none'}}});
  const render=(component:any,props:object)=>renderToStaticMarkup(createElement(components.LensThemeProvider,{value},createElement(component,props)));
  const left=render(components.RunDeploymentScene,{state:{revision:1,graph:null,busy:true},deployment:{available:true,runId:'run',resources:[resource],warnings:[]}});
  const right=render(components.SystemTopologyGraph,{view,renderer:'isometric',simple:true,inspectable:false});
  assert.match(left,/data-deployment-renderer="standard-explainable-ui"/);assert.match(right,/data-system-perspective="isometric"/);
  for(const html of [left,right]){
   for(const token of ['--fp-bg-primary:#152438','--fp-node-cursor:#dbaaff','--fp-node-visited:#8bcba3','--fp-border:#56738f','--fp-font-sans:Host Sans','--fp-node-shadow:none'])assert(html.includes(token),token);
   assert.doesNotMatch(html,/--fp-bg-primary:#(?:fff(?:fff)?|f9fafb)/,'no nested light preset overrides the custom dark palette');
  }
  assert.doesNotMatch(left,/run-native-step|adapter-step-card|data-unstyled="true"/,'the deployment pane uses standard styled EUI nodes');
 }finally{await rm(directory,{recursive:true,force:true});}
});
