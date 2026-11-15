import assert from 'node:assert/strict';
import { mkdir,mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { pipelineCatalog } from '../examples/pipeline-strategies/catalog.ts';
import { defaultPipelineSelection, type PipelineView } from '../src/core/pipeline.ts';
const compiled=await build({stdin:{contents:"export { PipelinePanel } from './web/components/PipelinePanel.tsx'; export { PipelineConfiguration } from './web/components/PipelineConfiguration.tsx'; export { SimpleDashboard } from './web/components/SimpleDashboard.tsx';",resolveDir:import.meta.dirname+'/..',loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'});
const cache=join(import.meta.dirname,'../.artifacts');await mkdir(cache,{recursive:true});const directory=await mkdtemp(join(cache,'pipeline-render-'));let components;
try{const file=join(directory,'render.mjs');await writeFile(file,compiled.outputFiles[0]!.text);components=await import(pathToFileURL(file).href);}finally{await rm(directory,{recursive:true,force:true});}
const catalog=pipelineCatalog([{kind:'release-manifest',schemaVersion:1,id:'candidate',label:'Candidate',source:{repository:'https://github.com/example/app',ref:'v2',commit:'a'.repeat(40),tree:'b'.repeat(40)},recipe:{id:'recipe',digest:'c'.repeat(64)},artifacts:[],digest:'d'.repeat(64)}]);
const view:PipelineView={catalog,busy:false};const noop=()=>{};
test('Simple pipeline labels simulation, separates pure preview from actual records and disables start before preview',()=>{
  const html=renderToStaticMarkup(createElement(components.PipelinePanel,{view,disabled:false,onAction:noop}));
  assert.match(html,/Simulation · no infrastructure is changed/);assert.match(html,/Configuration preview/);assert.match(html,/No deployment effects/);assert.match(html,/Recorded deployment/);assert.match(html,/No completed recording yet/);assert.match(html,/<button[^>]*disabled=""[^>]*>Start deployment/);assert.equal((html.match(/Not started/g)??[]).length,3);
});
test('configuration offers registered generic strategies and capability policies without accepting arbitrary URLs or commands',()=>{
  const html=renderToStaticMarkup(createElement(components.PipelineConfiguration,{catalog,selection:defaultPipelineSelection(catalog),disabled:false,onChange:noop}));
  assert.match(html,/Registered custom strategy/);assert.match(html,/Gradual traffic/);assert.match(html,/explicit approval/);assert.match(html,/Restore previous verified version manually/);assert.doesNotMatch(html,/type="(?:password|url)"/);assert.doesNotMatch(html,/textarea|command|repository/i);
});
test('actual native failed steps and manual recovery stay visible rather than changing preview into a successful run',()=>{
  const failed:PipelineView={...view,execution:{id:'execution',status:'awaiting-recovery',releaseId:'candidate',releaseDigest:'d'.repeat(64),stages:catalog.stages.map((definition,index)=>({id:definition.id,label:definition.label,strategyId:'direct',status:index===0?'passed':index===1?'failed':'pending',steps:index===1?[{id:'acceptance-0',label:'Check',status:'failed'}]:[],checks:index===1?[{id:'health',passed:false,status:'failed'}]:[],changes:[],recovery:index===0?'disabled':'available',canPromote:false,canRecover:index===1})),recordings:[{runId:'native-failed',stageId:'gamma',kind:'rollout',status:'failed'}],events:[{sequence:1,stageId:'gamma',label:'Needs attention',phase:'acceptance-0',status:'failed',timestamp:1}]}};
  const html=renderToStaticMarkup(createElement(components.PipelinePanel,{view:failed,disabled:false,onAction:noop}));
  assert.match(html,/Restore previous version/);assert.match(html,/A recorded step failed/);assert.match(html,/Needs attention/);assert.match(html,/0\/1 checks passed/);assert.doesNotMatch(html,/Deploy to Production/);
});
test('Simple keeps the current system compact and uses human version labels while Details retains technical metadata',()=>{
  const plain=structuredClone(view);plain.catalog.simulation=false;plain.catalog.releases[0]!.version='demo/long-technical-release-branch';plain.catalog.stages=plain.catalog.stages.slice(0,1);
  const html=renderToStaticMarkup(createElement(components.PipelinePanel,{view:plain,disabled:false,onAction:noop,compact:true}));
  assert.match(html,/pipeline-compact/);assert.match(html,/Choose a version to deploy/);assert.match(html,/>Candidate<\/option>/);assert.match(html,/grid-template-columns:repeat\(1,/);
  assert.doesNotMatch(html,/long-technical-release-branch|Host-configured deployment| · Prepared|Configuration preview/);
  const details=renderToStaticMarkup(createElement(components.PipelinePanel,{view:plain,disabled:false,onAction:noop,technical:true}));
  assert.match(details,/long-technical-release-branch/);assert.match(details,/Host-configured deployment/);assert.match(details,/Configuration preview/);
});
