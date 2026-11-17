import {readDashboardState} from '../core/client.ts';
import type {DashboardState} from '../core/types.ts';

/** Preserve the public picture, not live controls, secret-profile capabilities or repeated native scope payloads. */
export function runFrameState(state:DashboardState,verification:{appVerified:boolean;appUrl?:string}):DashboardState {
 const value:DashboardState={revision:state.revision,graph:state.graph,busy:state.busy,
  ...(state.mode?{mode:state.mode}:{}),...(state.target?{target:state.target}:{}),
  ...(state.systemTopology?{systemTopology:state.systemTopology}:{}),
  ...(verification.appVerified?{...verification.appUrl?{neoUrl:verification.appUrl}:{},appAccess:{status:'ready' as const,...state.appAccess?.checkedAt?{checkedAt:state.appAccess.checkedAt}:{}}}:{}),
  ...(state.run?{run:{id:state.run.id,status:state.run.status,...state.run.mode?{mode:state.run.mode}:{},resources:state.run.resources,events:state.run.events}}:{}),
 };
 return readDashboardState(JSON.parse(JSON.stringify(value)));
}
