import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileGraph} from 'footprintjs-iac/graph';
import type {ReleaseAutomationView,ReleaseAutomationAttemptView} from '../src/core/release-automation.ts';

const compiled=await build({stdin:{contents:"export { ReleaseAutomationPanel } from './web/components/ReleaseAutomationPanel.tsx'; export { SimpleDashboard } from './web/components/SimpleDashboard.tsx';",resolveDir:import.meta.dirname+'/..',loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'});
const cache=join(import.meta.dirname,'../.artifacts');await mkdir(cache,{recursive:true});const directory=await mkdtemp(join(cache,'release-render-'));let components;
try{const file=join(directory,'render.mjs');await writeFile(file,compiled.outputFiles[0]!.text);components=await import(pathToFileURL(file).href);}finally{await rm(directory,{recursive:true,force:true});}
const stages:ReleaseAutomationView['stages']=[{id:'dev',label:'Dev',promotion:'automatic',rollback:'disabled'},{id:'gamma',label:'Gamma',promotion:'manual',rollback:'manual'},{id:'prod',label:'Prod',promotion:'automatic',rollback:'automatic'}];
const view:ReleaseAutomationView={id:'neo-releases',label:'Neo releases',automatic:true,initialized:true,busy:false,discoveryStatus:'available',choices:[{id:'github-2',label:'Neo version two',version:'v2.0.0',commit:'a'.repeat(40)}],attempts:[],stages};
const noop=()=>{};
const render=(input:ReleaseAutomationView,technical=false)=>renderToStaticMarkup(createElement(components.ReleaseAutomationPanel,{view:input,disabled:input.busy,onAction:noop,compact:true,technical}));
function attempt(status:ReleaseAutomationAttemptView['status']):ReleaseAutomationAttemptView {
  return{id:'attempt-2',releaseId:'github-2',label:'Neo version two',version:'v2.0.0',commit:'a'.repeat(40),trigger:'automatic',status,
    build:['resolve','fetch','build','publish'].map(id=>({id,label:id,status:'passed'})),pipeline:{id:'execution-2',status:'awaiting-promotion',releaseId:'github-2',releaseDigest:'b'.repeat(64),
      stages:stages.map((stage,index)=>({id:stage.id,label:stage.label,strategyId:'direct',status:index===0?'passed':index===1?'awaiting-promotion':'pending',steps:index===0?[{id:'deploy',label:'Update application',status:'passed'}]:[],checks:index===0?[{id:'access',passed:true,status:'passed'}]:[],changes:index===0?[{resourceId:'neo-app',action:'update'}]:[],recovery:stage.rollback==='disabled'?'disabled':'unavailable',canPromote:index===1,canRecover:false})),recordings:[{runId:'native-dev',stageId:'dev',kind:'rollout',status:'passed'}],events:[{sequence:1,stageId:'dev',label:'Update verified',phase:'outcome',status:'passed',timestamp:1}]}};
}

test('one idle release chart shows four pending build steps and all three pending environments without inventing execution',()=>{
  const html=render(view);assert.equal((html.match(/release-build-pending/g)??[]).length,4);assert.equal((html.match(/pipeline-state-pending/g)??[]).length,3);
  assert.match(html,/No completed recording yet/);assert.match(html,/One build/);assert.match(html,/Ready for a release/);assert.match(html,/Neo version two/);
  assert.doesNotMatch(html,/Deployment complete|Update verified|a{40}|v2\.0\.0|command|textarea|type="url"/);assert.equal((html.match(/>Deploy version<\/button>/g)??[]).length,1);
  const details=render(view,true);assert.match(details,/v2\.0\.0/);assert.match(details,/Preflight runs before each environment changes/);
});

test('only actual build progress changes its step; environment readiness waits for its own recorded deployment',()=>{
  const building=structuredClone(view),active=attempt('preparing');delete active.pipeline;active.build[2]!.status='running';active.build[3]!.status='pending';building.attempts=[active];building.busy=true;
  const html=render(building);assert.equal((html.match(/release-build-running/g)??[]).length,1);assert.equal((html.match(/release-build-passed/g)??[]).length,2);assert.equal((html.match(/pipeline-state-pending/g)??[]).length,3);
  assert.match(html,/Building version/);assert.match(html,/Started by release watcher/);assert.match(html,/<button[^>]*disabled=""[^>]*>Working…/);assert.doesNotMatch(html,/Deployment complete|Update verified/);
});

test('manual gamma promotion is explicit and an already attempted or unavailable release cannot start a second deployment',()=>{
  const waiting=structuredClone(view);waiting.attempts=[attempt('waiting')];const html=render(waiting);
  assert.match(html,/Dev/);assert.match(html,/1 resource changed/);assert.match(html,/1\/1 checks passed/);assert.match(html,/>Deploy to Gamma<\/button>/);assert.doesNotMatch(html,/>Deploy to Prod<\/button>/);
  assert.match(html,/<button[^>]*disabled=""[^>]*>Version handled/,'existing attempt must not invite a duplicate deployment');
  const unavailable=structuredClone(view);unavailable.discoveryStatus='unavailable';assert.match(render(unavailable),/<button[^>]*disabled=""[^>]*>Deploy version/);
  const unresolved=structuredClone(view);unresolved.attempts=[attempt('incomplete')];unresolved.choices.unshift({id:'github-3',label:'Neo version three'});assert.match(render(unresolved),/<button[^>]*disabled=""[^>]*>Deploy version/,'new releases wait while an earlier outcome is uncertain');
});

test('Simple dashboard retains the running system and exposes one release entry point without simulator or duplicate build controls',()=>{
  const graph=compileGraph({name:'existing-neo',resources:[{id:'neo-app',provider:'fixture',spec:{}}],boundaries:[],memberships:[],relations:[]});
  const state={revision:1,graph,mode:'managed',busy:false,scenarios:[],target:{id:'dev',label:'Neo environments'},releaseAutomation:view,
    run:{id:'existing-run',status:'passed',mode:'managed',resources:[{id:'neo-app',status:'ready'}],events:[]}};
  const html=renderToStaticMarkup(createElement(components.SimpleDashboard,{state,posting:false,onRun:noop,onResourceFlow:noop,onReleaseAutomation:noop,onDismissError:noop,onDetails:noop,neoUrl:'http://127.0.0.1:12345/?test'}));
  assert.match(html,/has-release-automation/);assert.match(html,/Open Neo/);assert.match(html,/Release deployment/);assert.equal((html.match(/>Deploy version<\/button>/g)??[]).length,1);
  assert.doesNotMatch(html,/>Build system<|Simulation · no infrastructure is changed|Run simulation|Choose a demo/);
});
