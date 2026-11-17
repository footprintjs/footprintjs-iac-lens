import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {DashboardState} from '../../../src/core/types.ts';
import {DetailsPanel} from '../../components/DetailsPanel.tsx';
import {Icon} from '../../components/Icon.tsx';
import {RunHome} from './RunHome.tsx';
import {RunPlayer} from './RunPlayer.tsx';
import {useRunHistory} from './use-run-history.ts';
import './runs.css';

export interface RunWorkspaceProps {baseUrl:string;liveState:DashboardState;connected:boolean;setup:ReactNode;onDetails():void;onAgents?():void}
export default function RunWorkspace({baseUrl,liveState,connected,setup,onDetails,onAgents}:RunWorkspaceProps) {
 const [selectedId,setSelectedId]=useState<string>(),[setupOpen,setSetupOpen]=useState(false),[showAll,setShowAll]=useState(false),[wantedRun,setWantedRun]=useState<string>();
 const {catalog,record,error,refresh,loading}=useRunHistory(baseUrl,liveState,selectedId);
 const previousRun=useRef(liveState.run?.id);
 useEffect(()=>{
  const id=liveState.run?.id;
  if(id&&id!==previousRun.current&&setupOpen){setSetupOpen(false);setWantedRun(id);refresh();}
  previousRun.current=id;
 },[liveState.run?.id,setupOpen,refresh]);
 useEffect(()=>{if(!wantedRun)return;const run=catalog?.runs.find(run=>run.runId===wantedRun);if(run){setSelectedId(run.id);setWantedRun(undefined);}},[wantedRun,catalog]);
 const selected=record&&record.summary.id===selectedId?record.summary:catalog?.runs.find(run=>run.id===selectedId);
 const home=()=>{setSelectedId(undefined);setShowAll(false);refresh();};
 return <div className="runs-workspace">
  <nav className="runs-navigation" aria-label="Lens navigation"><button type="button" className="runs-nav-current" aria-current={selectedId?undefined:'page'} onClick={home}><Icon name="clock" size={19}/><span>Runs</span></button>{onAgents&&<button type="button" onClick={onAgents}><Icon name="compute" size={19}/><span>Agents</span></button>}<span className={`runs-connection${connected?' connected':''}`} aria-label={connected?'Live updates connected':'Reconnecting'}><i/></span></nav>
  <div className="runs-content">{error&&<div className="runs-fetch-error" role="alert"><span>{error}</span><button type="button" onClick={refresh}>Try again</button></div>}
   {selectedId&&selected?<RunPlayer key={selected.id} record={record?.summary.id===selected.id?record:undefined} summary={selected} liveState={liveState} connected={connected} loading={loading} onBack={home} onCurrentDetails={onDetails}/>:catalog?<RunHome catalog={catalog} onSelect={setSelectedId} onNewRun={()=>setSetupOpen(true)} showAll={showAll} onShowAll={()=>setShowAll(true)}/>:<main className="runs-loading" role="status"><Icon name="clock" size={30}/><h1>Opening recent runs…</h1></main>}
  </div>
  {setupOpen&&<DetailsPanel title="New run" onClose={()=>setSetupOpen(false)}><div className="run-setup"><p>Use the setup registered for this app.</p>{setup}</div></DetailsPanel>}
 </div>;
}
