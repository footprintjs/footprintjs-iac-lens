import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {TopologyNodeAction,TopologyNodeView} from 'footprintjs-iac/system-topology';
import {recordedWork,recordedWorkLabels} from '../web/features/system-topology/recorded-work.ts';

function action(id:string,status:TopologyNodeAction['status']='running',complete=false,componentId?:string):TopologyNodeAction {
 return{resourceId:'services',phase:'configure',status,...componentId?{componentId}:{},scope:componentId?'component':'shared-resource',label:'Updating configuration',
  evidence:{kind:'adapter',runId:'native-one',runtimeStageId:id,complete}};
}

test('one native instance is counted once while its shared and component channels settle',()=>{
 const shared=action('provider/configure#1'),component=action('provider/configure#1','passed',false,'backend');
 let work=recordedWork([component,shared]);
 assert.equal(work.count,1);assert.equal(work.runningCount,1);assert.equal(work.current!.state,'running');
 work=recordedWork([component,{...shared,status:'passed'}]);
 assert.equal(work.count,1);assert.equal(work.current!.state,'observed');assert.equal(work.observedCount,1);assert.equal(work.confirmedCount,0);
 assert.equal(recordedWorkLabels[work.current!.state],'Observed');
 work=recordedWork([{...component,evidence:{...component.evidence,complete:true}},{...shared,status:'passed',evidence:{...shared.evidence,complete:true}}]);
 assert.equal(work.current!.state,'confirmed');assert.equal(work.confirmedCount,1);
 assert.equal(recordedWork([shared,{...shared,status:'passed'}]).current!.state,'observed','the latest row replaces only the same channel');
});

test('distinct resources and repeated native attempts stay distinct without a guessed denominator',()=>{
 const rows=[action('phase#1','passed'),action('phase#2'),{...action('phase#1','passed'),resourceId:'other'}];
 const before=structuredClone(rows),work=recordedWork(rows);
 assert.equal(work.count,3);assert.equal(work.visibleSteps.length,3);assert.equal(work.runningCount,1);
 assert.equal(work.current!.action.evidence.runtimeStageId,'phase#2');assert.equal(work.observedCount,2);
 assert.equal(Object.hasOwn(work,'total'),false);assert.equal(Object.hasOwn(work,'percent'),false);assert.deepEqual(rows,before);
});

test('failure and uncertainty cannot be painted as confirmed by a neighbouring passed channel',()=>{
 for(const [status,state] of [['failed','failed'],['unknown','unknown']] as const){
  const work=recordedWork([action('phase#1','passed',true,'backend'),action('phase#1',status)]);
  assert.equal(work.count,1);assert.equal(work.current!.state,state);assert.equal(work.confirmedCount,0);
 }
 const work=recordedWork([action('failed#1','failed'),action('next#2')]);
 assert.equal(work.failedCount,1);assert.equal(work.current!.state,'running');assert.equal(work.visibleSteps[0]!.state,'failed');
});

test('a bounded meter retains the complete observed count while showing only eight actual recent instances',()=>{
 const work=recordedWork(Array.from({length:12},(_,index)=>action('step#'+index,'passed',index<2)));
 assert.equal(work.count,12);assert.equal(work.visibleSteps.length,8);assert.equal(work.omitted,4);
 assert.equal(work.visibleSteps[0]!.action.evidence.runtimeStageId,'step#4');
 assert.equal(work.observedCount,10);assert.equal(work.confirmedCount,2);
 assert.equal(recordedWork().count,0);assert.deepEqual(recordedWork().visibleSteps,[]);
 const unbound=action('');assert.equal(recordedWork([unbound]).count,0,'missing native identity cannot establish recorded work');
});

const root=join(import.meta.dirname,'..');
const compiled=await build({stdin:{contents:"export {TopologyNodeCard} from './web/features/system-topology/TopologyNodeCard.tsx';",resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic',logLevel:'silent'});
await mkdir(join(root,'.artifacts'),{recursive:true});
const directory=await mkdtemp(join(root,'.artifacts/recorded-work-'));
let Card:import('react').ComponentType<any>;
try{const file=join(directory,'render.mjs');await writeFile(file,compiled.outputFiles[0]!.text);({TopologyNodeCard:Card}=await import(pathToFileURL(file).href));}
finally{await rm(directory,{recursive:true,force:true});}
function node(actions:readonly TopologyNodeAction[]=[]):TopologyNodeView {
 return{id:'backend',label:'Neo backend',category:'compute',origin:'existing',originLabel:'Existing',bindings:{resourceIds:['services'],componentIds:['backend']},
  technology:{id:'nodejs',label:'Node.js'},status:'checking',statusLabel:'Checking',facts:{installed:'confirmed',running:'unknown',connected:'unknown'},evidenceScope:'component',
  progress:{completed:0,total:2,indeterminate:true},actions,evidence:[],limitations:[]};
}
const render=(value:TopologyNodeView)=>renderToStaticMarkup(createElement(Card,{node:value,box:{id:value.id,kind:'node',x:0,y:0,width:184,height:104,depth:1}}));

test('work becomes visible before final verification without claiming a database was created or changing Existing',()=>{
 const value=node([action('configure#1','passed'),action('restart#2')]),before=structuredClone(value),html=render(value);
 assert.match(html,/data-recorded-work-count="2"/);assert.match(html,/data-recorded-work-observed="1"/);
 assert.match(html,/2 steps recorded/);assert.match(html,/Updating configuration/);
 assert.match(html,/Updating configuration: Observed/);assert.match(html,/Updating configuration: In progress/);
 assert.match(html,/Neo backend: 0 of 2 checks verified/);assert.match(html,/aria-valuenow="0"/);
 assert.match(html,/data-origin="existing"/);assert.match(html,/>Existing<\/span>/);
 assert.doesNotMatch(html,/Updating configuration: Confirmed|100%|Creating database/);
 assert.deepEqual(value,before);
});

test('a component without native actions has no work meter and retains only its measured verification',()=>{
 const value={...node(),id:'database',label:'Database',category:'storage' as const,status:'pending' as const,statusLabel:'Waiting',actions:[]};
 const html=render(value);
 assert.doesNotMatch(html,/data-recorded-work-count|topology-recorded-work-dots|steps recorded/);
 assert.match(html,/Database: 0 of 2 checks verified/);assert.match(html,/>Waiting<\/span>/);assert.match(html,/data-origin="existing"/);
});
