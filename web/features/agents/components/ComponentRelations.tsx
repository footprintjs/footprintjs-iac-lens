import type { AgentComponentGraphView } from '../../../../src/core/agent-components.ts';
import type { ComponentLayout, SceneBox } from './layout.ts';

function visibleBox(id: string, view: AgentComponentGraphView, layout: ComponentLayout): SceneBox | undefined {
  const visible = [...layout.nodes, ...layout.boundaries], direct = visible.find(box => box.id === id);
  if (direct) return direct;
  let parent = view.nodes.find(node => node.id === id)?.boundaryId ?? view.boundaries.find(boundary => boundary.id === id)?.parentId;
  for (let count = 0; parent && count <= view.boundaries.length; count++) {
    const found = visible.find(box => box.id === parent); if (found) return found;
    parent = view.boundaries.find(boundary => boundary.id === parent)?.parentId;
  }
}

export function ComponentRelations({ view, layout, markerId, technical, onInspect }: { view: AgentComponentGraphView; layout: ComponentLayout; markerId: string; technical: boolean; onInspect(id: string): void }) {
  return <g className="agent-component-relations">{view.relations.filter(edge => edge.kind !== 'contains').map(edge => {
    const from = visibleBox(edge.from, view, layout), to = visibleBox(edge.to, view, layout);
    if (!from || !to || from.id === to.id) return null;
    const right = to.x + to.width / 2 >= from.x + from.width / 2;
    const startX = right ? from.x + from.width : from.x, endX = right ? to.x : to.x + to.width;
    const startY = from.y + from.height / 2, endY = to.y + to.height / 2;
    const bend = Math.max(22, Math.abs(endX - startX) * .45), sign = right ? 1 : -1;
    const path = `M${startX},${startY}C${startX + sign * bend},${startY} ${endX - sign * bend},${endY} ${endX},${endY}`;
    const status = edge.kind === 'communicatesWith' ? edge.status ?? 'untested' : 'order';
    const label = edge.kind === 'order' ? `Deployment prerequisite: ${edge.from} → ${edge.to}` : edge.kind === 'communicatesWith' ? `Connection: ${edge.from} to ${edge.to}, ${status}` : `Support: ${edge.from} to ${edge.to}`;
    const checkId = edge.kind === 'communicatesWith' ? edge.checkComponentId : undefined;
    return <g key={edge.id} className="agent-component-edge" data-kind={edge.kind} data-status={status} role={checkId ? 'button' : 'img'} tabIndex={checkId ? 0 : undefined} aria-label={checkId ? `Inspect ${label}` : label} onClick={checkId ? () => onInspect(checkId) : undefined} onKeyDown={checkId ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onInspect(checkId); } } : undefined}>
      {checkId && <path className="agent-component-edge-hit" d={path}/>}
      <path d={path} markerEnd={edge.kind === 'order' ? `url(#${markerId})` : undefined}/>
      <title>{label}</title>{technical && edge.kind === 'communicatesWith' && <text x={(startX + endX) / 2} y={(startY + endY) / 2 - 6} textAnchor="middle">{status === 'untested' ? 'Not checked' : status}</text>}
    </g>;
  })}</g>;
}
