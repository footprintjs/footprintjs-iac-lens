import {loadChangeAssessmentRecording,readChangeAssessmentReport} from 'footprintjs-iac/change-assessment/node';
import type {NeoDeliveryObservation} from 'footprintjs-iac/integration/identity/github-delivery';
import type {ChangeAssessmentView} from '../../src/core/change-assessment.ts';

export async function neoAssessmentProjection(event:Extract<NeoDeliveryObservation,{kind:'assessment'}>):Promise<ChangeAssessmentView>{
  const report=event.report?readChangeAssessmentReport(event.report):undefined;
  let recording:ChangeAssessmentView['recording'];
  if(event.recording){
    const loaded=await loadChangeAssessmentRecording(event.recording.evidencePath,{runId:event.recording.runId,...(report?{executionId:report.executionId,definitionDigest:report.definitionDigest}:{})});
    if(!loaded.complete)throw Error('Neo preflight evidence is incomplete');
    const snapshot=loaded.snapshot as {sharedState?:Record<string,unknown>}|null;
    if(!snapshot?.sharedState)throw Error('Neo preflight recording has no admitted state');
    const shared=snapshot.sharedState;
    if(report&&(shared.report as {digest?:string}|undefined)?.digest!==report.digest)throw Error('Neo preflight report differs from its recording');
    recording={snapshot:loaded.snapshot,structure:loaded.structure,controlDeps:loaded.controlDeps as Record<string,unknown>,narrativeEntries:Array.isArray(loaded.narrativeEntries)?loaded.narrativeEntries:[]};
  }
  return{phase:event.phase,status:event.status==='checking'?'running':report?'complete':'incomplete',...(report?{report}:{}),...(recording?{recording}:{})};
}
