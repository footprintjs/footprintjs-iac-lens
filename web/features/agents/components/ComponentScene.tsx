import { useEffect, useId, useMemo, useState } from 'react';
import type { AgentComponentGraphView } from '../../../../src/core/agent-components.ts';
import type { AgentStatus } from '../../../../src/core/agent-platform.ts';
import { DetailsPanel } from '../../../components/DetailsPanel.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { agentHeadline, statusLabels } from '../model.ts';
import { BoundaryOutline } from './BoundaryOutline.tsx';
import { ComponentNode } from './ComponentNode.tsx';
import { ComponentRelations } from './ComponentRelations.tsx';
import { ComponentDetails } from './ComponentDetails.tsx';
import { visibleComponentView } from './model.ts';
import { layoutComponentGraph } from './layout.ts';
import componentStyles from './components.css' with { type: 'text' };

type Selection = { kind: 'node' | 'boundary'; id: string };
export interface ComponentSceneProps { view: AgentComponentGraphView; status: AgentStatus; technical: boolean; description?: string }

/** A lazy viewer of admitted component observations. It owns no executor, timers or provider effects. */
export default function ComponentScene({ view, status, technical, description }: ComponentSceneProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set()), [selection, setSelection] = useState<Selection>();
  useEffect(() => { setSelection(undefined); setCollapsed(new Set()); }, [view.digest]);
  const displayView = useMemo(() => visibleComponentView(view, technical), [view, technical]);
  const layout = useMemo(() => layoutComponentGraph(displayView, collapsed), [displayView, collapsed]);
  const markerId = 'agent-component-arrow-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const selected = selection?.kind === 'node' ? view.nodes.find(node => node.id === selection.id) : view.boundaries.find(boundary => boundary.id === selection?.id);
  const toggle = (id: string) => setCollapsed(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  return <section className="agents-scene agents-component-scene" aria-label="Agent runtime component graph">
    <style>{componentStyles}</style>
    <header className="agents-scene-heading"><div><h2 aria-live="polite">{agentHeadline(status)}</h2><p>{description ?? view.label}</p></div><span className={'agents-state agents-state-' + status}>{statusLabels[status]}</span></header>
    {!view.nodes.length && !view.boundaries.length ? <div className="agent-components-empty">No component observations were supplied for this runtime.</div>
      : <div className="agent-components-viewport"><svg className="agent-components-svg" viewBox={`-14 -10 ${layout.width + 28} ${layout.height + 20}`} role="group" aria-label={view.label}>
        <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 10 5 0 10Z"/></marker></defs>
        {layout.boundaries.map(box => { const boundary = view.boundaries.find(boundary => boundary.id === box.id)!; return <BoundaryOutline key={box.id} boundary={boundary} box={box} onInspect={() => setSelection({ kind: 'boundary', id: boundary.id })} onToggle={() => toggle(boundary.id)}/>; })}
        <ComponentRelations view={displayView} layout={layout} markerId={markerId} technical={technical} onInspect={id => setSelection({ kind: 'node', id })}/>
        {layout.nodes.map(box => { const node = view.nodes.find(node => node.id === box.id)!; return <ComponentNode key={box.id} node={node} box={box} onInspect={() => setSelection({ kind: 'node', id: node.id })}/>; })}
      </svg></div>}
    <footer className="agents-scene-note agent-component-legend"><span><i className="agent-order-sample"/>Prerequisite</span><span><i className="agent-connection-sample"/>Connection check</span><span><Icon name="graph" size={13}/>Borders follow recorded work</span></footer>
    {selection && <DetailsPanel title={selected?.label ?? 'Recorded component'} onClose={() => setSelection(undefined)}><ComponentDetails view={view} selection={selection}/></DetailsPanel>}
  </section>;
}
