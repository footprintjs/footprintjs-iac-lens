import type {RunCatalog,RunSummary} from '../../../src/core/run-history.ts';
import {Icon} from '../../components/Icon.tsx';
import {orderedRuns,runIsSimulation,runStatusText,runTimeText} from './model.ts';
export function RunHome({catalog,onSelect,onNewRun,showAll=false,onShowAll}:{catalog:RunCatalog;onSelect(id:string):void;onNewRun():void;showAll?:boolean;onShowAll?():void}) {
 const rows=orderedRuns(catalog),shown=showAll?rows:rows.slice(0,6);
 return <main className="runs-home" aria-label="Recent runs">
  <header className="runs-home-heading"><div><span className="runs-eyebrow">Activity</span><h1>Recent runs</h1><p>Choose a run to see what happened.</p></div>{shown.length>0&&<button type="button" className="run-primary" onClick={onNewRun}><span aria-hidden="true">＋</span>New run</button>}</header>
  {shown.length?<div className="run-list">{shown.map(run=><RunRow key={run.id} run={run} onSelect={()=>onSelect(run.id)}/>)}</div>:<section className="runs-empty"><span className="runs-empty-icon"><Icon name="play" size={29}/></span><h2>Your first run starts here</h2><p>Start with the setup registered for this app.</p><button type="button" className="run-primary" onClick={onNewRun}>Start a run<Icon name="arrow" size={16}/></button></section>}
  <footer className="runs-home-footer"><span>{rows.length} {rows.length===1?'run':'runs'} available{catalog.omitted?` · ${catalog.omitted} older runs outside this view`:''}</span>{rows.length>6&&!showAll&&<button type="button" className="run-text-button" onClick={onShowAll}>Show all runs<Icon name="arrow" size={14}/></button>}</footer>
  {catalog.limitations.length>0&&<details className="run-history-note"><summary>Run history needs attention</summary>{catalog.limitations.map((message,index)=><p key={index}>{message}</p>)}</details>}
 </main>;
}
function RunRow({run,onSelect}:{run:RunSummary;onSelect():void}) {
 const time=runTimeText(run);
 return <button type="button" className={`run-row status-${run.status}`} onClick={onSelect} aria-label={`${run.label} · ${runStatusText(run)} · run ${run.sequence}`}>
  <span className="run-row-icon"><Icon name={run.kind==='checks'?'check':run.kind==='agent'?'compute':'graph'} size={21}/></span>
  <span className="run-row-title"><strong>{run.label}</strong><small>{runIsSimulation(run)?'Simulation · ':''}{run.versionLabel??(run.kind==='deployment'?'Deployment':run.kind==='checks'?'Checks':run.kind==='agent'?'Agent activity':'Workflow')}</small></span>
  <span className={`run-status status-${run.status}`}><i/>{runStatusText(run)}</span>
  <span className="run-row-time">{time??'Recorded run'}</span><Icon name="chevron" size={16}/>
 </button>;
}
