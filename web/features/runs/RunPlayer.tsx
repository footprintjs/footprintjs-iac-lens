import {useEffect,useMemo,useState} from 'react';
import {deriveRunObservation,type RunRecord,type RunSummary} from '../../../src/core/run-history.ts';
import type {DashboardState} from '../../../src/core/types.ts';
import {Icon} from '../../components/Icon.tsx';
import {RunScene} from './RunScene.tsx';
import {RunTimeline} from './RunTimeline.tsx';
import {RunDetails} from './RunDetails.tsx';
import {isCurrentRun,runAppLink,runIsSimulation,runStatusText} from './model.ts';
import {selectRunMoment} from './select-run-moment.ts';

export function RunPlayer({record,summary,liveState,connected,loading,onBack,onCurrentDetails}:{record?:RunRecord;summary:RunSummary;liveState:DashboardState;connected:boolean;loading:boolean;onBack():void;onCurrentDetails():void}) {
 const [index,setIndex]=useState(0),[following,setFollowing]=useState(true),[playing,setPlaying]=useState(false),[details,setDetails]=useState(false);
 const current=!!record&&isCurrentRun(summary,liveState,record);
 const live=useMemo(()=>current?deriveRunObservation(liveState):undefined,[current,liveState]);
 const isLive=connected&&current&&live?.status==='running',recordedRunning=summary.status==='running'&&!isLive;
 useEffect(()=>{setIndex(0);setFollowing(true);setPlaying(false);},[summary.id]);
 useEffect(()=>{if(following&&record)setIndex(Math.max(0,record.frames.length-1));},[following,record?.frames.length]);
 useEffect(()=>{
  if(!playing||!record)return;
  if(index>=record.frames.length-1){setPlaying(false);return;}
  // Presentation playback traverses recorded observations; it invokes no workflow action.
  const timer=setTimeout(()=>setIndex(value=>Math.min(record.frames.length-1,value+1)),650);return()=>clearTimeout(timer);
 },[playing,index,record]);
 const {frame,state,deployment}=useMemo(()=>selectRunMoment(record,index,liveState,following),[record,index,liveState,following]);
 const caption=following&&current?(live?.caption??frame?.caption??runStatusText(summary)):frame?.caption??runStatusText(summary);
 const appUrl=runAppLink(summary),showApp=appUrl&&(!record||following||index===record.frames.length-1);
 const viewingPast=!!record&&index<record.frames.length-1&&!following;
 const seek=(value:number)=>{setPlaying(false);setFollowing(false);setIndex(value);};
 const play=()=>{setFollowing(false);if(!playing&&record&&index>=record.frames.length-1)setIndex(0);setPlaying(!playing);};
 const openDetails=()=>{setPlaying(false);if(current&&following)onCurrentDetails();else setDetails(true);};
 return <main className="run-player" aria-label="Selected run">
  <header className="run-player-heading"><div><button type="button" className="run-back" onClick={onBack}><span aria-hidden="true">←</span>All runs</button><h1>{summary.label}</h1>{summary.versionLabel&&<p>{summary.versionLabel}</p>}</div><div className="run-player-actions"><span className={`run-status status-${summary.status}`}><i/>{recordedRunning?'Recorded in progress':runStatusText(summary)}</span><button type="button" className="run-secondary" onClick={openDetails} disabled={!record&&!current}>Details</button></div></header>
  <section className="run-progress-panel"><header className="run-progress-heading"><span className={`run-caption-icon status-${summary.status}`}><Icon name={summary.status==='ready'?'check':summary.status==='running'?'play':'evidence'} size={19}/></span><h2 aria-live="polite">{caption}</h2>{runIsSimulation(summary)&&<span className="run-simulation">Simulation</span>}{following&&isLive&&<span className="run-following"><i/>Live</span>}{!following&&<span className="run-replay-label">Replay</span>}</header>
   {loading&&!record?<div className="run-loading" role="status">Opening the recording…</div>:state?<RunScene state={state} caption={caption} deployment={deployment}/>:<div className="run-summary-only"><Icon name="evidence" size={35}/><h3>{summary.frameCount>0?'The replay is unavailable':'The result is saved'}</h3><p>{summary.frameCount>0?'This recording could not be opened in this viewer.':'This earlier run has no captured replay.'}</p></div>}
   {record&&<RunTimeline record={record} index={index} playing={playing} following={following} isLive={isLive} onSeek={seek} onPlay={play} onLive={()=>{setPlaying(false);setFollowing(true);}}/>}
  </section>
  <footer className="run-result"><div><strong>{viewingPast?'Replaying this run':recordedRunning?'Last recorded: in progress':summary.status==='ready'?(summary.appVerified?'Your app is ready':'Run complete'):summary.status==='running'?'Work is in progress':summary.status==='failed'?'This run needs attention':'The result is not confirmed'}</strong><span>{viewingPast?'Move the slider to explore each recorded update.':recordedRunning?'The latest recorded update is shown.':!current&&summary.appVerified?'Verified during this run. The address may now serve a newer version.':summary.status==='running'?'You can keep this view open.':summary.status==='ready'?'Choose Details to explore the recorded steps.':'Details show the recorded result.'}</span>{showApp&&!viewingPast&&<small className="run-result-address" title={appUrl}>{appUrl}</small>}</div>{showApp&&!viewingPast&&<a className="run-primary" href={appUrl} target="_blank" rel="noreferrer noopener">{current?'Open app':'Open recorded app'}<Icon name="external" size={16}/></a>}</footer>
  {record&&(record.omittedFrames>0||record.limitations.length>0)&&<details className="run-history-note"><summary>Recording notes</summary>{record.omittedFrames>0&&<p>{record.omittedFrames} updates are outside this bounded replay.</p>}{record.limitations.map((message,index)=><p key={index}>{message}</p>)}</details>}
  {details&&record&&<RunDetails record={record} index={index} onClose={()=>setDetails(false)}/>}
 </main>;
}
