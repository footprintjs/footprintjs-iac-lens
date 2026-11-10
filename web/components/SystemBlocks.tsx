import { useState } from 'react';
import { projectSystemBlocks, unmappedSystemResources, type SystemBlockStatus, type SystemBlockView } from '../../src/core/capabilities.ts';
import type { DashboardState } from '../../src/core/types.ts';
import { Icon } from './Icon.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import './system-blocks.css';

const labels: Record<SystemBlockStatus, string> = {
  pending: 'Pending', deploying: 'Started', ready: 'Ready', failed: 'Failed', skipped: 'Skipped', deleted: 'Deleted',
  existing: 'Existing', unmapped: 'Unmapped',
};

function Block({ block, onSelect }: { block: SystemBlockView; onSelect(id: string): void }) {
  const [expanded, setExpanded] = useState(false);
  return <article className={`system-block system-${block.status}`}>
    <button className="system-block-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} aria-label={`${block.label} · ${expanded ? 'hide' : 'show'} units`}>
      <span className={`system-family-icon system-family-${block.family}`}><Icon name={block.family === 'other' ? 'graph' : block.family} size={19}/></span>
      <span className="system-block-title"><strong>{block.label}</strong><small>{block.counts.total ? `${block.counts.ready} of ${block.counts.total} declared units ready` : block.counts.existing ? `${block.counts.existing} existing prerequisites` : 'No mapped units'}</small></span>
      <span className={`system-status system-status-${block.status}`}><i/>{labels[block.status]}</span><Icon name="chevron" size={12} style={{ transform: expanded ? 'rotate(90deg)' : undefined }}/>
    </button>
    {block.counts.total > 0 && <progress className="system-block-progress" max={block.counts.total} value={block.counts.ready} aria-label={`${block.label} ready units`}/>}
    {expanded && <div className="system-block-body">
      {block.description && <p className="system-block-description">{block.description}</p>}
      <ul className="system-unit-list">{block.units.map(unit => <li key={unit.id} className={`system-unit system-unit-${unit.status}`}>
        <div className="system-unit-heading"><span>{unit.label}</span><span className={`system-status system-status-${unit.status}`}><i/>{labels[unit.status]}</span></div>
        <div className="system-unit-mode">{unit.mode === 'embedded' ? 'Embedded · follows runtime initialization and readiness' : unit.mode === 'existing' ? 'Existing prerequisite · no creation requested' : 'Mapped infrastructure'}</div>
        {unit.description && <p>{unit.description}</p>}
        {unit.resources.length > 0 && <ul className="system-resource-list">{unit.resources.map(resource => <li key={resource.id}><button onClick={() => onSelect(resource.id)} title={resource.id}>
          <span><strong>{resource.name}</strong><small>{resource.kind}</small></span><StatusBadge status={resource.status} action={resource.action}/>
        </button></li>)}</ul>}
        {unit.unmappedResourceIds.length > 0 && <p className="system-unmapped">Not in the desired graph: {unit.unmappedResourceIds.join(', ')}</p>}
        {unit.status === 'unmapped' && !unit.unmappedResourceIds.length && <p className="system-unmapped">No current resource binding; readiness is not established.</p>}
      </li>)}</ul>
    </div>}
  </article>;
}

/** A logical system view over the same resource events as the detailed graph. */
export function SystemBlocks({ state, onSelect }: { state: DashboardState; onSelect(id: string): void }) {
  const blocks = projectSystemBlocks(state);
  if (!blocks.length) return null;
  const ready = blocks.reduce((sum, block) => sum + block.counts.ready, 0), total = blocks.reduce((sum, block) => sum + block.counts.total, 0);
  const unmapped = unmappedSystemResources(state, blocks);
  return <section className="system-design" aria-label="System design capability progress">
    <div className="system-design-heading"><div><span className="eyebrow">SYSTEM DESIGN</span><h2>From capabilities to running infrastructure</h2></div><span>{total ? `${ready} of ${total} declared units ready` : blocks.every(block => block.status === 'existing') ? 'Existing prerequisites only' : 'No provisioned units mapped'}</span></div>
    <div className="system-block-grid">{blocks.map(block => <Block key={block.id} block={block} onSelect={onSelect}/>)}</div>
    <p className="system-design-note">Ready follows the mapped resources. Embedded state shares its runtime's readiness; existing prerequisites are not provisioned here.</p>
    {unmapped.length > 0 && <p className="system-unmapped">{unmapped.length} {unmapped.length === 1 ? 'resource has' : 'resources have'} no capability mapping and remain visible in the detailed graph.</p>}
  </section>;
}
