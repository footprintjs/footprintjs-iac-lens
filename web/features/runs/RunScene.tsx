import {useMemo} from 'react';
import type {DashboardState} from '../../../src/core/types.ts';
import {selectExecutionFollow} from '../../../src/core/execution-follow.ts';
import {SystemTopologySlot} from '../system-topology/SystemTopologySlot.tsx';
import {Icon} from '../../components/Icon.tsx';
import type {AdapterDeploymentView} from '../../../src/core/adapter-deployment.ts';
import {RunDeploymentSlot} from './RunDeploymentSlot.tsx';
import type {FollowScopeContext} from './follow-scope-context.ts';
import type {SystemFollowContext} from './system-follow-context.ts';
/** The scene consumes one actual recorded publication, not reconstructed installation guesses. */
export function RunScene({state,caption,deployment,followExecution=false,cameraContext,systemCameraContext,onExplore}:{state?:DashboardState;caption:string;deployment?:AdapterDeploymentView;followExecution?:boolean;cameraContext?:FollowScopeContext;systemCameraContext?:SystemFollowContext;onExplore?():void}) {
 const plan=useMemo(()=>followExecution?selectExecutionFollow(deployment,state?.systemTopology):undefined,[followExecution,deployment,state?.systemTopology]);
 return <section className="run-scene run-synchronized-scene" aria-label="Synchronized deployment and running system" data-follow-execution={followExecution} data-follow-active-stage-ids={JSON.stringify(plan?.activeStageIds??[])}>
  {state?<><section className="run-diagram-pane run-deployment-pane" aria-label="Deployment at selected moment"><header><span>01</span><h3>Deployment flow</h3><small>What is happening</small></header><RunDeploymentSlot state={state} deployment={deployment} executionPlan={plan} cameraContext={cameraContext} onExplore={onExplore}/></section>
   <section className="run-diagram-pane run-system-pane" aria-label="System at selected moment" onPointerDownCapture={onExplore} onWheelCapture={onExplore} onKeyDownCapture={event=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','+','-','Enter',' '].includes(event.key))onExplore?.();}}><header><span>02</span><h3>Running system</h3><small>Where it happens</small></header>{state.systemTopology?<SystemTopologySlot view={state.systemTopology} state={state} simple inspectable renderer="isometric" executionFocus={plan}
    cameraFollow={{enabled:followExecution,focus:systemCameraContext?.focus??plan,held:systemCameraContext?.held,runKey:JSON.stringify([state.run?.id,state.systemTopology.definition.digest,state.systemTopology.observations.configurationDigest])}}/>:<div className="run-scene-placeholder"><span><Icon name="graph" size={50}/></span><strong>{caption}</strong><p>No system placement was recorded for this moment.</p></div>}</section></>:<div className="run-scene-placeholder"><span><Icon name="graph" size={50}/></span><strong>{caption}</strong><p>The recorded work appears here as it happens.</p></div>}
 </section>;
}
