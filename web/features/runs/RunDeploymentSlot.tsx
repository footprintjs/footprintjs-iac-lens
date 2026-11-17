import {lazy,Suspense} from 'react';
import type {DashboardState} from '../../../src/core/types.ts';
import type {AdapterDeploymentView} from '../../../src/core/adapter-deployment.ts';
const RunDeploymentScene=lazy(()=>import('./RunDeploymentScene.tsx'));
export function RunDeploymentSlot({state,deployment}:{state:DashboardState;deployment?:AdapterDeploymentView}) {
 return <Suspense fallback={<p role="status" className="run-diagram-opening">Opening recorded steps…</p>}><RunDeploymentScene state={state} deployment={deployment}/></Suspense>;
}
