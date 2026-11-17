import type {DashboardState} from '../../../src/core/types.ts';
import type {RunRecord} from '../../../src/core/run-history.ts';
import {projectAdapterDeployment} from '../../../src/core/adapter-deployment.ts';
import {isCurrentRun,recordedFrame} from './model.ts';

/** Both diagrams select one publication. A terminal recording is never a source for an earlier moment. */
export function selectRunMoment(record:RunRecord|undefined,index:number,liveState:DashboardState,following:boolean) {
 const frame=record&&recordedFrame(record,index);
 if(record&&following&&isCurrentRun(record.summary,liveState,record))return{frame,state:liveState,deployment:projectAdapterDeployment(liveState)};
 return{frame,state:frame?.state,deployment:frame?.deployment};
}
