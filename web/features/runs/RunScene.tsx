import type {DashboardState} from '../../../src/core/types.ts';
import {SystemTopologySlot} from '../system-topology/SystemTopologySlot.tsx';
import {Icon} from '../../components/Icon.tsx';
import type {AdapterDeploymentView} from '../../../src/core/adapter-deployment.ts';
import {RunDeploymentSlot} from './RunDeploymentSlot.tsx';
/** The scene consumes one actual recorded publication, not reconstructed installation guesses. */
export function RunScene({state,caption,deployment}:{state?:DashboardState;caption:string;deployment?:AdapterDeploymentView}) {
 return <section className="run-scene run-synchronized-scene" aria-label="Synchronized deployment and running system">
  {state?<><section className="run-diagram-pane run-deployment-pane" aria-label="Deployment at selected moment"><header><span>01</span><h3>Deployment flow</h3><small>What is happening</small></header><RunDeploymentSlot state={state} deployment={deployment}/></section>
   <section className="run-diagram-pane run-system-pane" aria-label="System at selected moment"><header><span>02</span><h3>Running system</h3><small>Where it happens</small></header>{state.systemTopology?<SystemTopologySlot view={state.systemTopology} state={state} simple inspectable={false} renderer="isometric"/>:<div className="run-scene-placeholder"><span><Icon name="graph" size={50}/></span><strong>{caption}</strong><p>No system placement was recorded for this moment.</p></div>}</section></>:<div className="run-scene-placeholder"><span><Icon name="graph" size={50}/></span><strong>{caption}</strong><p>The recorded work appears here as it happens.</p></div>}
 </section>;
}
