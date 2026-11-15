import type { MigrationView } from '../../src/core/migration.ts';
import { migrationChangeLabel } from '../../src/core/migration.ts';
export function MigrationAssessment({view}:{view:MigrationView}){
  const assessment=view.assessment;
  return <section className="migration-assessment" aria-label="Read-only change assessment"><div className="migration-section-label">Read-only review <span>{assessment.status==='complete'?'Reviewed':assessment.status==='running'?'Checking current system…':assessment.status==='incomplete'?'Needs inspection':'No deployment effects'}</span></div>
    <div className="migration-assessed-resources">{assessment.report?assessment.report.changes.map(change=><div key={change.id}><strong>{change.label}</strong><span className={`migration-disposition migration-disposition-${change.disposition}`}>{migrationChangeLabel(change,view.execution,view.review)}</span>{change.disposition==='replace'&&(!view.execution?.facts.dataChecked)&&<small>A verified data move is required</small>}</div>):assessment.resources.length?assessment.resources.map(resource=><div key={resource.id}><strong>{resource.label}</strong><span>{resource.status==='checked'?'Reviewed':resource.status==='checking'?'Checking…':'Not checked'}</span></div>):<span className="migration-muted">Start with a read-only review of the registered change.</span>}</div>
  </section>;
}
