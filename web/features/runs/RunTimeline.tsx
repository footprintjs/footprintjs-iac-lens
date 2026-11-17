import type {RunRecord} from '../../../src/core/run-history.ts';
import {Icon} from '../../components/Icon.tsx';
import {momentText,recordedFrame} from './model.ts';
export function RunTimeline({record,index,playing,following,onSeek,onPlay,onLive,isLive}:{record:RunRecord;index:number;playing:boolean;following:boolean;isLive:boolean;onSeek(index:number):void;onPlay():void;onLive():void}) {
 const frame=recordedFrame(record,index),available=record.frames.length>1;
 return <section className="run-timeline" aria-label="Run replay">
  <div className="run-timeline-controls"><button type="button" className="run-replay-button" onClick={onPlay} disabled={!available} aria-label={playing?'Pause replay':'Play replay'}>{playing?<span aria-hidden="true">Ⅱ</span>:<Icon name="play" size={15}/>}</button>
   <span className="run-timeline-label">{following&&isLive?'Following live':playing?'Step replay':record.summary.timing==='recorded'?'Recorded timeline':'Recorded steps'}</span>
   <span className="run-timeline-moment">{frame?momentText(record,index):'No replay captured'}</span>
   {isLive&&<button type="button" className={`run-live-button${following?' active':''}`} aria-pressed={following} onClick={onLive}><i/>Live</button>}
  </div>
  <label className="run-slider-label"><span className="run-sr-only">Recorded progress</span><input type="range" min={0} max={Math.max(0,record.frames.length-1)} value={Math.min(Math.max(index,0),Math.max(0,record.frames.length-1))} disabled={!available} onChange={event=>onSeek(Number(event.target.value))} aria-label="Recorded progress" aria-valuetext={frame?`${momentText(record,index)} · ${frame.caption}`:'No replay captured'}/></label>
  <div className="run-timeline-ends"><span>Start</span><span>{isLive?'Latest':'Finish'}</span></div>
 </section>;
}
