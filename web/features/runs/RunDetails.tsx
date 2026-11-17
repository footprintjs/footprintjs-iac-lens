import {lazy,Suspense,useState} from 'react';
import type {RunRecord} from '../../../src/core/run-history.ts';
import {DetailsPanel} from '../../components/DetailsPanel.tsx';
import {SystemTopologySlot} from '../system-topology/SystemTopologySlot.tsx';
import {recordedFrame} from './model.ts';
const EvidenceView=lazy(()=>import('../../components/EvidenceView.tsx'));
export function RunDetails({record,index,onClose}:{record:RunRecord;index:number;onClose():void}) {
 const [tab,setTab]=useState<'recording'|'system'>('recording'),frame=recordedFrame(record,index);
 return <DetailsPanel title="Run details" onClose={onClose}><div className="run-details">
  <div className="run-details-tabs" role="tablist" aria-label="Run detail view"><button role="tab" aria-selected={tab==='recording'} onClick={()=>setTab('recording')}>Recording</button><button role="tab" aria-selected={tab==='system'} onClick={()=>setTab('system')}>System design</button></div>
  {tab==='recording'?<><p>The full run recording is shown here. System design follows your selected replay moment.</p><Suspense fallback={<p role="status">Opening recording…</p>}><EvidenceView recording={record.recording} running={record.summary.status==='running'} title={record.summary.label}/></Suspense></>:frame?.state.systemTopology?<div className="run-details-system"><SystemTopologySlot view={frame.state.systemTopology} state={frame.state}/></div>:<p>No system diagram was recorded for this run.</p>}
  <details><summary>Recording information</summary><dl><dt>Run</dt><dd>{record.summary.runId}</dd><dt>Recorded updates</dt><dd>{record.frames.length}</dd><dt>Timeline</dt><dd>{record.summary.timing==='recorded'?'Recorded timestamps':'Ordered steps; complete timing was not captured'}</dd></dl>
   {[...record.limitations,...record.summary.limitations].map((message,index)=><p key={index}>{message}</p>)}{record.omittedFrames>0&&<p>{record.omittedFrames} updates are outside this bounded replay.</p>}
  </details>
 </div></DetailsPanel>;
}
