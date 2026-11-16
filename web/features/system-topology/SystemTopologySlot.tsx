import { Component, lazy, Suspense, type ReactNode } from 'react';
import type {DashboardState} from '../../../src/core/types.ts';
import type {RecordedDeploymentStep} from '../../../src/core/topology-deployment-step.ts';
import type { SystemTopologyView } from 'footprintjs-iac/system-topology';
const Graph = lazy(() => import('./SystemTopologyGraph.tsx'));
class TopologyBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <section role="alert"><h2>The system view could not open</h2><p>Native recordings are retained. Reload Lens to try again.</p></section> : this.props.children; }
}
/** Optional architecture feature; neither core protocol nor server imports React. */
export function SystemTopologySlot({ view, simple, state, onRecordedStep }: { view: SystemTopologyView; simple?: boolean; state?:DashboardState; onRecordedStep?(step:RecordedDeploymentStep):void }) {
  return <TopologyBoundary key={view.definition.digest}><Suspense fallback={<section role="status">Opening system view…</section>}><Graph view={view} simple={simple} state={state} onRecordedStep={onRecordedStep}/></Suspense></TopologyBoundary>;
}
