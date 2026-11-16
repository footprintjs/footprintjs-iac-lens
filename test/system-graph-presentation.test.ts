import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {ONBOARDING_STAGE_IDS,ONBOARDING_STAGE_LABELS} from 'footprintjs-iac/onboarding';
import type {BuildScene} from '../src/core/build-scene.ts';
import type {DashboardState} from '../src/core/types.ts';
import type {OnboardingSnapshot} from '../src/core/onboarding.ts';
import {buildSceneGeometry} from '../web/components/build-scene-geometry.ts';

const compiled=await build({stdin:{contents:"export {BuildScene} from './web/components/BuildScene.tsx';export {default as OnboardingPanel} from './web/features/onboarding/OnboardingPanel.tsx';",resolveDir:join(import.meta.dirname,'..'),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'});
const cache=join(import.meta.dirname,'../.artifacts');await mkdir(cache,{recursive:true});const directory=await mkdtemp(join(cache,'system-graph-presentation-'));let components:{BuildScene:import('react').ComponentType<any>;OnboardingPanel:import('react').ComponentType<any>};
try{const path=join(directory,'render.mjs');await writeFile(path,compiled.outputFiles[0]!.text);components=await import(pathToFileURL(path).href);}finally{await rm(directory,{recursive:true,force:true});}
function scene():BuildScene{return{phase:'ready',headline:'Ready',simulation:false,nodes:[{id:'be',title:'Neo backend',kind:'compute',status:'ready',column:0,row:0,embedded:[],uncertain:false}],edges:[],flowEdges:[],counts:{ready:1,total:1},activeIds:[],warnings:[]};}
function onboarding():OnboardingSnapshot{return{id:'registered',label:'App',strategyId:'systemd',targetId:'server',configurationDigest:'a'.repeat(64),status:'ready',busy:false,stages:ONBOARDING_STAGE_IDS.map(id=>({id,label:ONBOARDING_STAGE_LABELS[id],status:'passed'})),checks:[{id:'login',label:'Sign in',status:'passed'}],deployment:{ok:true,promoted:true,status:'promoted',checks:[{id:'login',label:'Sign in',status:'passed'}]},canDiscover:true,canConfigure:true,canVerify:true,canReview:true,canDeploy:false,canReconcile:false};}
function renderOnboarding(view:OnboardingSnapshot,technical=false){const state:DashboardState={revision:1,graph:null,busy:view.busy,mode:'managed',onboarding:view};return renderToStaticMarkup(createElement(components.OnboardingPanel,{state,posting:false,technical,onAction:()=>{}}));}

test('small native graphs keep fixed-size HTML node labels outside the SVG coordinate space',()=>{
 const html=renderToStaticMarkup(createElement(components.BuildScene,{scene:scene(),execution:'passed'}));
 assert.doesNotMatch(html,/<foreignObject/);assert.match(html,/data-component-id="be"/);assert.match(html,/Compute · Neo backend: Ready/);assert.match(html,/class="simple-category category-compute">Compute/);
 const close=html.indexOf('</svg>');assert(close>0);assert(!html.slice(0,close).includes('data-component-id'));assert(html.indexOf('data-component-id')>close);
 assert.match(html,/role="region" aria-label="Build flow and live connections" tabindex="0"/);
});
test('layout preserves native column and row positions without a large sparse-graph scaling floor',()=>{
 const input=scene(),one=buildSceneGeometry(input);assert(one.width<500);assert(one.height<300);
 input.nodes.push({...input.nodes[0]!,id:'other',kind:'storage',column:0,row:1});input.nodes.push({...input.nodes[0]!,id:'next',column:1,row:0});const graph=buildSceneGeometry(input);
 assert.equal(graph.locations.get('be')!.x,graph.locations.get('other')!.x);assert(graph.locations.get('other')!.y>graph.locations.get('be')!.y);assert(graph.locations.get('next')!.x>graph.locations.get('be')!.x);
});
test('missing native progress remains unconfirmed rather than animating an active component',()=>{
 const input=scene();input.nodes[0]={...input.nodes[0]!,status:'deploying',uncertain:true};const html=renderToStaticMarkup(createElement(components.BuildScene,{scene:input,execution:'running'}));assert.match(html,/Neo backend: Unconfirmed/);assert.doesNotMatch(html,/simple-node-card[^\"]*object-active/);assert.match(html,/bg-compute bg-pending/);
});
test('completed setup folds measured check details by default and keeps their native IDs available',()=>{
 const html=renderOnboarding(onboarding());assert.match(html,/<details class="onboarding-completed-progress">/);assert.doesNotMatch(html,/<details[^>]*open=/);assert.match(html,/5 steps completed · 1 recorded check/);assert.match(html,/data-check-id="login"/);assert.match(html,/Your app is ready/);
 assert.doesNotMatch(renderOnboarding(onboarding(),true),/<details class="onboarding-completed-progress"/);
});
test('an active or failed setup never hides its current stage inside completed progress',()=>{
 const view=onboarding();view.status='failed';view.deployment={ok:false,promoted:false,status:'verification-failed'};view.stages=view.stages.map(row=>row.id==='verify'?{...row,status:'unknown'}:row);view.checks=[{id:'connection',label:'Connection',status:'unknown'}];const failed=renderOnboarding(view);assert.doesNotMatch(failed,/<details class="onboarding-completed-progress"/);assert.match(failed,/Not confirmed/);assert.doesNotMatch(failed,/Your app is ready/);
 view.busy=true;view.status='configured';view.stages=view.stages.map(row=>row.id==='verify'?{...row,status:'running'}:row);assert.doesNotMatch(renderOnboarding(view),/<details class="onboarding-completed-progress"/);
});
