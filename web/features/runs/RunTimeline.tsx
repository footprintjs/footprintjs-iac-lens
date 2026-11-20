import {useMemo,useState} from 'react';
import {FootprintButton,FootprintTheme,SurfaceCollapseHandle,TimeTravelControls} from 'footprint-explainable-ui';
import type {RunRecord} from '../../../src/core/run-history.ts';
import {useLensTheme} from '../../theme/LensThemeContext.tsx';
import {createReplaySnapshots} from './create-replay-snapshots.ts';
import {createReplayTimelineRows,replayTimelineRowIndex} from './create-replay-timeline-rows.ts';
import {momentText,recordedFrame} from './model.ts';

export interface RunTimelineProps {
 record:RunRecord;index:number;following:boolean;isLive:boolean;resetToken?:number;
 onSeek(index:number):void;onLive():void;
}

/** EUI owns the one playback clock and slider; Lens maps it to saved publications. */
export function RunTimeline({record,index,following,onSeek,onLive,isLive,resetToken=0}:RunTimelineProps) {
 const theme=useLensTheme(),[expanded,setExpanded]=useState(false),[controlEpoch,setControlEpoch]=useState(0);
 const snapshots=useMemo(()=>createReplaySnapshots(record),[record.frames]);
 const rows=useMemo(()=>createReplayTimelineRows(record),[record.frames]);
 const selectedRow=replayTimelineRowIndex(rows,index),frame=recordedFrame(record,index);
 const stopAndSeek=(value:number)=>{setControlEpoch(epoch=>epoch+1);onSeek(value);};
 return <section className="run-timeline" aria-label="Run replay" data-replay-renderer="explainable-ui" data-replay-axis="recorded-publications">
  <FootprintTheme tokens={theme.tokens}>
   <div className="run-timeline-controls"><span className="run-timeline-label">{following&&isLive?'Following live':record.summary.timing==='recorded'?'Recorded timeline':'Recorded steps'}</span>
    <span className="run-timeline-moment">{frame?momentText(record,index):'No replay captured'}</span>
    {isLive&&<button type="button" className={`run-live-button${following?' active':''}`} aria-pressed={following} onClick={onLive}><i/>Live</button>}
   </div>
   <div className="run-eui-replay" onClickCapture={()=>{if(following&&isLive)onSeek(index);}} onKeyDownCapture={event=>{if(following&&isLive&&event.key===' '&&!(event.target instanceof HTMLInputElement))onSeek(index);}}>
    <TimeTravelControls key={`${resetToken}:${controlEpoch}`} snapshots={snapshots} selectedIndex={index} onIndexChange={onSeek}
     autoPlayable autoPlay={false} autoPlayKey={record.summary.runId} replayControls={{previousNext:true,playPause:true,slider:true,intervalMs:650}} size="compact"/>
   </div>
   <div className="run-stage-disclosure" data-stage-strip-placement="below">
    <SurfaceCollapseHandle label="Stages" expanded={expanded} orientation="horizontal" onToggle={()=>setExpanded(value=>!value)} style={{width:'100%'}}/>
    {expanded&&<div className="run-stage-strip" aria-label="Recorded activity" data-fp="run-stage-strip">
     {rows.map((row,rowIndex)=><FootprintButton key={row.snapshot.stageName} densitySize="compact" part="run-recorded-stage"
      aria-current={rowIndex===selectedRow?'step':undefined} title={row.snapshot.stageLabel} onClick={()=>stopAndSeek(row.firstFrameIndex)}
      style={{background:rowIndex===selectedRow?'var(--fp-accent-bg)':'var(--fp-bg-elevated)',color:rowIndex===selectedRow?'var(--fp-accent)':'var(--fp-text-secondary)'}}>{row.snapshot.stageLabel}</FootprintButton>)}
     {!rows.length&&<span>No recorded stages</span>}
    </div>}
   </div>
  </FootprintTheme>
 </section>;
}
