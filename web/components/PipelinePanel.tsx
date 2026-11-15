import { lazy, Suspense, useState } from 'react';
import { defaultPipelineSelection, type PipelineAction, type PipelineView } from '../../src/core/pipeline.ts';
import { DetailsPanel } from './DetailsPanel.tsx';
import { PipelineConfiguration } from './PipelineConfiguration.tsx';
import { PipelinePreview } from './PipelinePreview.tsx';
import { PipelineRecorded } from './PipelineRecorded.tsx';
import './pipeline.css';
const EvidenceView=lazy(()=>import('./EvidenceView.tsx'));
export function PipelinePanel({view,disabled,onAction,technical=false,compact=false}:{view:PipelineView;disabled:boolean;onAction?(action:PipelineAction):void;technical?:boolean;compact?:boolean}) {
  const [selection,setSelection]=useState(()=>view.preview?.selection??defaultPipelineSelection(view.catalog));
  const [configure,setConfigure]=useState(false),[inspect,setInspect]=useState<string>();
  const [evidence,setEvidence]=useState(false),[showPreview,setShowPreview]=useState(false);
  const locked=!!view.execution&&view.execution.status!=='idle';
  const dirty=JSON.stringify(selection)!==JSON.stringify(view.preview?.selection);
  const release=view.catalog.releases.find(v=>v.id===selection.releaseId);
  const stage=view.execution?.stages.find(v=>v.id===inspect);
  const preview=()=>onAction?.({action:'preview',pipelineId:view.catalog.id,selection});
  return <section className={`pipeline-panel${compact?' pipeline-compact':''}`} aria-label="Deployment pipeline"><div className="pipeline-toolbar"><div><strong>{view.catalog.label}</strong><span>{view.catalog.simulation?'Simulation · no infrastructure is changed':technical?'Host-configured deployment':'Choose a version to deploy'}</span></div>
    <label>Version<select aria-label="Release version" disabled={disabled||locked} value={selection.releaseId} onChange={event=>setSelection({...selection,releaseId:event.target.value})}>{view.catalog.releases.map(release=><option value={release.id} key={release.id}>{release.label}{technical&&<>{release.version?` · ${release.version}`:''} · {release.kind==='prepared'?'Prepared':'Source version'}</>}</option>)}</select></label>
    {(!compact||!locked)&&<><button className="simple-button simple-secondary" disabled={disabled||locked} onClick={()=>setConfigure(true)}>Set up stages</button>
    <button className="simple-button simple-secondary" disabled={disabled||locked||!onAction} onClick={preview}>Preview</button></>}
    {compact&&view.preview&&<button className="simple-button simple-secondary" onClick={()=>setShowPreview(true)}>View plan</button>}
    <button className="simple-button simple-primary" disabled={disabled||locked||dirty||!view.preview||!onAction} onClick={()=>view.preview&&onAction?.({action:'start',pipelineId:view.catalog.id,previewId:view.preview.id})}>{view.busy?'Working…':locked?'Started':'Start deployment'}</button>
  </div>
    {(technical||!compact&&!locked)&&<PipelinePreview view={view}/>}
    <PipelineRecorded view={view} disabled={disabled} onAction={onAction} onInspect={setInspect}/>
    {view.error&&<p className="pipeline-error" role="alert">{view.error}</p>}
    {technical&&<p className="pipeline-muted">Release {release?.digest??'not prepared'} · {view.execution?.status??'not started'} · {view.execution?.recordings.length??0} native recordings</p>}
    {showPreview&&<DetailsPanel title="Deployment preview" onClose={()=>setShowPreview(false)}><PipelinePreview view={view}/></DetailsPanel>}
    {configure&&<DetailsPanel title="Set up deployment stages" onClose={()=>setConfigure(false)}><PipelineConfiguration catalog={view.catalog} selection={selection} disabled={disabled||locked} onChange={setSelection}/><button className="simple-button simple-primary" disabled={disabled||locked} onClick={()=>{preview();setConfigure(false);}}>Preview these settings</button></DetailsPanel>}
    {inspect&&<DetailsPanel title={`${view.catalog.stages.find(v=>v.id===inspect)?.label??inspect} · Recorded steps`} onClose={()=>{setInspect(undefined);setEvidence(false);}}><div className="pipeline-details"><p>{stage?labels(stage.status):'This environment has not started.'}</p><p>These operations come from the native FootPrint execution. The configuration preview is separate.</p>
      <table><thead><tr><th>Operation</th><th>Recorded result</th></tr></thead><tbody>{stage?.steps.map(step=><tr key={step.id}><td>{step.label}<br/><small>{step.id}</small></td><td>{step.status}</td></tr>)}</tbody></table>
      {!!view.execution?.recordings.length&&<><h3>Native recordings</h3><ul>{view.execution.recordings.filter(run=>run.stageId===inspect).map(run=><li key={run.runId}>{view.catalog.stages.find(stage=>stage.id===run.stageId)?.label} · {run.kind} · {run.status}<br/><small>{run.runId}</small></li>)}</ul></>}
      {!!stage?.changes.length&&<><h3>Reviewed resource actions</h3><p>From completed provider receipts. Application restoration does not reverse persistent data.</p><table><thead><tr><th>Resource</th><th>Action</th></tr></thead><tbody>{stage.changes.map(change=><tr key={change.resourceId}><td>{change.resourceId}</td><td>{change.action==='replace'?'Needs replacement · migration plan required':change.action}</td></tr>)}</tbody></table></>}
      {stage&&<p>Recovery: {stage.recovery}</p>}
      {!!stage?.checks.length&&<><h3>Acceptance checks</h3><ul>{stage.checks.map(check=><li key={check.id}>{check.id}: {check.status}</li>)}</ul></>}
      {stage?.recording&&<><button className="simple-button simple-secondary" onClick={()=>setEvidence(!evidence)}>{evidence?'Hide':'Show'} native flow</button>{evidence&&<Suspense fallback={<p>Opening recording…</p>}><EvidenceView recording={stage.recording} running={false} title={`${stage.label} · latest completed recording`}/></Suspense>}</>}
    </div></DetailsPanel>}
  </section>;
}
function labels(status:string):string {return ({passed:'Update verified.',failed:'A recorded step failed.','awaiting-promotion':'Waiting for approval.',recovered:'Previous verified release restored.',running:'A recorded operation is running.',incomplete:'Needs inspection.'} as Record<string,string>)[status]??'Waiting for deployment.';}
