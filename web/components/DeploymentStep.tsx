import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { DeploymentStepNode } from '../lib/deployment-flow-view.ts';
import { Icon } from './Icon.tsx';
import { StatusBadge } from './StatusBadge.tsx';

export function DeploymentStep({ data, selected }: NodeProps<DeploymentStepNode>) {
  const { step, title, waiting, columnLabel } = data;
  const families = [...new Set(step.capabilities.map(unit => unit.family))];
  const action = step.progress.action === 'noop' ? 'Check existing' : step.progress.action === 'create' ? 'Create'
    : step.progress.action === 'update' ? 'Update' : step.progress.action === 'delete' ? 'Remove' : 'Resource operation';
  const stateText = step.progress.status === 'pending' ? waiting ? `Waiting for ${waiting}` : 'Not started'
    : step.progress.status === 'skipped' ? 'Not run after an earlier failure'
    : step.observed?.overlapsWith.length ? 'Work overlapped with another step'
    : step.progress.action === 'noop' && step.progress.status === 'ready' ? 'Existing resource checked' : action;
  return <div className={`deployment-step step-${step.progress.status}${selected ? ' step-selected' : ''}`}>
    {columnLabel && <span className="deployment-column-label">{columnLabel}</span>}
    <Handle type="target" position={Position.Left} className="deployment-port"/>
    <div className="deployment-step-top"><span className="deployment-step-number">{step.observed?.step ?? '·'}</span><span>{step.observed ? 'RECORDED START' : 'NOT STARTED'}</span><Icon name={step.progress.status === 'ready' ? 'check' : 'clock'} size={15}/></div>
    <strong className="deployment-step-title">{title}</strong>
    <span className="deployment-step-kind">{step.description.kind === 'Resource' ? step.resource.provider : step.description.kind}</span>
    <div className="deployment-step-families">{(families.length ? families : [step.description.family]).map(family => <span key={family}><Icon name={family} size={11}/>{family === 'other' ? 'Placement' : family}</span>)}</div>
    <div className="deployment-step-bottom"><StatusBadge status={step.progress.status} action={step.progress.action}/><small>{stateText}</small></div>
    <Handle type="source" position={Position.Right} className="deployment-port"/>
  </div>;
}
