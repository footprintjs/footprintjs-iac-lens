import { neoIdentityChecks,type IdentityTarget } from 'footprintjs-iac/integration/identity';
import type { NeoDeliveryBaseline,NeoDeliveryObservation } from 'footprintjs-iac/integration/identity/github-delivery';
import type { DashboardRun } from '../../src/core/types.ts';
import type { DeliveryPublication } from '../../src/server/delivery.ts';
import { untestedConnections } from '../../src/core/connections.ts';
import { untestedIdentity } from '../../src/core/identity.ts';
import { neoIdentitySystemView } from '../neo-identity/system-view.ts';
import { createNeoDeliveryProjection,neoDeliveryBaselineRun } from '../neo-github-delivery/projection.ts';
export interface NeoEnvironmentView { id:string;label:string;target:IdentityTarget;baseline:NeoDeliveryBaseline }
/** Registered graph identity selects the environment; each keeps its own latest proven system and checks. */
export function createNeoEnvironmentProjection(environments:NeoEnvironmentView[],loadRun:(baseline:NeoDeliveryBaseline)=>Promise<DashboardRun>=neoDeliveryBaselineRun){
  if(!environments.length||new Set(environments.map(view=>view.baseline.graph.name)).size!==environments.length)throw Error('Register distinct Neo environment graph identities');
  const views=new Map<string,DeliveryPublication>(),projects=new Map<string,ReturnType<typeof createNeoDeliveryProjection>>();
  return async(event:NeoDeliveryObservation):Promise<DeliveryPublication>=>{
    const selected=environments.find(view=>view.baseline.graph.name===event.graph.name);
    if(!selected||event.kind==='applied'&&event.target.id!==selected.target.id)throw Error('A Neo observation is outside its registered environment');
    let previous=views.get(selected.id),project=projects.get(selected.id);
    if(!previous){
      const run=await loadRun(selected.baseline);
      previous={graph:selected.baseline.graph,run,recording:run.recording,connections:untestedConnections(selected.baseline.graph),
        identity:untestedIdentity(neoIdentityChecks.map(({id,label,kind,expected})=>({checkId:id,label,kind,expected})),'Real Neo sign-in and access'),appAccess:{status:'checking'}};
      project=createNeoDeliveryProjection();projects.set(selected.id,project);
    }
    const next:DeliveryPublication={...previous,...await project!(event),target:{id:selected.target.id,context:selected.target.context,namespace:selected.target.namespace,label:selected.label},
      systemView:neoIdentitySystemView(selected.target),neoUrl:`http://127.0.0.1:${selected.target.neoPort}/?test`};
    views.set(selected.id,next);return next;
  };
}
