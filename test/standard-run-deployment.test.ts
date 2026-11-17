import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {FootprintTheme,TracedFlow,filterGraphForDrill,buildSubflowBreadcrumb,type TraceGraph} from 'footprint-explainable-ui/flowchart';
import type {AdapterDeploymentResource,AdapterDeploymentStage,AdapterDeploymentStatus} from '../src/core/adapter-deployment.ts';
import {createRunDeploymentGraph} from '../web/features/runs/create-run-deployment-graph.ts';

const root='execute-services',child=root+'/verify',nested=child+'/tools';
function resource():AdapterDeploymentResource {
 const stage=(id:string,status:AdapterDeploymentStatus,scope=root,kind:AdapterDeploymentStage['kind']='stage'):AdapterDeploymentStage=>({
  id:scope+'/'+id,stageId:id,label:id,kind,scope,resourceId:'services',status,
  runtimeStageIds:['completed','running','failed'].includes(status)?[`${scope}/${id}#2`]:[],executions:['completed','running','failed'].includes(status)?1:0,column:0,row:0,
 });
 const verify={...stage('verify','pending',root,'subflow'),childScope:child};
 const tools={...stage('tools','pending',child,'subflow'),childScope:nested};
 return{resourceId:'services',label:'Services',action:'update',rootScope:root,adapterScope:child,
  scopes:[{id:root,label:'Services'},{id:child,label:'Verify services',parentScope:root,mountStageId:child},{id:nested,label:'Tools',parentScope:child,mountStageId:nested}],
  stages:[stage('admit','completed'),stage('gate','completed',root,'decision'),stage('change','running'),stage('leave','skipped'),verify,stage('failure','failed'),stage('unknown','unknown'),stage('inspect','pending',child),tools,stage('ping','pending',nested)],
  edges:[{id:'admit-gate',source:root+'/admit',target:root+'/gate',kind:'next'},
   {id:'chosen',source:root+'/gate',target:root+'/change',kind:'branch',selected:true,label:'Change'},
   {id:'excluded',source:root+'/gate',target:root+'/leave',kind:'branch',selected:false,label:'Leave unchanged'},
   {id:'change-verify',source:root+'/change',target:child,kind:'next'},
   {id:'leave-verify',source:root+'/leave',target:child,kind:'next'},
   {id:'retry-loop',source:root+'/change',target:root+'/gate',kind:'loop'},
   {id:'inspect-tools',source:child+'/inspect',target:nested,kind:'next'}],
 };
}

test('the standard adapter keeps the complete native graph and gives drill ownership to EUI',()=>{
 const input=resource(),before=structuredClone(input),graph=createRunDeploymentGraph(input);
 assert.deepEqual(graph.nodes.map(node=>node.id),input.stages.map(stage=>stage.id));
 assert.deepEqual(graph.edges.map(edge=>edge.id),input.edges.map(edge=>edge.id));
 assert(graph.nodes.every(node=>node.type==='stageNode'),'uses the built-in standard renderer rather than custom card types');
 assert(graph.nodes.every(node=>node.width===undefined&&node.height===undefined&&node.handles===undefined),'geometry remains with the measured EUI layout');
 assert.equal(filterGraphForDrill(graph,null).nodes.length,7);
 assert.deepEqual(filterGraphForDrill(graph,child).nodes.map(node=>node.id),[child+'/inspect',nested]);
 assert.deepEqual(filterGraphForDrill(graph,nested).nodes.map(node=>node.id),[nested+'/ping']);
 assert.deepEqual(buildSubflowBreadcrumb(graph,nested).map(entry=>[entry.subflowId,entry.label]),[[null,'Chart'],[child,'verify'],[nested,'tools']]);
 assert.equal(graph.nodes.find(node=>node.id===child)!.data.subflowOf,undefined);
 assert.equal(graph.nodes.find(node=>node.id===nested)!.data.subflowOf,child);
 assert.equal(graph.nodes.find(node=>node.id===nested)!.data.subflowId,nested);
 assert.deepEqual(input,before);
});

test('native states never manufacture a cursor order, retry attempt count or future completion',()=>{
 const input=resource();input.stages.find(stage=>stage.stageId==='change')!.executions=2;
 input.stages.find(stage=>stage.stageId==='change')!.runtimeStageIds.push(root+'/change#3');
 const graph=createRunDeploymentGraph(input);
 for(const stage of input.stages){
  const node=graph.nodes.find(node=>node.id===stage.id)!;
  assert.equal(node.data.active,stage.status==='running');assert.equal(node.data.done,stage.status==='completed');assert.equal(node.data.error,stage.status==='failed');
  assert.equal(node.data.nativeStatus,stage.status);assert.equal(node.data.stage,stage);
  assert.equal(node.data.stepNumbers,undefined);assert.equal(node.data.retryAttempts,undefined);
 }
 assert.equal(graph.nodes.find(node=>node.id===root+'/leave')!.data.description,'Skipped');
 assert.equal(graph.nodes.find(node=>node.id===root+'/unknown')!.data.description,'Unconfirmed');
 assert.equal(graph.nodes.find(node=>node.id===child)!.data.done,false,'a declared subflow is not an observed completion');
 const pending={...input,stages:input.stages.map(stage=>({...stage,status:'pending' as const,executions:0,runtimeStageIds:[]}))};
 assert(createRunDeploymentGraph(pending).nodes.every(node=>!node.data.active&&!node.data.done&&!node.data.error));
});

