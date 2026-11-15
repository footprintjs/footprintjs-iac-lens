import { useState } from 'react';
import { migrationHeadline,type MigrationAction,type MigrationView } from '../../src/core/migration.ts';
import { MigrationAssessment } from './MigrationAssessment.tsx';
import { MigrationStages } from './MigrationStages.tsx';
import { MigrationDetails } from './MigrationDetails.tsx';
import { DetailsPanel } from './DetailsPanel.tsx';
import './migration.css';
export function MigrationPanel({view,disabled,onAction,technical=false}:{view:MigrationView;disabled:boolean;onAction?(action:MigrationAction):void;technical?:boolean}){
  const [planId,setPlanId]=useState(()=>view.review?.planId??view.plans[0]?.id??''),[details,setDetails]=useState(false);
  const locked=!!view.execution&&view.execution.status!=='idle',report=view.assessment.report;
  const headline=view.assessment.status==='running'?'Reviewing changes':view.assessment.status==='incomplete'?'Review needs inspection':!view.execution||view.execution.status==='idle'?(view.review?'Ready to move data':view.assessment.status==='complete'?'Preview the data move':'Ready to review changes'):migrationHeadline(view.execution);
  const act=(action:MigrationAction)=>onAction?.(action);
  return <section className={`migration-panel${technical?' migration-technical':''}`} aria-label="Assessed data migration"><div className="migration-toolbar"><div><strong>{view.label}</strong><span>{view.scopeLabel}</span></div>
    <button className="simple-button simple-secondary" disabled={disabled||view.assessment.status!=='idle'||!onAction} onClick={()=>act({action:'assess',hostId:view.id})}>{view.assessment.status==='complete'?'Reviewed':'Review changes'}</button>
    <label>Plan<select aria-label="Migration plan" value={planId} disabled={disabled||locked} onChange={event=>setPlanId(event.target.value)}>{view.plans.map(plan=><option key={plan.id} value={plan.id}>{plan.label}</option>)}</select></label>
    <button className="simple-button simple-secondary" disabled={disabled||locked||view.assessment.status!=='complete'||!report||!onAction} onClick={()=>report&&act({action:'preview',hostId:view.id,planId,assessmentDigest:report.digest})}>Preview move</button>
    <button className="simple-button simple-primary" disabled={disabled||locked||!view.review||view.review.planId!==planId||!onAction} onClick={()=>view.review&&act({action:'start',hostId:view.id,reviewId:view.review.id})}>{view.busy?'Working…':locked?'Started':'Start migration'}</button>
    <button className="simple-button simple-secondary" onClick={()=>setDetails(true)}>Details</button>
  </div>
    <MigrationAssessment view={view}/>
    <div className="migration-story-heading"><h2 aria-live="polite">{headline}</h2>{view.execution?.canCutover&&<button className="simple-button simple-primary" disabled={disabled||!onAction} onClick={()=>act({action:'cutover',hostId:view.id,executionId:view.execution!.id})}>Approve switch</button>}{view.execution?.canRecover&&<button className="simple-button simple-secondary" disabled={disabled||!onAction} onClick={()=>act({action:'recover',hostId:view.id,executionId:view.execution!.id})}>{view.execution.facts.activeStore==='original'?'Resume original app':'Restore original'}</button>}</div>
    <MigrationStages view={view}/>
    {view.execution?.canCutover&&<p className="migration-gate-note">Writes are paused. Backup and data checks are recorded. The app still uses the original store until you approve the switch.</p>}
    {view.error&&<p className="migration-error" role="alert">{view.error}</p>}
    {technical&&<p className="migration-muted">Assessment {report?.digest??'not recorded'} · execution {view.execution?.id??'not started'}</p>}
    {details&&<DetailsPanel title="Assessment and migration evidence" onClose={()=>setDetails(false)}><MigrationDetails view={view}/></DetailsPanel>}
  </section>;
}
