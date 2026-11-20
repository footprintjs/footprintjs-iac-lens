import assert from 'node:assert/strict';
import test from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {TimeTravelControls} from 'footprint-explainable-ui';
import type {RunFrame} from '../src/core/run-history.ts';
import {createReplaySnapshots} from '../web/features/runs/create-replay-snapshots.ts';
import {createReplayTimelineRows,replayTimelineRowIndex} from '../web/features/runs/create-replay-timeline-rows.ts';

function frames(captions=['Checking','Checking','Ready']):RunFrame[] {
 return captions.map((caption,index)=>({sequence:index*3+1,nativePosition:`actual-native-position-${index}`,caption,
  state:{revision:index,graph:null,busy:index<captions.length-1,target:{id:'private-host',label:'PRIVATE_TARGET_LABEL'},neoUrl:'https://private.example/'},
 }));
}

test('the EUI index keeps every saved publication, including identical captions and sparse sequence numbers',()=>{
 const input={frames:frames()},before=structuredClone(input),snapshots=createReplaySnapshots(input);
 assert.equal(snapshots.length,input.frames.length);
 assert.deepEqual(snapshots.map(snapshot=>snapshot.stageLabel),input.frames.map(frame=>frame.caption));
 assert.equal(new Set(snapshots.map(snapshot=>snapshot.stageName)).size,input.frames.length);
 assert(snapshots.every(snapshot=>snapshot.stageName.startsWith('recorded-update:')));
 assert.deepEqual(input,before);
});

test('display snapshots cannot expose host memory, stage identities, final outcomes or invented stage execution',()=>{
 const input={frames:frames()},snapshots=createReplaySnapshots(input),json=JSON.stringify(snapshots);
 for(const snapshot of snapshots){
  assert.deepEqual(snapshot.memory,{});assert.equal(snapshot.narrative,'');
  assert.equal(snapshot.runtimeStageId,undefined);assert.equal(snapshot.status,undefined);
  assert.equal(snapshot.subflowId,undefined);assert.equal(snapshot.durationMs,0);
 }
 assert.doesNotMatch(json,/PRIVATE_TARGET_LABEL|private-host|private\.example|actual-native-position/);
 snapshots[0]!.memory.changed=true;
 assert.deepEqual(snapshots[1]!.memory,{});assert.equal(input.frames[0]!.state.target!.label,'PRIVATE_TARGET_LABEL');
});

test('complete nondecreasing publication clocks preserve real offsets without inventing native durations',()=>{
 const input={frames:frames()};[1_000.25,1_000.25,1_200.75].forEach((time,index)=>input.frames[index]!.recordedAt=time);
 const snapshots=createReplaySnapshots(input);
 assert.deepEqual(snapshots.map(snapshot=>snapshot.startMs),[0,0,200.5]);
 assert(snapshots.every(snapshot=>snapshot.durationMs===0));
 const html=renderToStaticMarkup(createElement(TimeTravelControls,{snapshots,selectedIndex:1,onIndexChange:()=>{},size:'compact'}));
 assert.equal((html.match(/aria-label="Replay position"/g)??[]).length,1);
 assert.match(html,/data-fp="time-travel-controls"/);
 assert.doesNotMatch(html,/200\.5ms/,'the time between publications is not a native stage duration');
});

test('missing, decreasing or invalid clocks degrade the whole display to sequence observations',()=>{
 for(const clocks of [[1000,undefined,1200],[1000,999,1200],[1000,Number.NaN,1200],[1000,-1,1200],[1000,Infinity,1200],[1000,8_640_000_000_000_001,1200]]){
  const input={frames:frames()};clocks.forEach((time,index)=>{if(time!==undefined)input.frames[index]!.recordedAt=time;});
  assert.deepEqual(createReplaySnapshots(input).map(snapshot=>[snapshot.startMs,snapshot.durationMs]),[[0,0],[0,0],[0,0]]);
 }
 assert.deepEqual(createReplaySnapshots({frames:[]}),[]);
});

test('recorded activity rows group only consecutive exact captions and retain exact seek boundaries',()=>{
 const input={frames:frames(['Starting','Starting','Checking','Checking','Starting','Ready'])},before=structuredClone(input);
 const rows=createReplayTimelineRows(input);
 assert.deepEqual(rows.map(row=>[row.snapshot.stageLabel,row.firstFrameIndex,row.lastFrameIndex]),[
  ['Starting',0,1],['Checking',2,3],['Starting',4,4],['Ready',5,5],
 ]);
 assert.equal(new Set(rows.map(row=>row.snapshot.stageName)).size,rows.length);
 assert.deepEqual(input,before);
 for(let index=0;index<input.frames.length;index++){
  const rowIndex=replayTimelineRowIndex(rows,index),row=rows[rowIndex]!;
  assert(index>=row.firstFrameIndex&&index<=row.lastFrameIndex);
  assert.equal(row.snapshot.stageLabel,input.frames[index]!.caption);
  assert.equal(input.frames[row.firstFrameIndex]!.caption,row.snapshot.stageLabel,'a row click selects its exact first saved frame');
 }
 assert.deepEqual([replayTimelineRowIndex(rows,-10),replayTimelineRowIndex(rows,Number.NaN),replayTimelineRowIndex(rows,999)],[0,0,3]);
});

test('activity grouping keeps caption distinctions and does not measure a grouped span as work duration',()=>{
 const input={frames:frames(['Check','Check ','Check'])};[2000,2500,2900].forEach((time,index)=>input.frames[index]!.recordedAt=time);
 const rows=createReplayTimelineRows(input);
 assert.equal(rows.length,3);assert.deepEqual(rows.map(row=>row.snapshot.startMs),[0,500,900]);
 assert(rows.every(row=>row.snapshot.durationMs===0&&row.snapshot.status===undefined&&row.snapshot.runtimeStageId===undefined));
 assert.deepEqual(createReplayTimelineRows({frames:[]}),[]);assert.equal(replayTimelineRowIndex([],1),0);
});
