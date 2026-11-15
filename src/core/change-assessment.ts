import {readChangeAssessmentReportShape,type ChangeAssessmentReport} from 'footprintjs-iac/change-assessment';
import type {Recording} from './types.ts';

/** Public assessment facts only. Provider handles and transport responses remain on the host. */
export interface ChangeAssessmentView {
  phase:'plan'|'revalidate';status:'idle'|'running'|'complete'|'incomplete';
  report?:ChangeAssessmentReport;recording?:Recording;
}
export function readChangeAssessmentView(input:unknown):ChangeAssessmentView {
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid change assessment view');
  const value=input as ChangeAssessmentView;
  if(Object.keys(value).some(key=>!['phase','status','report','recording'].includes(key))||!['plan','revalidate'].includes(value.phase)||!['idle','running','complete','incomplete'].includes(value.status))throw Error('Invalid change assessment phase');
  return{phase:value.phase,status:value.status,...(value.report?{report:readChangeAssessmentReportShape(value.report)}:{}),...(value.recording?{recording:structuredClone(value.recording)}:{})};
}
export function changeAssessmentLabel(view:ChangeAssessmentView):string {
  if(view.status==='running')return view.phase==='revalidate'?'Rechecking before deployment':'Checking proposed changes';
  if(view.status==='incomplete')return 'Change check needs inspection';
  if(view.status!=='complete'||!view.report)return 'Changes not checked';
  if(view.report.changes.some(change=>['unknown','blocked','replace','delete'].includes(change.disposition)))return 'Change needs review';
  return view.phase==='revalidate'?'Changes rechecked':'Changes checked';
}
