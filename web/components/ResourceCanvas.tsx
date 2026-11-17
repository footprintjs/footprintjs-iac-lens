import { createContext, useContext, useMemo } from 'react';
import { BackgroundVariant, BaseEdge, Controls, Handle, Position, type EdgeProps, type NodeProps } from '@xyflow/react';
import {FootprintTheme,TracedFlow} from 'footprint-explainable-ui/flowchart';
import { buildResourceView, type ResourceFlowEdge } from '../lib/resource-view.ts';
import {createResourceTraceGraph,resourceTraceBounds,type ResourceTraceNode} from '../lib/create-resource-trace-graph.ts';
import {useDiagramCamera} from '../lib/diagram-camera.ts';
import { resourceEdgePath, type ResourceLayoutMode } from '../../src/core/layout.ts';
import { COMMUNICATION_SOURCE_OFFSET, COMMUNICATION_TARGET_OFFSET } from '../../src/core/resource-geometry.ts';
import type { DashboardState } from '../../src/core/types.ts';
import { Icon } from './Icon.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import {useLensTheme} from '../theme/LensThemeContext.tsx';

function ResourceNode({ data:renderData, selected }: NodeProps<ResourceTraceNode>) {
  const data=renderData.resourceView;
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

const ResourceEdgeContext=createContext<{edges:ReadonlyMap<string,ResourceFlowEdge>;onConnectionSelect?:(id:string)=>void}>({edges:new Map()});

function ResourceEdge({ id, markerEnd, style }: EdgeProps<ResourceFlowEdge>) {
  const {edges,onConnectionSelect}=useContext(ResourceEdgeContext);
  const data=edges.get(id)?.data;
  if (!data) return null;
  const inspect=data.kind==='communication'&&onConnectionSelect?()=>onConnectionSelect(id):undefined;
  return <g role={inspect?'button':undefined} tabIndex={inspect?0:undefined} aria-label={edges.get(id)?.ariaLabel}
    onClick={inspect?event=>{event.stopPropagation();inspect();}:undefined}
    onKeyDown={inspect?event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();inspect();}}:undefined}>
    <BaseEdge id={id} path={resourceEdgePath(data.route.points)} markerEnd={markerEnd} style={style}
    label={data.label}
    labelX={data.route.labelPosition?.x} labelY={data.route.labelPosition?.y}
    labelStyle={{ fill: style?.stroke ?? 'var(--fp-text-secondary)', fontSize: 11, fontWeight: data.connectionStatus === 'untested' ? 400 : 600 }} labelBgStyle={{ fill: 'var(--fp-bg-elevated)' }} labelBgPadding={[8, 4]} labelBgBorderRadius={4}/>
  </g>;
}
const edgeTypes = { resource: ResourceEdge };

export function ResourceCanvas({ state, selected, mode, fitWindow = false, onSelect, onConnectionSelect }: { state: DashboardState; selected?: string; mode?: ResourceLayoutMode; fitWindow?: boolean; onSelect: (id: string | undefined) => void; onConnectionSelect?: (id: string) => void }) {
  const theme=useLensTheme();
  const view = useMemo(() => buildResourceView(state, selected, mode), [state, selected, mode]);
  const graph=useMemo(()=>createResourceTraceGraph(view),[view]);
  const bounds=useMemo(()=>resourceTraceBounds(view),[view]);
  const camera=useDiagramCamera(bounds);
  const edgeContext=useMemo(()=>({edges:new Map(view.edges.map(edge=>[edge.id,edge])),onConnectionSelect}),[view,onConnectionSelect]);
  if (!view.nodes.length) return <div className="canvas-empty"><Icon name="graph" size={38}/><h3>No resource graph available</h3><p>A validated desired graph will appear here before deployment begins.</p></div>;
  return <div ref={camera.containerRef} className="resource-canvas" data-testid="resource-canvas" onClick={event=>{
    if(event.target instanceof Element&&event.target.classList.contains('react-flow__pane'))onSelect(undefined);
  }}>
    <ResourceEdgeContext.Provider value={edgeContext}><FootprintTheme tokens={theme.tokens}>
      <TracedFlow graph={graph} layout="passthrough" unstyled style={{minHeight:0}} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        currentSubflowId={null} breadcrumb={false} autoFit={false} viewport={camera.viewport} onViewportChange={camera.onViewportChange}
        minZoom={.01} maxZoom={1.6} onNodeClick={onSelect}
        background={{variant:BackgroundVariant.Dots,gap:22,size:1,color:'var(--fp-border)'}}>
      <Controls showInteractive={false} position="bottom-left"/>
      </TracedFlow>
    </FootprintTheme></ResourceEdgeContext.Provider>
  </div>;
}
