import type { DashboardState } from '../../src/core/types.ts';
import { familyCounts } from '../../src/core/model.ts';
import { projectSystemBlocks } from '../../src/core/capabilities.ts';
import { Icon } from './Icon.tsx';
import { workspaceViews, type View } from '../lib/workspace-views.ts';

export type { View } from '../lib/workspace-views.ts';
export function Sidebar({ view, onView, state }: { view: View; onView: (view: View) => void; state: DashboardState }) {
  const counts = familyCounts(state);
  const blocks = projectSystemBlocks(state);
  const families = state.systemTopology ? (['compute','storage','network','identity','other'] as const).map(family => ({family, count: state.systemTopology!.definition.nodes.filter(node => node.category === family).length})).filter(row => row.family !== 'other' || row.count > 0) : blocks.length ? [...new Set(blocks.map(block => block.family))].map(family => ({ family,
    count: blocks.filter(block => block.family === family).reduce((sum, block) => sum + block.counts.total, 0) }))
    : (['compute', 'storage', 'network'] as const).map(family => ({ family, count: counts[family] }));
  return <aside className="sidebar"><div className="workspace-label">WORKSPACE</div><div className="workspace-card"><span className="workspace-mark"><Icon name="graph" size={18}/></span><div><strong>Infrastructure</strong><small>Local development</small></div></div>
    <div className="nav-label">EXPLORE</div><nav aria-label="Dashboard views">{workspaceViews.map(item => <button key={item.id} onClick={() => onView(item.id)} className={view === item.id ? 'nav-item active' : 'nav-item'} aria-current={view === item.id ? 'page' : undefined}><Icon name={item.icon} size={18}/>{item.name}{item.id === 'artifacts' && !!state.artifacts?.length && <span className="nav-count">{state.artifacts.length}</span>}</button>)}</nav>
    <div className="nav-label capability-label">{state.systemTopology ? 'COMPONENTS' : blocks.length ? 'CAPABILITIES' : 'RESOURCE FAMILIES'}</div><div className="capability-list">{families.map(({ family, count }) => <div key={family}><Icon name={family === 'other' ? 'graph' : family} size={16}/><span>{family}</span><strong>{count}</strong></div>)}</div>
    <div className="sidebar-bottom"><span className="sidebar-note-icon"><Icon name="evidence" size={18}/></span><strong>Evidence, as it happens.</strong><p>Progress comes from the native recorder. Every recorded outcome has a place in the graph.</p><span className="sidebar-version">InfraChart Lens <span>LOCAL</span></span></div>
  </aside>;
}
