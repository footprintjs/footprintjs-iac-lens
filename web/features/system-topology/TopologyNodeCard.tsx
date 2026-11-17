import type { TopologyNodeView } from 'footprintjs-iac/system-topology';
import type { RecordedDeploymentStep } from '../../../src/core/topology-deployment-step.ts';
import type { TopologyBox } from './topology-layout.ts';
import {currentTopologyAction} from './node-action.ts';
import { TechnologyMark } from './TechnologyMark.tsx';
const categories = { compute: 'Compute', storage: 'Storage', network: 'Network', identity: 'Identity & access', other: 'Component' };
export function TopologyNodeCard({ node, box, step, onSelect, onRecordedStep }: { node: TopologyNodeView; box: TopologyBox; step?:RecordedDeploymentStep; onSelect?(): void; onRecordedStep?(step:RecordedDeploymentStep):void }) {
  const {action,runningCount}=currentTopologyAction(node);
  const actionLabel=runningCount>1?`${runningCount} actions in progress`:action?.label;
  const actionStatus=action?.status==='passed'?(action.evidence.complete?'Done':'Observed'):action?.status==='failed'?'Failed':action?.status==='unknown'?'Unconfirmed':'';
  const progress=node.progress,measured=progress.total>0,verified=measured?`${progress.completed} of ${progress.total} checks verified`:'No verification checks registered';
  const content=<><span className="topology-node-meta"><span className="topology-node-category">{categories[node.category]}</span><span className={`topology-origin origin-${node.origin}`}>{node.originLabel}</span></span>
    <strong title={node.label}>{node.label}</strong><TechnologyMark technology={node.technology} category={node.category}/>
    <span className="topology-node-status" aria-live="polite"><i/>{node.statusLabel}{node.evidenceScope === 'shared-resource' && <small title="One shared provider operation"> · shared operation</small>}</span></>;
  const label=`${categories[node.category]} · ${node.label} · ${node.originLabel} · ${node.statusLabel}`;
  return <article className={`topology-node topology-${node.status}`}
    style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    data-component-id={node.id} data-origin={node.origin}>
    {onSelect?<button type="button" className="topology-node-summary" onClick={onSelect} aria-label={label}>{content}</button>:<div className="topology-node-summary" aria-label={label}>{content}</div>}
    {actionLabel&&(step&&onRecordedStep?<button type="button" className={`topology-node-action action-${action!.status}`} aria-label={`Show deployment step for ${node.label}`} title={actionLabel} onClick={()=>onRecordedStep(step)}><span>{actionLabel}</span><span className="topology-action-result">{actionStatus}<span aria-hidden="true"> ↗</span></span></button>:<span className={`topology-node-action action-${action!.status}`} title={`${actionLabel} · Native deployment step unavailable`}><span>{actionLabel}</span>{actionStatus&&<small>{actionStatus}</small>}</span>)}
    <div className="topology-node-progress" role="progressbar" aria-label={`${node.label}: ${verified}`} aria-valuemin={0} aria-valuemax={measured?progress.total:undefined} aria-valuenow={measured?progress.completed:undefined} aria-valuetext={!measured?verified:progress.indeterminate?`${verified}; observations incomplete`:verified}>
      {measured&&<span className="topology-node-progress-track"><i style={{width:`${Math.min(100,100*progress.completed/progress.total)}%`}}/></span>}<small>{measured?`${progress.completed}/${progress.total} verified`:'Not measured'}</small>
    </div>
  </article>;
}
