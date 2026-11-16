import type { TopologyConnectionView } from 'footprintjs-iac/system-topology';
import { topologyConnectionPath, type TopologyBox } from './topology-layout.ts';
import type {TopologyRoute} from './topology-routing.ts';
const labels = { untested: 'Not checked', checking: 'Checking', connected: 'Connected', failed: 'Failed', unknown: 'Unconfirmed', incomplete: 'Incomplete' };
interface Props { connections: readonly TopologyConnectionView[]; boxes: ReadonlyMap<string, TopologyBox>; routes?: ReadonlyMap<string,TopologyRoute> }
export function TopologyWires({ connections, boxes, width, height, marker, routes }: Props & { width: number; height: number; marker: string }) {
  return <svg className="topology-wires" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label="Communication connections">
    <defs><marker id={marker} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M 0 0 L 6 3 L 0 6 Z" fill="context-stroke"/></marker></defs>
    {connections.map((edge, index) => {
      const from = boxes.get(edge.from), to = boxes.get(edge.to); if (!from || !to) return null;
      const route = routes?.get(edge.id) ?? topologyConnectionPath(from, to, index % 2);
      return <g key={edge.id} className={`topology-edge edge-${edge.status}${edge.kind === 'dependsOn' ? ' edge-dependency' : ''}`}>
        <path d={route.path} markerEnd={`url(#${marker})`}/><title>{`${edge.label ?? edge.kind}: ${labels[edge.status]}`}</title>
      </g>;
    })}
  </svg>;
}
export function TopologyConnectionLabels({ connections, boxes, onSelect, routes }: Props & { onSelect(id: string): void }) {
  return <>{connections.map((edge, index) => {
    if (edge.kind !== 'communicatesWith') return null;
    const from = boxes.get(edge.from), to = boxes.get(edge.to); if (!from || !to) return null;
    const route = routes?.get(edge.id) ?? topologyConnectionPath(from, to, index % 2);
    if ('labelHidden' in route && route.labelHidden) return null;
    return <button type="button" key={edge.id} className={`topology-edge-label edge-${edge.status}`} style={{ left: route.x, top: route.y }}
      onClick={() => onSelect(edge.id)} aria-live="polite" aria-label={`${edge.label ?? `${edge.from} to ${edge.to}`}: ${labels[edge.status]}`}>{labels[edge.status]}</button>;
  })}</>;
}

/** Dense graphs retain selectable connection evidence even if a badge has no free lane. */
export function TopologyUnplacedConnections({connections,routes,onSelect}:Props&{onSelect(id:string):void}){
  const rows=connections.filter(edge=>{const route=routes?.get(edge.id);return route&&(!route.path||edge.kind==='communicatesWith'&&route.labelHidden);});
  return rows.length?<details className="topology-unplaced-connections"><summary>{rows.length} more {rows.length===1?'connection':'connections'}</summary>{rows.map(edge=><button key={edge.id} type="button" onClick={()=>onSelect(edge.id)}>{edge.label??`${edge.from} → ${edge.to}`} · {labels[edge.status]}</button>)}</details>:null;
}
