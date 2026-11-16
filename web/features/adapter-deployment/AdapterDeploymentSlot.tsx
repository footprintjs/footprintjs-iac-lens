import type {RecordedDeploymentStep} from '../../../src/core/topology-deployment-step.ts';
import {lazy, Suspense} from 'react';
import type {DashboardState} from '../../../src/core/types.ts';
import type {AdapterDeploymentView} from '../../../src/core/adapter-deployment.ts';
const AdapterDeploymentFlow = lazy(()=>import('./AdapterDeploymentFlow.tsx'));
export function AdapterDeploymentSlot({state,view,fitWindow,recordedStep,onClearRecordedStep}:{recordedStep?:RecordedDeploymentStep;onClearRecordedStep?():void;state:DashboardState;view:AdapterDeploymentView;fitWindow:boolean}) {
  return <Suspense fallback={<p className="adapter-opening" role="status">Opening recorded deployment steps…</p>}><AdapterDeploymentFlow state={state} view={view} fitWindow={fitWindow} recordedStep={recordedStep} onClearRecordedStep={onClearRecordedStep}/></Suspense>;
}
