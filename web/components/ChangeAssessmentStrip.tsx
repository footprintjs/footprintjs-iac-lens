import {lazy,Suspense,useState} from 'react';
import {changeAssessmentLabel,type ChangeAssessmentView} from '../../src/core/change-assessment.ts';
import {DetailsPanel} from './DetailsPanel.tsx';
import './change-assessment.css';
const EvidenceView=lazy(()=>import('./EvidenceView.tsx'));
const labels:Record<string,string>={noop:'Keep as is',verify:'Check readiness',create:'Create',update:'Update in place',replace:'Replacement needs a plan',delete:'Removal needs review',blocked:'Blocked',unknown:'Needs more information'};
export function ChangeAssessmentStrip({view}:{view:ChangeAssessmentView}){
  const[details,setDetails]=useState(false),[native,setNative]=useState(false);
  const changes=view.report?.changes??[],attention=changes.some(change=>['replace','blocked','unknown','delete'].includes(change.disposition));
  return <section className={`assessment-strip${attention?' assessment-attention':''}`} aria-label="Recorded change assessment"><div><strong aria-live="polite">{changeAssessmentLabel(view)}</strong><span>{view.report?`${changes.filter(change=>change.disposition==='update').length} to update · ${changes.filter(change=>change.disposition==='noop').length} unchanged`:'Inspect → Compare → Check compatibility'}</span></div><button className="simple-button simple-secondary" onClick={()=>setDetails(true)}>Why this plan?</button>
    {details&&<DetailsPanel title="Why this deployment plan?" onClose={()=>{setDetails(false);setNative(false);}}><div className="assessment-details"><p>These decisions were recorded before deployment. Provider validation and configured adapter contracts supply the evidence; an unknown result requires review.</p><table><thead><tr><th>Resource</th><th>Decision</th><th>Evidence</th></tr></thead><tbody>{changes.map(change=><tr key={change.id}><td>{change.label}</td><td>{labels[change.disposition]}</td><td>{change.reasons.join(', ')}<br/><small>{change.validation} · {change.changedPaths.join(', ')}</small></td></tr>)}</tbody></table>{view.recording&&<><button className="simple-button simple-secondary" onClick={()=>setNative(!native)}>{native?'Hide':'Show'} recorded decision flow</button>{native&&<Suspense fallback={<p>Opening recording…</p>}><EvidenceView recording={view.recording} running={view.status==='running'} title="Recorded preflight observations and decisions"/></Suspense>}</>}</div></DetailsPanel>}
  </section>;
}
