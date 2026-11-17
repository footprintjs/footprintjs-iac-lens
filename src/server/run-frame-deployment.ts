import {projectAdapterDeployment,type AdapterDeploymentView} from '../core/adapter-deployment.ts';
import {readRunFrameDeployment,RUN_FRAME_DEPLOYMENT_MAX_BYTES} from '../core/run-history-deployment.ts';
import type {DashboardState} from '../core/types.ts';

/** Store only what native admission knows now; the full capture stays once on the completed run. */
export function runFrameDeployment(state:DashboardState,frameState:DashboardState):AdapterDeploymentView {
 const unavailable=(warning:string):AdapterDeploymentView=>({available:false,...state.run?.id?{runId:state.run.id}:{},resources:[],warnings:[warning]});
 try{
  const value=projectAdapterDeployment(state);
  if(!value.available&&!value.warnings.length)value.warnings.push('No adapter subflow evidence was available at this recorded moment.');
  if(new TextEncoder().encode(JSON.stringify(value)).byteLength>RUN_FRAME_DEPLOYMENT_MAX_BYTES)return unavailable('The adapter steps exceed this bounded replay moment. The complete native recording is retained separately.');
  return readRunFrameDeployment(JSON.parse(JSON.stringify(value)),frameState);
 }catch{return unavailable('Adapter step evidence was unavailable at this recorded moment. No later recording is used to fill it in.');}
}
