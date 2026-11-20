import {useCallback,useEffect,useMemo,useState} from 'react';
import {deriveRunObservation,type RunRecord,type RunSummary} from '../../../src/core/run-history.ts';
import type {DashboardState} from '../../../src/core/types.ts';
import {Icon} from '../../components/Icon.tsx';
import {RunScene} from './RunScene.tsx';
import {RunTimeline} from './RunTimeline.tsx';
import {RunDetails} from './RunDetails.tsx';
import {isCurrentRun,runAppLink,runIsSimulation,runStatusText} from './model.ts';
import {selectRunMoment} from './select-run-moment.ts';
import {selectFollowScopeContext} from './follow-scope-context.ts';
import {selectSystemFollowContext} from './system-follow-context.ts';

export function RunPlayer({record,summary,liveState,connected,loading,onBack,onCurrentDetails}:{record?:RunRecord;summary:RunSummary;liveState:DashboardState;connected:boolean;loading:boolean;onBack():void;onCurrentDetails():void}) {
 const [index,setIndex]=useState(0),[following,setFollowing]=useState(true),[details,setDetails]=useState(false),[replayReset,setReplayReset]=useState(0);
 const [followExecution,setFollowExecution]=useState(true);
 const current=!!record&&isCurrentRun(summary,liveState,record);
 const live=useMemo(()=>current?deriveRunObservation(liveState):undefined,[current,liveState]);
 const isLive=connected&&current&&live?.status==='running',recordedRunning=summary.status==='running'&&!isLive;
 useEffect(()=>{setIndex(0);setFollowing(true);setFollowExecution(true);},[summary.id]);
 useEffect(()=>{if(following&&record)setIndex(Math.max(0,record.frames.length-1));},[following,record?.frames.length]);
 const {frame,state,deployment}=useMemo(()=>selectRunMoment(record,index,liveState,following),[record,index,liveState,following]);
 const cameraContext=useMemo(()=>followExecution?selectFollowScopeContext({record,index,state,deployment,followingLive:following&&current}):undefined,[followExecution,record,index,state,deployment,following,current]);
 const systemCameraContext=useMemo(()=>followExecution?selectSystemFollowContext({record,index,state,deployment,followingLive:following&&current}):undefined,[followExecution,record,index,state,deployment,following,current]);
 const caption=following&&current?(live?.caption??frame?.caption??runStatusText(summary)):frame?.caption??runStatusText(summary);
 const appUrl=runAppLink(summary),showApp=appUrl&&(!record||following||index===record.frames.length-1);
 const viewingPast=!!record&&index<record.frames.length-1&&!following;
 const seek=useCallback((value:number)=>{setFollowing(false);setIndex(value);},[]);
 const openDetails=()=>{setReplayReset(value=>value+1);if(current&&following)onCurrentDetails();else setDetails(true);};
 return <main className="run-player" aria-label="Selected run">
  <header className="run-player-heading"><div><button type="button" className="run-back" onClick={onBack}><span aria-hidden="true">←</span>All runs</button><h1>{summary.label}</h1>{summary.versionLabel&&<p>{summary.versionLabel}</p>}</div><div className="run-player-actions"><span className={`run-status status-${summary.status}`}><i/>{recordedRunning?'Recorded in progress':runStatusText(summary)}</span><button type="button" className="run-secondary" onClick={openDetails} disabled={!record&&!current}>Details</button></div></header>
  <section className="run-progress-panel"><header className="run-progress-heading"><span className={`run-caption-icon status-${summary.status}`}><Icon name={summary.status==='ready'?'check':summary.status==='running'?'play':'evidence'} size={19}/></span><h2 aria-live="polite">{caption}</h2>{runIsSimulation(summary)&&<span className="run-simulation">Simulation</span>}{state&&deployment?.available&&<button type="button" className="run-execution-follow" aria-label="Follow execution" aria-pressed={followExecution} onClick={()=>setFollowExecution(value=>!value)}><i/>Follow execution</button>}{following&&isLive&&<span className="run-following"><i/>Live</span>}{!following&&<span className="run-replay-label">Replay</span>}</header>
   {loading&&!record?<div className="run-loading" role="status">Opening the recording…</div>:state?<RunScene state={state} caption={caption} deployment={deployment} followExecution={followExecution} cameraContext={cameraContext} systemCameraContext={systemCameraContext} onExplore={()=>setFollowExecution(false)}/>:<div className="run-summary-only"><Icon name="evidence" size={35}/><h3>{summary.frameCount>0?'The replay is unavailable':'The result is saved'}</h3><p>{summary.frameCount>0?'This recording could not be opened in this viewer.':'This earlier run has no captured replay.'}</p></div>}
   {record&&<RunTimeline record={record} index={index} following={following} isLive={isLive} resetToken={replayReset} onSeek={seek} onLive={()=>{setReplayReset(value=>value+1);setFollowing(true);}}/>}
  </section>
  <footer className="run-result"><div><strong>{viewingPast?'Replaying this run':recordedRunning?'Last recorded: in progress':summary.status==='ready'?(summary.appVerified?'Your app is ready':'Run complete'):summary.status==='running'?'Work is in progress':summary.status==='failed'?'This run needs attention':'The result is not confirmed'}</strong><span>{viewingPast?'Move the slider to explore each recorded update.':recordedRunning?'The latest recorded update is shown.':!current&&summary.appVerified?'Verified during this run. The address may now serve a newer version.':summary.status==='running'?'You can keep this view open.':summary.status==='ready'?'Choose Details to explore the recorded steps.':'Details show the recorded result.'}</span>{showApp&&!viewingPast&&<small className="run-result-address" title={appUrl}>{appUrl}</small>}</div>{showApp&&!viewingPast&&<a className="run-primary" href={appUrl} target="_blank" rel="noreferrer noopener">{current?'Open app':'Open recorded app'}<Icon name="external" size={16}/></a>}</footer>
  {record&&(record.omittedFrames>0||record.limitations.length>0)&&<details className="run-history-note"><summary>Recording notes</summary>{record.omittedFrames>0&&<p>{record.omittedFrames} updates are outside this bounded replay.</p>}{record.limitations.map((message,index)=><p key={index}>{message}</p>)}</details>}
  {details&&record&&<RunDetails record={record} index={index} onClose={()=>setDetails(false)}/>}
 </main>;
}
