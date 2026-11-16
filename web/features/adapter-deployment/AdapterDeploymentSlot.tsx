import {lazy, Suspense} from 'react';
import type {DashboardState} from '../../../src/core/types.ts';
import type {AdapterDeploymentView} from '../../../src/core/adapter-deployment.ts';
const AdapterDeploymentFlow = lazy(()=>import('./AdapterDeploymentFlow.tsx'));
export function AdapterDeploymentSlot({state,view,fitWindow}:{state:DashboardState;view:AdapterDeploymentView;fitWindow:boolean}) {
  return <Suspense fallback={<p className="adapter-opening" role="status">Opening recorded deployment steps…</p>}><AdapterDeploymentFlow state={state} view={view} fitWindow={fitWindow}/></Suspense>;
}
