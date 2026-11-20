import type {StageSnapshot} from 'footprint-explainable-ui';
import type {RunRecord} from '../../../src/core/run-history.ts';

/** Display observations for EUI's controlled index; these are not native stage commits. */
export function createReplaySnapshots(record:Pick<RunRecord,'frames'>):StageSnapshot[] {
 const frames=record.frames;
 const clocked=frames.length>0&&frames.every((frame,index)=>typeof frame.recordedAt==='number'
  &&Number.isFinite(frame.recordedAt)&&frame.recordedAt>=0&&frame.recordedAt<=8_640_000_000_000_000
  &&(index===0||frame.recordedAt>=frames[index-1]!.recordedAt!));
 const origin=clocked?frames[0]!.recordedAt!:0;
 return frames.map((frame,index)=>({
  stageName:`recorded-update:${frame.sequence}:${index}`,
  stageLabel:frame.caption,
  memory:{},narrative:'',
  startMs:clocked?frame.recordedAt!-origin:0,
  // Publication intervals cannot establish the duration of a native stage.
  durationMs:0,
 }));
}
