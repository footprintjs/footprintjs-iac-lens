import type { DeploymentFlow, DeploymentFlowNode } from '../../src/core/deployment-flow.ts';

export function DeploymentWaitDetails({ node, columns }: { node: DeploymentFlowNode; columns: DeploymentFlow['columns'] }) {
  const schedule = node.schedule;
  if (!schedule) return <p>Wait reasons were not recorded for this step.</p>;
  const capacity = schedule.capacity;
  const offset = node.scheduleOffset ?? 0;
  const fullBatches = capacity && columns.filter(column => column.index - offset >= capacity.fromBatch && column.index - offset <= capacity.throughBatch);
  const barrier = columns.find(column => column.index - offset === schedule.batchBarrier);
  return <dl className="deployment-wait-details">
    <div><dt>Scheduled batch</dt><dd>{node.column - offset}</dd></div>
    {schedule.dependencies.map(dep => <div key={dep.resourceId}><dt>Dependency</dt><dd>Needs {dep.attributes.length ? dep.attributes.map(attribute => `${dep.resourceId}.${attribute}`).join(', ') : dep.resourceId}.</dd></div>)}
    {fullBatches && <div><dt>Capacity</dt><dd>{fullBatches.map(batch => <p key={batch.index}>Batch {batch.index - offset} assigned all {capacity.limit} slots to {batch.resourceIds.join(', ')}.</p>)}</dd></div>}
    {barrier && <div><dt>Batch barrier</dt><dd>Starts after batch {barrier.index - offset} settles ({barrier.resourceIds.join(', ')}).</dd></div>}
    {node.failureGate && <div><dt>Failure gate</dt><dd>{node.failureGate.resourceId ? `Skipped after ${node.failureGate.resourceId} failed.` : 'Skipped after a preceding step failed.'}</dd></div>}
    {!schedule.dependencies.length && !capacity && !barrier && !node.failureGate && <div><dt>Wait</dt><dd>No recorded scheduling wait.</dd></div>}
  </dl>;
}
