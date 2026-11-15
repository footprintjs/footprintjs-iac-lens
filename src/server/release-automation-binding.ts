import {readReleaseAutomationState,type ReleaseAutomationState} from 'footprintjs-iac/release-automation/node';
import type {ReleaseAutomationView} from '../core/release-automation.ts';
import {pipelineFingerprint} from './pipeline-binding.ts';

/** Bind private host facts without copying targets, source handles or gate tokens to the browser. */
export class ReleaseAutomationBinding {
  private definition?:string;
  private attempts=new Map<string,{identity:string;source?:string;preparation?:string;pipeline?:string;terminal?:string}>();
  private stages?:string;
  private readonly configured:ReleaseAutomationView['stages'];
  constructor(configured:ReleaseAutomationView['stages']){this.configured=configured;}
  admit(input:ReleaseAutomationState):ReleaseAutomationState {
    const state=readReleaseAutomationState(input),definition=pipelineFingerprint({definition:state.definition,digest:state.definitionDigest});
    if(this.definition&&this.definition!==definition)throw Error('Release host policy changed');
    this.definition??=definition;
    for(const previous of this.attempts.keys())if(!state.attempts.some(attempt=>attempt.id===previous))throw Error('Retained release attempt disappeared');
    for(const attempt of state.attempts){
      const identity=pipelineFingerprint({id:attempt.id,releaseId:attempt.releaseId,trigger:attempt.trigger,createdAt:attempt.createdAt});
      const bound=this.attempts.get(attempt.id)??{identity};
      if(bound.identity!==identity||bound.terminal&&bound.terminal!==attempt.status&&attempt.status!=='incomplete')throw Error('Retained release attempt changed');
      for(const [key,value] of [['source',attempt.source],['preparation',attempt.preparation?{definition:attempt.preparation.definition,digest:attempt.preparation.definitionDigest,expectedRevision:attempt.preparation.expectedRevision}:undefined],
        ['pipeline',attempt.pipeline?{definition:attempt.pipeline.definition,digest:attempt.pipeline.definitionDigest,release:attempt.pipeline.release}:undefined]] as const){
        if(bound[key]&&value===undefined)throw Error('Release child binding disappeared');
        if(value!==undefined){const digest=pipelineFingerprint(value);if(bound[key]&&bound[key]!==digest)throw Error('Release source or child binding changed');bound[key]=digest;}
      }
      if(attempt.pipeline){
        const definitions=attempt.pipeline.definition.stages;
        if(definitions.length!==this.configured.length||definitions.some((stage,index)=>{
          const expected=this.configured[index];return !expected||stage.id!==expected.id||stage.label!==expected.label||stage.promotion!==expected.promotion||stage.rollback!==expected.rollback;
        }))throw Error('Release environments differ from the registered host');
        const stages=pipelineFingerprint(definitions);
        if(this.stages&&this.stages!==stages)throw Error('Release environment targets or contracts changed');this.stages??=stages;
        if(!attempt.preparation?.release||attempt.preparation.release.digest!==attempt.pipeline.release.digest)throw Error('Pipeline does not deploy the prepared release');
      }
      if(['passed','failed','incomplete','skipped'].includes(attempt.status))bound.terminal=attempt.status;
      this.attempts.set(attempt.id,bound);
    }
    return state;
  }
}
