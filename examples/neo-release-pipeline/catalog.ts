import type { PipelineCatalog } from '../../src/core/pipeline.ts';
import type { NeoReleasePipelineOptions } from 'footprintjs-iac/integration/identity/release-pipeline';

/** Neo is a consumer: supported capabilities are declared here, never added to the Lens core. */
export function neoReleasePipelineCatalog(options:NeoReleasePipelineOptions):PipelineCatalog {
  return {id:options.id??'neo-release-pipeline',label:'Neo deployment',simulation:false,
    releases:options.releases.map(({manifest})=>({id:manifest.id,label:manifest.label??manifest.id,kind:'prepared',version:manifest.source.ref,commit:manifest.source.commit,digest:manifest.digest})),
    strategies:[{id:'direct',label:'Direct update',description:'Assess changes, update Neo, then measure connections, login and access. External stores are unchanged; default in-memory sessions reset on restart.',rollback:false,options:[]}],
    // Acceptance is mandatory in this consumer; it is not a browser-selectable bypass.
    checks:[],schedules:[],stages:options.environments.map(environment=>({id:environment.id,label:environment.label,promotion:environment.promotion,strategyIds:['direct'],checkIds:[],scheduleIds:[],defaults:{strategyId:'direct',options:{},checkIds:[],rollback:'disabled'}}))};
}
