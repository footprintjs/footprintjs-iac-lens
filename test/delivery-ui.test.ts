import assert from 'node:assert/strict';
import { mkdir,mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileGraph } from 'footprintjs-iac/graph';
import type { DashboardState } from '../src/core/types.ts';
import type { DeliveryView } from '../src/core/delivery.ts';

const compiled=await build({stdin:{contents:"export { SimpleDashboard } from './web/components/SimpleDashboard.tsx'; export { DeliveryDetails } from './web/components/DeliveryStrip.tsx';",
  resolveDir:import.meta.dirname+'/..',loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'});
const cache=join(import.meta.dirname,'../.artifacts');await mkdir(cache,{recursive:true});const directory=await mkdtemp(join(cache,'delivery-render-'));
let components;
try {const file=join(directory,'render.mjs');await writeFile(file,compiled.outputFiles[0]!.text);components=await import(pathToFileURL(file).href);}
finally {await rm(directory,{recursive:true,force:true});}
const graph=compileGraph({name:'delivery-system',resources:[
  {id:'identity-directory',provider:'fixture',spec:{role:'directory'}},{id:'identity-provider',provider:'fixture',spec:{role:'provider'}},
  {id:'neo-namespace',provider:'fixture',spec:{kind:'Namespace'}},{id:'neo-access-policy',provider:'fixture',spec:{kind:'ConfigMap'}},
  {id:'neo-app',provider:'fixture',spec:{kind:'Deployment'}},{id:'neo-service',provider:'fixture',spec:{kind:'Service'}},
],boundaries:[],memberships:[],relations:[]});
const view:DeliveryView={id:'configured',label:'Neo upgrade',buttonLabel:'Deploy from GitHub',repository:'https://github.com/example/neo',ref:'release-v2',
  executionId:null,status:'idle',stages:['resolve','fetch','build','publish','plan','deploy','verify'].map(id=>({id:id as DeliveryView['stages'][number]['id'],label:id,status:'pending'})),
  artifacts:[],changes:[],checks:[],recordings:[]};
const state=(delivery:DeliveryView):DashboardState=>({revision:1,busy:delivery.status==='running',mode:'managed',graph,delivery,target:{id:'owned',label:'Neo'},
  run:{id:'baseline',status:'passed',resources:graph.resources.map(resource=>({id:resource.id,status:'ready'})),events:[]}});
const noop=()=>{};
const render=(delivery:DeliveryView)=>renderToStaticMarkup(createElement(components.SimpleDashboard,{state:state(delivery),posting:false,onRun:noop,onResourceFlow:noop,onDelivery:noop,onDismissError:noop,onDetails:noop}));
test('manual delivery keeps the existing six-resource canvas while native delivery phases advance',()=>{
  const idle=render(view);assert.equal((idle.match(/>Deploy from GitHub</g)??[]).length,1);assert.doesNotMatch(idle,/>Build system</);
  assert.match(idle,/example\/neo · release-v2/);assert.match(idle,/Recorded delivery stages/);
  const running={...view,status:'running' as const,executionId:'native-delivery',source:{commit:'c'.repeat(40),tree:'d'.repeat(40)},
    stages:view.stages.map((stage,index)=>({...stage,status:index===0?'passed' as const:index===1?'running' as const:'pending' as const}))};
  const html=render(running);assert.match(html,/Get code: running/);assert.match(html,/Build: pending/);
  assert.equal((html.match(/class="simple-object object-ready/g)??[]).length,6);
  assert.match(html,/6<span> \/ 6 ready/);assert.match(html,/Your system being built/);
  assert.match(html,/cccccccc/);assert.doesNotMatch(html,/Program: Building|Program: Waiting/);
});
test('completed delivery is visibly final and details retain identities, affected counts and checks',()=>{
  const completed:DeliveryView={...view,status:'passed',executionId:'native-delivery',source:{commit:'c'.repeat(40),tree:'d'.repeat(40)},
    stages:view.stages.map(stage=>({...stage,status:'passed'})),changes:[{resourceId:'neo-app',action:'update'},{resourceId:'identity-directory',action:'noop'}],
    artifacts:[{id:'node',digest:'e'.repeat(64),reference:'registry.example/neo@sha256:'+'e'.repeat(64)}],checks:[{id:'real-login',passed:true}],recordings:[{runId:'native-delivery',status:'passed'}]};
  const html=render(completed);assert.match(html,/>Deployed</);assert.doesNotMatch(html,/>Deploy from GitHub</);assert.match(html,/Update verified/);assert.match(html,/1 affected · 1 unchanged/);
  assert.match(html,/disabled=""[^>]*>.*?Deployed/s);
  const details=renderToStaticMarkup(createElement(components.DeliveryDetails,{view:completed}));
  assert.match(details,new RegExp('c'.repeat(40)));assert.match(details,/real-login: Passed/);assert.match(details,/native-delivery/);assert.match(details,/identity-directory/);
});
