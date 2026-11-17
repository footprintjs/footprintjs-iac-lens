import assert from 'node:assert/strict';
import test from 'node:test';
import {tokensToCSSVars} from 'footprint-explainable-ui';
import type {TopologyConnectionView} from 'footprintjs-iac/system-topology';
import type {DashboardState} from '../src/core/types.ts';
import {connectionColour,connectionColours} from '../web/features/system-topology/connection-colours.ts';
import {buildDeploymentFlowView} from '../web/lib/deployment-flow-view.ts';

test('categorical connection paints follow the current theme without changing edge identity or measured outcomes',()=>{
 const connections:TopologyConnectionView[]=['signin','data','health','tools','sessions','fleet'].map(id=>({id,from:'app',to:id,kind:'communicatesWith',status:'connected',evidence:[]}));
 const before=structuredClone(connections),colours=connectionColours(connections);
 assert.deepEqual([...connectionColours([...connections].reverse())],[...colours]);
 assert.equal(new Set(colours.values()).size,connections.length);
 const variables=tokensToCSSVars({colors:{chip1:'#123456',chip2:'#234567',chip3:'#345678',chip4:'#456789',tracing:'#56789a',accent:'#6789ab',error:'#ab1234',warning:'#ab8912',textMuted:'#778899'}});
 for(const edge of connections){
  const paint=connectionColour(edge,colours),name=/var\((--fp-[^,]+)/.exec(paint)?.[1];
  assert(name&&variables[name],`${edge.id} uses a token emitted by the installed package`);
 }
 const failed={...connections[0]!,status:'failed' as const},checking={...failed,status:'checking' as const},unknown={...failed,status:'unknown' as const};
 assert.match(connectionColour(failed,colours),/--fp-color-error/);
 assert.match(connectionColour(checking,colours),/--fp-color-warning/);
 assert.match(connectionColour(unknown,colours),/--fp-text-muted/);
 assert.deepEqual(connections,before,'a palette never changes recorded connection state');
});

test('deployment arrows and heads use the same semantic theme role while native geometry and evidence stay unchanged',()=>{
 const input:DashboardState={revision:1,busy:true,graph:{version:1,kind:'infra-graph',name:'theme-check',digest:'a'.repeat(64),boundaries:[],memberships:[],relations:[],resources:[{id:'data',provider:'fixture',spec:{}},{id:'app',provider:'fixture',dependsOn:['data'],spec:{kind:'Deployment'}}]},run:{id:'native-run',status:'running',resources:[{id:'data',status:'ready'},{id:'app',status:'deploying'}],events:[
  {resourceId:'data',status:'deploying',sequence:1,runtimeStageId:'data#1',timestamp:1000},
  {resourceId:'data',status:'ready',sequence:2,runtimeStageId:'data#1',timestamp:1100},
  {resourceId:'app',status:'deploying',sequence:3,runtimeStageId:'app#1',timestamp:1200},
 ]}};
 const before=structuredClone(input),active=buildDeploymentFlowView(input),edge=active.edges.find(edge=>edge.target==='app')!;
 assert(edge);assert.match(String(edge.style?.stroke),/--fp-color-primary/);
 assert.equal((edge.markerEnd as {color:string}).color,edge.style?.stroke);
 assert(!/\s/.test((edge.markerEnd as {color:string}).color),'ReactFlow includes marker paint in the SVG id');
 assert.deepEqual(input,before);
 input.run!.resources[1]!.status='failed';input.run!.events.push({resourceId:'app',status:'failed',sequence:4,runtimeStageId:'app#1',timestamp:1300});
 const failed=buildDeploymentFlowView(input),failedEdge=failed.edges.find(edge=>edge.target==='app')!;
 assert.match(String(failedEdge.style?.stroke),/--fp-color-error/);
 assert.equal((failedEdge.markerEnd as {color:string}).color,failedEdge.style?.stroke);
 assert.deepEqual(failed.nodes.map(node=>[node.id,node.position]),active.nodes.map(node=>[node.id,node.position]));
 assert.equal(failed.flow.nodes.find(node=>node.id==='app')?.progress.status,'failed');
});
