import type {TopologyNodeView} from 'footprintjs-iac/system-topology';
import type {RecordedDeploymentStep} from '../../../src/core/topology-deployment-step.ts';
import {recordedWork,recordedWorkLabels} from './recorded-work.ts';

/** Native action and verification presentation shared by cards and physical objects. */
export function TopologyNodeEvidence({node,step,onRecordedStep}:{node:TopologyNodeView;step?:RecordedDeploymentStep;onRecordedStep?(step:RecordedDeploymentStep):void}) {
  const work=recordedWork(node.actions),action=work.current?.action,runningCount=work.runningCount;
  const actionLabel=runningCount>1?`${runningCount} actions in progress`:action?.label;
  const actionStatus=work.current?.state==='confirmed'?'Done':work.current&&work.current.state!=='running'?recordedWorkLabels[work.current.state]:'';
  const progress=node.progress,measured=progress.total>0,verified=measured?`${progress.completed} of ${progress.total} checks verified`:'No verification checks registered';
 return <>
    {actionLabel&&(step&&onRecordedStep?<button type="button" className={`topology-node-action action-${action!.status}`} aria-label={`Show deployment step for ${node.label}`} title={actionLabel} onClick={()=>onRecordedStep(step)}><span>{actionLabel}</span><span className="topology-action-result">{actionStatus}<span aria-hidden="true"> ↗</span></span></button>:<span className={`topology-node-action action-${action!.status}`} title={step?`${actionLabel}${actionStatus?' · '+actionStatus:''}`:`${actionLabel} · Native deployment step unavailable`}><span>{actionLabel}</span>{actionStatus&&<small>{actionStatus}</small>}</span>)}
    {work.count>0&&<div className="topology-recorded-work" role="group" aria-label={`${node.label}: ${work.count} recorded ${work.count===1?'step':'steps'}${work.failedCount?`; ${work.failedCount} failed`:''}${work.unknownCount?`; ${work.unknownCount} unconfirmed`:''}`} data-recorded-work-count={work.count} data-recorded-work-observed={work.observedCount}>
      <span className="topology-recorded-work-dots" aria-label="Latest recorded steps">{work.visibleSteps.map(row=><i key={row.id} className={`work-${row.state}`} role="img" title={`${row.action.label}: ${recordedWorkLabels[row.state]}`} aria-label={`${row.action.label}: ${recordedWorkLabels[row.state]}`}/>)}</span>
      <small title={work.omitted?`Latest 8 of ${work.count} recorded steps shown; full native history is retained in Details`:undefined}>{work.count} {work.count===1?'step':'steps'} recorded</small>
    </div>}
    <div className="topology-node-progress" role="progressbar" aria-label={`${node.label}: ${verified}`} aria-valuemin={0} aria-valuemax={measured?progress.total:undefined} aria-valuenow={measured?progress.completed:undefined} aria-valuetext={!measured?verified:progress.indeterminate?`${verified}; observations incomplete`:verified}>
      {measured&&<span className="topology-node-progress-track"><i style={{width:`${Math.min(100,100*progress.completed/progress.total)}%`}}/></span>}<small>{measured?`${progress.completed}/${progress.total} verified`:'Not measured'}</small>
    </div>
 </>;
}
