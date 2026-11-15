import type { PipelineCatalog, PipelineStageChoice } from '../../src/core/pipeline.ts';
import type { ReleaseManifest } from 'footprintjs-iac/releases';
export function pipelineCatalog(releases:ReleaseManifest[]):PipelineCatalog {
  return {id:'strategy-example',label:'Release strategy workshop',simulation:true,
    releases:releases.map(release=>({id:release.id,label:release.label??release.id,kind:'prepared',version:release.source.ref,commit:release.source.commit,digest:release.digest})),
    strategies:[
      {id:'direct',label:'Direct update',description:'Update the environment, run checks and confirm the deployed version.',rollback:true,options:[]},
      {id:'canary',label:'Gradual traffic',description:'Prepare a candidate, move traffic in measured steps, then finish the switch.',rollback:true,options:[{id:'pace',label:'Traffic steps',type:'choice',required:true,default:'careful',values:[{value:'careful',label:'5% → 25% → 50% → 100%'},{value:'quick',label:'25% → 100%'}]}]},
      {id:'blue-green',label:'Separate environment',description:'Prepare a second environment, check it, switch traffic and check again.',rollback:true,options:[]},
      {id:'custom',label:'Registered custom strategy',description:'A separate host-registered strategy using the same pipeline contract.',rollback:true,options:[]},
    ],checks:[{id:'health',label:'Application health'},{id:'access',label:'Login and access contract'}],schedules:[],
    stages:['dev','gamma','prod'].map<PipelineStageChoice>((id,index)=>({id,label:['Development','Gamma','Production'][index]!,promotion:index===0?'automatic':'manual',strategyIds:['direct','canary','blue-green','custom'],checkIds:['health','access'],scheduleIds:[],
      defaults:{strategyId:index===1?'canary':'direct',options:Object.fromEntries(index===1?[['pace','careful']]:[]),checkIds:['health','access'],rollback:index===0?'disabled':'manual'}}))};
}
