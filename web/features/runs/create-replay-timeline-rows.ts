import type {StageSnapshot} from 'footprint-explainable-ui';
import type {RunRecord} from '../../../src/core/run-history.ts';
import {createReplaySnapshots} from './create-replay-snapshots.ts';

export interface ReplayTimelineRow {
 snapshot:StageSnapshot;
 firstFrameIndex:number;
 lastFrameIndex:number;
}

/** Coalesce only adjacent identical publication captions, never inferred native stages. */
export function createReplayTimelineRows(record:Pick<RunRecord,'frames'>):ReplayTimelineRow[] {
 const rows:ReplayTimelineRow[]=[];
 for(const [index,snapshot]of createReplaySnapshots(record).entries()){
  const previous=rows.at(-1);
  if(previous?.snapshot.stageLabel===snapshot.stageLabel)previous.lastFrameIndex=index;
  else rows.push({snapshot,firstFrameIndex:index,lastFrameIndex:index});
 }
 return rows;
}

/** Map the shared saved-frame cursor to its display row without moving that cursor. */
export function replayTimelineRowIndex(rows:readonly ReplayTimelineRow[],frameIndex:number):number {
 if(!rows.length)return 0;
 const index=Number.isFinite(frameIndex)?Math.max(0,Math.min(Math.trunc(frameIndex),rows.at(-1)!.lastFrameIndex)):0;
 return Math.max(0,rows.findIndex(row=>index>=row.firstFrameIndex&&index<=row.lastFrameIndex));
}
