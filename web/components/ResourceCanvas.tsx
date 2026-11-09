import { useMemo } from 'react';
import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, type NodeProps } from '@xyflow/react';
import { buildResourceView, type ResourceFlowNode } from '../lib/resource-view.ts';
import type { DashboardState } from '../../src/core/types.ts';
import { Icon } from './Icon.tsx';
import { StatusBadge } from './StatusBadge.tsx';

function ResourceNode({ data, selected }: NodeProps<ResourceFlowNode>) {
  return <div className={`resource-node resource-${data.progress.status}${selected ? ' resource-selected' : ''}`}>
    <Handle type="target" position={Position.Left} className="resource-handle"/>
    <div className="resource-heading"><span className={`resource-icon family-${data.description.family}`}><Icon name={data.description.family}/></span>
      <div className="resource-name"><span>{data.description.name}</span><small>{data.description.kind}</small></div>
      <span className={`resource-state-mark mark-${data.progress.status}`}><Icon name={data.progress.status === 'ready' ? 'check' : data.progress.status === 'failed' ? 'close' : 'clock'} size={15}/></span>
    </div>
    <div className="resource-footer"><span className="resource-capability">{data.description.capability ?? data.description.family}</span><StatusBadge status={data.progress.status}/></div>
    <Handle type="source" position={Position.Right} className="resource-handle"/>
  </div>;
}
const nodeTypes = { resource: ResourceNode };

export function ResourceCanvas({ state, selected, onSelect }: { state: DashboardState; selected?: string; onSelect: (id: string | undefined) => void }) {
  const view = useMemo(() => buildResourceView(state, selected), [state, selected]);
  if (!view.nodes.length) return <div className="canvas-empty"><Icon name="graph" size={38}/><h3>No resource graph available</h3><p>A validated desired graph will appear here before deployment begins.</p></div>;
  return <div className="resource-canvas" data-testid="resource-canvas">
    <ReactFlow nodes={view.nodes} edges={view.edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: .07, maxZoom: 1 }}
      minZoom={.25} maxZoom={1.6} nodesDraggable={false} nodesConnectable={false} elementsSelectable
      onNodeClick={(_, node) => onSelect(node.id)} onPaneClick={() => onSelect(undefined)} proOptions={{ hideAttribution: false }}>
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#dce2e9"/>
      <Controls showInteractive={false} position="bottom-left"/>
    </ReactFlow>
  </div>;
}
