import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileGraph} from 'footprintjs-iac/graph';
import type {DashboardState} from '../src/core/types.ts';
import type {RunCatalog,RunRecord,RunSummary} from '../src/core/run-history.ts';
import {isCurrentRun,momentText,orderedRuns,recordedFrame,runAppLink,runStatusText,runTimeText} from '../web/features/runs/model.ts';

const root=join(import.meta.dirname,'..');
const built=await build({stdin:{contents:"export {RunHome} from './web/features/runs/RunHome.tsx';export {RunPlayer} from './web/features/runs/RunPlayer.tsx';export {RunTimeline} from './web/features/runs/RunTimeline.tsx'",resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'esm',platform:'node',packages:'external',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'});
await mkdir(join(root,'.artifacts'),{recursive:true});const directory=await mkdtemp(join(root,'.artifacts/run-journey-'));let components:any;
try{const path=join(directory,'render.mjs');await writeFile(path,built.outputFiles[0]!.text);components=await import(pathToFileURL(path).href);}finally{await rm(directory,{recursive:true,force:true});}
const noop=()=>{};
function summary(values:Partial<RunSummary>={}):RunSummary{return{id:'a'.repeat(64),runId:'private-domain-uuid',targetId:'target',label:'Team app',versionLabel:'Version 2',kind:'deployment',status:'ready',sequence:2,frameCount:2,replayAvailable:true,timing:'steps',appVerified:false,limitations:[],...values};}
function state():DashboardState{return{revision:2,graph:null,busy:false,target:{id:'target'}};}
function record(values:Partial<RunRecord>={}):RunRecord{return{version:1,summary:summary(),frames:[{sequence:1,nativePosition:'native-start#1',caption:'Starting services',state:state()},{sequence:2,nativePosition:'native-end#2',caption:'Checking the result',state:{...state(),revision:3}}],omittedFrames:0,limitations:[],...values};}
const catalog=(runs=[summary()]):RunCatalog=>({version:1,runs,omitted:0,limitations:[]});

test('home shows recent activity and a single main start action without technical identifiers',()=>{
 const html=renderToStaticMarkup(createElement(components.RunHome,{catalog:catalog(),onSelect:noop,onNewRun:noop}));
 assert.match(html,/Recent runs/);assert.match(html,/Team app/);assert.match(html,/Version 2/);assert.match(html,/Completed/);assert.match(html,/>New run</);
 assert.doesNotMatch(html,/private-domain-uuid|System design|Execution evidence|native-start|Native run|FootPrint evidence/);
 assert.doesNotMatch(html,/ago|1970|Time not recorded/);
});
test('home keeps history ordered by its recorded sequence and offers the remaining rows on request',()=>{
 const rows=Array.from({length:8},(_,index)=>summary({id:String(index+1).repeat(64),sequence:index+1,label:'Run '+(index+1)}));
 assert.equal(orderedRuns(catalog(rows))[0]?.label,'Run 8');
 const html=renderToStaticMarkup(createElement(components.RunHome,{catalog:catalog(rows),onSelect:noop,onNewRun:noop,onShowAll:noop}));
 assert.equal((html.match(/class="run-row status-/g)??[]).length,6);assert.match(html,/Show all runs/);assert.doesNotMatch(html,/>Run 1</);
 const all=renderToStaticMarkup(createElement(components.RunHome,{catalog:catalog(rows),onSelect:noop,onNewRun:noop,showAll:true}));assert.equal((all.match(/class="run-row status-/g)??[]).length,8);
});
test('seeking selects an actual captured state without inventing prior steps or changing the live input',()=>{
 const held=record(),live=state();
 assert.equal(recordedFrame(held,0)?.state,held.frames[0]?.state);assert.equal(recordedFrame(held,999)?.state,held.frames[1]?.state);
 assert.equal(recordedFrame(held,-1)?.state,held.frames[0]?.state);assert.equal(recordedFrame(held,Number.NaN)?.state,held.frames[0]?.state);
 assert.equal(live.revision,2);assert.equal(held.frames.length,2);assert.equal(momentText(held,0),'Moment 1 of 2');
});
test('historical runs never borrow the current target state and unverified app addresses stay hidden',()=>{
 const live={...state(),run:{id:'new-run',status:'passed' as const,resources:[],events:[]}};
 assert.equal(isCurrentRun(summary(),live),false);
 assert.equal(isCurrentRun(summary({runId:'new-run',targetId:'another-target'}),live),false);
 const matching={...live,run:{...live.run,id:'private-domain-uuid'}};
 assert.equal(isCurrentRun(summary(),matching,record()),true);
 assert.equal(isCurrentRun(summary(),{...matching,graph:compileGraph({name:'other',resources:[],boundaries:[],memberships:[],relations:[]})},record()),false);
 assert.equal(runAppLink(summary({appUrl:'https://app.example.com/'})),undefined);
 assert.equal(runAppLink(summary({appUrl:'https://app.example.com/',appVerified:true})),'https://app.example.com/');
 for(const appUrl of ['javascript:alert(1)','https://user:secret@app.example.com/'])assert.equal(runAppLink(summary({appUrl,appVerified:true})),undefined);
});
test('recorded times appear only when retained; completion does not imply a verified app',()=>{
 assert.equal(runTimeText(summary()),undefined);assert.equal(runStatusText(summary()),'Completed');assert.equal(runStatusText(summary({appVerified:true})),'Ready');
 const held=record({summary:summary({timing:'recorded'}),frames:[{sequence:1,nativePosition:'one',caption:'One',recordedAt:1000,state:state()},{sequence:2,nativePosition:'two',caption:'Two',recordedAt:62000,state:state()}]});
 assert.equal(momentText(held,1),'1:01');
});
test('replay controls are step based when timing is incomplete and disabled when no replay was captured',()=>{
 let html=renderToStaticMarkup(createElement(components.RunTimeline,{record:record(),index:0,playing:false,following:false,isLive:false,onSeek:noop,onPlay:noop,onLive:noop}));
 assert.match(html,/Recorded steps/);assert.match(html,/Moment 1 of 2/);assert.match(html,/type="range"/);assert.match(html,/aria-label="Recorded progress"/);assert.doesNotMatch(html,/Deploy|Restart|native-start/);
 html=renderToStaticMarkup(createElement(components.RunTimeline,{record:record({frames:[],summary:summary({frameCount:0,replayAvailable:false})}),index:0,playing:false,following:false,isLive:false,onSeek:noop,onPlay:noop,onLive:noop}));
 assert.match(html,/disabled=""/);assert.match(html,/No replay captured/);
});
test('a verified historical address is presented as recorded verification rather than current health',()=>{
 const held=record({summary:summary({appVerified:true,appUrl:'https://app.example.com/'})});
 const html=renderToStaticMarkup(createElement(components.RunPlayer,{record:held,summary:held.summary,liveState:state(),loading:false,onBack:noop,onCurrentDetails:noop}));
 assert.match(html,/Open recorded app/);assert.match(html,/Verified during this run/);assert.match(html,/rel="noreferrer noopener"/);assert.doesNotMatch(html,/private-domain-uuid|native-start|Native run/);assert.match(html,/Deployment flow/);assert.match(html,/Running system/);
});
test('Live requires a connected current run with native running evidence',()=>{
 const held=record({summary:summary({status:'running'})});
 const native:DashboardState={...state(),busy:true,run:{id:held.summary.runId,status:'running',resources:[],events:[{version:1,runId:held.summary.runId,sequence:1,timestamp:1000,runtimeStageId:'execute#0',resourceId:'services',status:'deploying'}]}};
 const render=(liveState:DashboardState,connected=true)=>renderToStaticMarkup(createElement(components.RunPlayer,{record:held,summary:held.summary,liveState,connected,loading:false,onBack:noop,onCurrentDetails:noop}));
 assert.match(render(native),/Following live/);
 for(const html of [render(native,false),render(state()),render({...native,run:{...native.run!,id:'another-run'}}),render({...native,run:{...native.run!,events:[]}}),render({...native,run:{...native.run!,status:'passed'}})]){
  assert.doesNotMatch(html,/Following live|class="run-following"|class="run-live-button/,'a saved running summary alone must never appear live');
 }
});
test('an empty history offers a registered setup and simulations stay explicitly labelled',()=>{
 let html=renderToStaticMarkup(createElement(components.RunHome,{catalog:catalog([]),onSelect:noop,onNewRun:noop}));assert.match(html,/Your first run starts here/);assert.match(html,/Start a run/);
 html=renderToStaticMarkup(createElement(components.RunHome,{catalog:catalog([summary({limitations:['Simulation: no infrastructure effects.']})]),onSelect:noop,onNewRun:noop}));assert.match(html,/Simulation ·/);
});
test('history limitations remain visible without pretending that a persistence problem only affects older runs',()=>{
 const value={...catalog(),limitations:['The newest run could not be saved. Native evidence is retained.']};
 const html=renderToStaticMarkup(createElement(components.RunHome,{catalog:value,onSelect:noop,onNewRun:noop}));
 assert.match(html,/Run history needs attention/);assert.match(html,/newest run could not be saved/);assert.doesNotMatch(html,/Some earlier runs have limited/);
});
test('the run journey remains a lazy browser feature with replay dependencies outside the shell',async()=>{
 const result=await build({absWorkingDir:root,entryPoints:['web/features/runs/RunWorkspaceSlot.tsx'],outdir:'/not-written',bundle:true,write:false,splitting:true,platform:'browser',format:'esm',packages:'external',jsx:'automatic',logLevel:'silent'});
 const entry=result.outputFiles.find(file=>file.path.endsWith('/RunWorkspaceSlot.js'))!.text;assert.match(entry,/import\(/);assert.doesNotMatch(entry,/Moment |run-scene-placeholder|Recorded timeline/);assert(result.outputFiles.some(file=>file.path.includes('/RunWorkspace-')));
});