test('branches and loops keep native identity without making loop-back links structural prerequisites',()=>{
 const input=resource(),graph=createRunDeploymentGraph(input),gate=graph.nodes.find(node=>node.id===root+'/gate')!;
 assert.deepEqual(gate.data.prevIds,[root+'/admit']);
 assert.deepEqual(gate.data.nextIds,[root+'/change',root+'/leave']);
 assert.equal(graph.edges.find(edge=>edge.id==='retry-loop')!.data?.kind,'loop');
 assert.equal(graph.edges.find(edge=>edge.id==='chosen')!.data?.kind,'decision-branch');
 assert.equal(graph.edges.find(edge=>edge.id==='chosen')!.data?.selected,true);
 assert.equal(graph.edges.find(edge=>edge.id==='excluded')!.data?.selected,false);
 assert.match(graph.edges.find(edge=>edge.id==='excluded')!.ariaLabel!,/recorded unselected branch/);
 const unobserved={...input,edges:input.edges.map(({selected:_selection,...edge})=>edge)};
 assert(createRunDeploymentGraph(unobserved).edges.every(edge=>!Object.hasOwn(edge.data!,'selected')));
});

test('only an admitted native fork supplies a fork shape; an old generic decision stays generic',()=>{
 const input=resource(),gate=input.stages.find(stage=>stage.stageId==='gate')!;
 assert.equal(createRunDeploymentGraph(input).nodes.find(node=>node.id===gate.id)!.data.isFork,false);
 gate.nativeKind='fork';
 const fork=createRunDeploymentGraph(input).nodes.find(node=>node.id===gate.id)!;
 assert.equal(fork.data.isFork,true);assert.equal(fork.data.isDecider,false);
 assert.equal(fork.data.nativeKind,'fork');
 gate.nativeKind='decider';assert.equal(createRunDeploymentGraph(input).nodes.find(node=>node.id===gate.id)!.data.isDecider,true);
});

test('fixed standard decision diamonds keep a concise label and preserve the complete recorded name',()=>{
 const input=resource(),gate=input.stages.find(stage=>stage.stageId==='gate')!;
 gate.label='Proceed to Write managed release markers';
 const node=createRunDeploymentGraph(input).nodes.find(node=>node.id===gate.id)!;
 assert(Array.from(node.data.label).length<=18);
 assert.equal(node.domAttributes?.title,gate.label);assert.match(node.ariaLabel!,/Proceed to Write managed release markers/);
 assert.equal((node.data.stage as AdapterDeploymentStage).label,gate.label);
});

test('the released standard StageNode path retains recorded status and supplied theme without a fabricated overlay',()=>{
 const input=resource(),graph=createRunDeploymentGraph(input);
 // Deterministic dimensions make the released canvas SSR-visible; product geometry remains EUI-measured.
 const visibleLayout=(value:TraceGraph):TraceGraph=>({...value,nodes:value.nodes.map((node,index)=>({...node,position:{x:0,y:index*90},width:240,height:80,initialWidth:240,initialHeight:80}))});
 const html=renderToStaticMarkup(createElement(FootprintTheme,{tokens:{colors:{bgPrimary:'#112233',textPrimary:'#fefefe',nodeCursor:'#aabbcc',onNodeCursor:'#010203',nodeVisited:'#ddeeff',onNodeVisited:'#020304'}},children:createElement(TracedFlow,{graph,layout:visibleLayout,currentSubflowId:null,background:false})}));
 assert.match(html,/data-fp="traced-flow"/);assert.match(html,/data-fp="stage-node"/);
 assert.match(html,/data-active="true"/);assert.match(html,/data-done="true"/);assert.match(html,/data-error="true"/);
 assert.match(html,/Skipped/);assert.match(html,/Unconfirmed/);assert.match(html,/--fp-bg-primary:#112233/);
 assert.match(html,/--fp-node-cursor:#aabbcc/);assert.match(html,/--fp-on-node-cursor:#010203/);assert.match(html,/--fp-node-visited:#ddeeff/);assert.match(html,/--fp-on-node-visited:#020304/);
 assert.doesNotMatch(html,/run-native-step|adapter-step-card/);
});
