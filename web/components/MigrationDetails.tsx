import { lazy,Suspense,useState } from 'react';
import type { MigrationView } from '../../src/core/migration.ts';
const EvidenceView=lazy(()=>import('./EvidenceView.tsx'));
export function MigrationDetails({view}:{view:MigrationView}){
  const [recording,setRecording]=useState<'assessment'|'migration'>();
  const evidence=recording==='assessment'?view.assessment.recording:recording==='migration'?view.execution?.recording:undefined;
  return <div className="migration-details"><p>{view.scopeLabel}</p><h3>Read-only assessment</h3><p>Provider observations classify a change at one point in time. This report does not apply a change or guarantee a later provider operation.</p>
    {view.assessment.report?<><code>{view.assessment.report.digest}</code><table><thead><tr><th>Resource</th><th>Assessment</th><th>Evidence</th><th>Required safeguards</th></tr></thead><tbody>{view.assessment.report.changes.map(change=><tr key={change.id}><td>{change.label}<br/><small>{change.resourceId} · {change.provider}</small></td><td>{change.disposition}<br/><small>{change.data} · {change.validation}</small></td><td>{change.changedPaths.join(', ')||'No changed paths'}<br/><small>{change.reasons.join(', ')}</small></td><td>{change.requirements.join(', ')||'None declared'}</td></tr>)}</tbody></table></>:<p>No completed assessment report is available.</p>}
    {view.assessment.recording&&<button className="simple-button simple-secondary" onClick={()=>setRecording(recording==='assessment'?undefined:'assessment')}>Show assessment recording</button>}
    <h3>Planned flow</h3><p>Compiled configuration; these steps are not execution evidence.</p><ol>{view.review?.steps.map(step=><li key={step.id}>{step.label} <small>{step.id} · {step.phase}</small></li>)}</ol>
    <h3>Recorded operations</h3><p>The original data is not deleted by this workflow. Restoring a connection is allowed only when the adapter verifies the recovery contract; an unknown outcome requires inspection.</p>
    <table><thead><tr><th>Operation</th><th>Native result</th></tr></thead><tbody>{view.execution?.operations.map(operation=><tr key={operation.id}><td>{operation.label}<br/><small>{operation.id} · {operation.phase}</small></td><td>{operation.status}</td></tr>)}</tbody></table>
    <h3>Native segments</h3><ul>{view.execution?.recordings.map(run=><li key={run.runId}>{run.kind} · {run.status}<br/><code>{run.runId}</code></li>)}</ul>
    {view.execution?.recording&&<button className="simple-button simple-secondary" onClick={()=>setRecording(recording==='migration'?undefined:'migration')}>Show latest migration recording</button>}
    {evidence&&<Suspense fallback={<p>Opening recording…</p>}><EvidenceView recording={evidence} running={false} title={recording==='assessment'?'Read-only assessment':'Latest migration segment'}/></Suspense>}
  </div>;
}
