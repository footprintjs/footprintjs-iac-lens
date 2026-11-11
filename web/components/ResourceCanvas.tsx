import { useMemo } from 'react';
import { Background, BackgroundVariant, BaseEdge, Controls, Handle, Position, ReactFlow, type EdgeProps, type NodeProps, type FitViewOptions } from '@xyflow/react';
import { buildResourceView, type ResourceFlowEdge, type ResourceFlowNode } from '../lib/resource-view.ts';
import { resourceEdgePath, type ResourceLayoutMode } from '../../src/core/layout.ts';
import { COMMUNICATION_SOURCE_OFFSET, COMMUNICATION_TARGET_OFFSET } from '../../src/core/resource-geometry.ts';
import type { DashboardState } from '../../src/core/types.ts';
import { Icon } from './Icon.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { CanvasFit } from './CanvasFit.tsx';

function ResourceNode({ data, selected }: NodeProps<ResourceFlowNode>) {
  return <div className={`resource-node resource-${data.progress.status}${selected ? ' resource-selected' : ''}`} style={{ height: data.size.height }}>
    {data.deploymentHandles && <Handle id="order-in" type="target" position={Position.Left} className="resource-handle"/>}
    <div className="resource-heading"><span className={`resource-icon family-${data.description.family}`}><Icon name={data.description.family}/></span>
      <div className="resource-name"><span>{data.description.name}</span><small>{data.description.kind}</small></div>
      <span className={`resource-state-mark mark-${data.progress.status}`}><Icon name={data.progress.status === 'ready' ? 'check' : data.progress.status === 'failed' ? 'close' : 'clock'} size={15}/></span>
    </div>
    <div className="resource-footer"><span className="resource-capability">{data.description.capability ?? data.description.family}</span><StatusBadge status={data.progress.status}/></div>
    {data.deploymentHandles && <Handle id="order-out" type="source" position={Position.Right} className="resource-handle"/>}
    {data.communicationSource && <Handle id="communication-out" type="source" position={Position.Bottom} style={{ left: `${COMMUNICATION_SOURCE_OFFSET * 100}%` }} className="resource-handle resource-communication-handle"/>}
    {data.communicationTarget && <Handle id="communication-in" type="target" position={Position.Bottom} style={{ left: `${COMMUNICATION_TARGET_OFFSET * 100}%` }} className="resource-handle resource-communication-handle"/>}
  </div>;
}
const nodeTypes = { resource: ResourceNode };

function ResourceEdge({ id, data, markerEnd, style }: EdgeProps<ResourceFlowEdge>) {
  if (!data) return null;
  return <BaseEdge id={id} path={resourceEdgePath(data.route.points)} markerEnd={markerEnd} style={style}
    label={data.label}
    labelX={data.route.labelPosition?.x} labelY={data.route.labelPosition?.y}
    labelStyle={{ fill: style?.stroke ?? '#687d97', fontSize: 11, fontWeight: data.connectionStatus === 'untested' ? 400 : 600 }} labelBgStyle={{ fill: '#fafbfd' }} labelBgPadding={[8, 4]} labelBgBorderRadius={4}/>;
}
const edgeTypes = { resource: ResourceEdge };

export function ResourceCanvas({ state, selected, mode, fitWindow = false, onSelect, onConnectionSelect }: { state: DashboardState; selected?: string; mode?: ResourceLayoutMode; fitWindow?: boolean; onSelect: (id: string | undefined) => void; onConnectionSelect?: (id: string) => void }) {
  const view = useMemo(() => buildResourceView(state, selected, mode), [state, selected, mode]);
  if (!view.nodes.length) return <div className="canvas-empty"><Icon name="graph" size={38}/><h3>No resource graph available</h3><p>A validated desired graph will appear here before deployment begins.</p></div>;
  const nodeBottom = Math.max(...view.nodes.map(node => node.position.y + node.data.size.height));
  const laneSpace = Math.max(0, ...view.edges.flatMap(edge => edge.data?.route.points.map(point => point.y - nodeBottom) ?? []));
  const padding: FitViewOptions['padding'] = { top: '24px', left: '32px', right: '48px', bottom: `${laneSpace + 26}px` };
  const layoutKey = JSON.stringify(view.nodes.map(node => [node.id, node.position.x, node.position.y, node.width, node.height]));
  return <div className="resource-canvas" data-testid="resource-canvas">
    <ReactFlow nodes={view.nodes} edges={view.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView
      fitViewOptions={{ padding, minZoom: fitWindow ? .15 : mode === 'running-system' ? .35 : .7, maxZoom: 1 }}
      minZoom={fitWindow ? .15 : .25} maxZoom={1.6} nodesDraggable={false} nodesConnectable={false} elementsSelectable
      onNodeClick={(_, node) => onSelect(node.id)} onEdgeClick={(_, edge) => { if (edge.data?.kind === 'communication') onConnectionSelect?.(edge.id); }}
      onPaneClick={() => onSelect(undefined)} proOptions={{ hideAttribution: false }}>
      <CanvasFit enabled={fitWindow} layoutKey={layoutKey} padding={padding}/>
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#dce2e9"/>
      <Controls showInteractive={false} position="bottom-left"/>
    </ReactFlow>
  </div>;
}
