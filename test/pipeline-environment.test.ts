import assert from 'node:assert/strict';
import test from 'node:test';
import { compileGraph } from 'footprintjs-iac/graph';
import type { IdentityTarget } from 'footprintjs-iac/integration/identity';
import type { NeoDeliveryBaseline,NeoDeliveryObservation } from 'footprintjs-iac/integration/identity/github-delivery';
import { createNeoEnvironmentProjection } from '../examples/neo-release-pipeline/environment-projection.ts';
import { readDashboardState } from '../src/core/client.ts';
const graph=(name:string)=>compileGraph({name,resources:[{id:'program',provider:'fixture',spec:{}}],boundaries:[],memberships:[],relations:[]});
const target=(id:string,neoPort:number)=>({id,namespace:id+'-namespace',context:'kind-'+id,neoPort}) as IdentityTarget;
const baseline=(name:string)=>({graph:graph(name),events:[],result:{}}) as unknown as NeoDeliveryBaseline;
const event=(baseline:NeoDeliveryBaseline,id:string):NeoDeliveryObservation=>({kind:'deployment',graph:baseline.graph,snapshot:{version:1,runId:id,resources:{program:{resourceId:'program',status:'ready'}},events:[],sequence:1,ignoredEvents:0,subscriberFailures:0}} as unknown as NeoDeliveryObservation);
test('later environment observations publish matching target, system view, URL and independent native check scope',async()=>{
  const dev=baseline('dev-system'),gamma=baseline('gamma-system');
  const project=createNeoEnvironmentProjection([{id:'dev',label:'Development',target:target('dev',15000),baseline:dev},{id:'gamma',label:'Gamma',target:target('gamma',15001),baseline:gamma}],async baseline=>({id:baseline.graph.name+'-baseline',status:'passed',mode:'kubernetes',resources:[{id:'program',status:'ready'}],events:[]}));
  const d=await project(event(dev,'dev-run'));const g=await project(event(gamma,'gamma-run'));
  assert.equal(d.target?.context,'kind-dev');assert.equal(g.target?.context,'kind-gamma');assert.equal(g.target?.namespace,'gamma-namespace');assert.equal(g.target?.label,'Gamma');assert.equal(g.neoUrl,'http://127.0.0.1:15001/?test');assert.equal(g.run?.id,'gamma-run');
  assert.ok(JSON.stringify(g.systemView).includes('gamma-namespace'));assert.equal(JSON.stringify(g.systemView).includes('dev-namespace'),false);assert.ok(g.identity?.checks.every(check=>check.status==='untested'));assert.equal(g.connections?.status,'idle');
  const back=await project(event(dev,'dev-later'));assert.equal(back.target?.context,'kind-dev');assert.equal(back.run?.id,'dev-later');assert.equal(back.neoUrl,'http://127.0.0.1:15000/?test');
  await assert.rejects(()=>project(event(baseline('foreign-system'),'foreign')),/outside its registered environment/);
});
test('publication target metadata admits only safe host labels, not executable or arbitrary extra target controls',()=>{
  assert.throws(()=>readDashboardState({revision:1,busy:false,graph:null,target:{id:'owned',command:'unsafe'}}));
  assert.throws(()=>readDashboardState({revision:1,busy:false,graph:null,target:{context:'line\nbreak'}}));
  assert.equal(readDashboardState({revision:1,busy:false,graph:null,target:{id:'owned',context:'kind-local',namespace:'owned'}}).target?.namespace,'owned');
});
