import type {ReleaseAutomationState} from 'footprintjs-iac/release-automation';
import {readReleaseAutomationView,type ReleaseAutomationView} from '../core/release-automation.ts';
import {projectPipelineState} from '../core/pipeline-project.ts';

export function releaseHostBusy(state:ReleaseAutomationState):boolean {
  return state.attempts.some(attempt=>['reserved','resolving','preparing','deploying'].includes(attempt.status));
}
/** Explicit projection: never spread the private definition, child state, catalog source or receipt. */
export function projectReleaseHost(state:ReleaseAutomationState,stages:ReleaseAutomationView['stages'],busy:boolean):ReleaseAutomationView {
  return readReleaseAutomationView({id:state.definition.id,label:state.definition.label,automatic:state.definition.automatic.enabled,
    initialized:state.initialized,busy,discoveryStatus:state.discoveryStatus,...(state.lastRefreshAt!==undefined?{lastCheckedAt:state.lastRefreshAt}:{}),
    choices:state.choices.map(choice=>({id:choice.id,label:choice.label,...(choice.version?{version:choice.version}:{}),...(choice.publishedAt?{publishedAt:choice.publishedAt}:{}),...(choice.source.commit?{commit:choice.source.commit}:{})})),
    stages:structuredClone(stages),attempts:state.attempts.map(attempt=>{
      const choice=attempt.source??state.choices.find(choice=>choice.id===attempt.releaseId);
      const build=attempt.preparation?.stages.map(({id,label,status})=>({id,label,status}))??[
        {id:'resolve',label:'Check release',status:'pending'},{id:'fetch',label:'Get source',status:'pending'},
        {id:'build',label:'Build application',status:'pending'},{id:'publish',label:'Save release',status:'pending'}];
      return{id:attempt.id,releaseId:attempt.releaseId,label:choice?.label??attempt.releaseId,...(choice?.version?{version:choice.version}:{}),...(choice?.source.commit?{commit:choice.source.commit}:{}),
        trigger:attempt.trigger,status:attempt.status,build,...(attempt.pipeline?{pipeline:projectPipelineState(attempt.pipeline,attempt.releaseId)}:{})};
    })});
}
