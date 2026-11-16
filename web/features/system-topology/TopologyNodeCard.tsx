import type { TopologyNodeView } from 'footprintjs-iac/system-topology';
import type { TopologyBox } from './topology-layout.ts';
import { TechnologyMark } from './TechnologyMark.tsx';
const categories = { compute: 'Compute', storage: 'Storage', network: 'Network', identity: 'Identity & access', other: 'Component' };
export function TopologyNodeCard({ node, box, onSelect }: { node: TopologyNodeView; box: TopologyBox; onSelect(): void }) {
  return <button type="button" className={`topology-node topology-${node.status}`}
    style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    data-component-id={node.id} data-origin={node.origin} onClick={onSelect}
    aria-label={`${categories[node.category]} · ${node.label} · ${node.originLabel} · ${node.statusLabel}`}>
    <span className="topology-node-category">{categories[node.category]}</span><strong title={node.label}>{node.label}</strong>
    <TechnologyMark technology={node.technology} category={node.category}/>
    <span className={`topology-origin origin-${node.origin}`}>{node.originLabel}</span>
    <span className="topology-node-status" aria-live="polite"><i/>{node.statusLabel}
      {node.evidenceScope === 'shared-resource' && <small title="One shared provider operation"> · shared operation</small>}
    </span>
  </button>;
}
