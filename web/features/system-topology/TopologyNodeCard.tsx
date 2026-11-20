import type { TopologyNodeView } from 'footprintjs-iac/system-topology';
import type { RecordedDeploymentStep } from '../../../src/core/topology-deployment-step.ts';
import type { TopologyBox } from './topology-layout.ts';
import {TopologyNodeEvidence} from './TopologyNodeEvidence.tsx';
import { TechnologyMark } from './TechnologyMark.tsx';
import type {DiagramSymbolDefinition} from '../../../src/core/system-symbols.ts';
import {DiagramSymbol} from './DiagramSymbol.tsx';
const categories = { compute: 'Compute', storage: 'Storage', network: 'Network', identity: 'Identity & access', other: 'Component' };
export function TopologyNodeCard({ node, box, step, onSelect, onRecordedStep, executionFocus, symbol }: { node: TopologyNodeView; box: TopologyBox; step?:RecordedDeploymentStep; executionFocus?:boolean; symbol?:DiagramSymbolDefinition; onSelect?(): void; onRecordedStep?(step:RecordedDeploymentStep):void }) {
  const content=<><span className="topology-node-meta"><span className="topology-node-category">{categories[node.category]}</span><span className={`topology-origin origin-${node.origin}`}>{node.originLabel}</span></span>
    {symbol&&<DiagramSymbol symbol={symbol} className="topology-symbol-art"/>}
    <strong title={node.label}>{node.label}</strong><span className="topology-node-context"><TechnologyMark technology={node.technology} category={node.category}/>
    <span className="topology-node-status" aria-live="polite" title={node.statusLabel}><i/>{node.statusLabel}{node.evidenceScope === 'shared-resource' && <small title="One shared provider operation"> · shared operation</small>}</span></span></>;
  const label=`${categories[node.category]} · ${node.label} · ${node.originLabel} · ${node.statusLabel}`;
  return <article className={`topology-node topology-${node.status}${symbol?' topology-symbol-card':''}`}
    style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    data-component-id={node.id} data-origin={node.origin} data-execution-focus={executionFocus?'true':undefined}>
    {onSelect?<button type="button" className="topology-node-summary" onClick={onSelect} aria-label={label}>{content}</button>:<div className="topology-node-summary" aria-label={label}>{content}</div>}
    <TopologyNodeEvidence node={node} step={step} onRecordedStep={onRecordedStep}/>
  </article>;
}
