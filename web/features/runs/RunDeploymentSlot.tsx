import {lazy,Suspense} from 'react';
import type {DashboardState} from '../../../src/core/types.ts';
import type {AdapterDeploymentView} from '../../../src/core/adapter-deployment.ts';
import type {ExecutionFollowPlan} from '../../../src/core/execution-follow.ts';
import type {FollowScopeContext} from './follow-scope-context.ts';
const RunDeploymentScene=lazy(()=>import('./RunDeploymentScene.tsx'));
export function RunDeploymentSlot({state,deployment,executionPlan,cameraContext,onExplore}:{state:DashboardState;deployment?:AdapterDeploymentView;executionPlan?:ExecutionFollowPlan;cameraContext?:FollowScopeContext;onExplore?():void}) {
 return <Suspense fallback={<p role="status" className="run-diagram-opening">Opening recorded steps…</p>}><RunDeploymentScene state={state} deployment={deployment} executionPlan={executionPlan} cameraContext={cameraContext} onExplore={onExplore}/></Suspense>;
}
