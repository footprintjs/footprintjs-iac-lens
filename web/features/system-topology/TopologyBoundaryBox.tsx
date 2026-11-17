import type { TopologyBoundaryView } from 'footprintjs-iac/system-topology';
import type { TopologyBox } from './topology-layout.ts';
import { TechnologyMark } from './TechnologyMark.tsx';
const labels = { pending: 'Waiting', installing: 'Installing', starting: 'Starting', checking: 'Checking', connected: 'Connected', ready: 'Ready', failed: 'Needs attention', unknown: 'Not verified', incomplete: 'Recording incomplete', skipped: 'Skipped', removed: 'Removed' };
export function TopologyBoundaryBox({ boundary, box, onSelect }: { boundary: TopologyBoundaryView; box: TopologyBox; onSelect?(): void }) {
  const status = boundary.status === 'pending' && !boundary.observed ? 'Placement declared' : labels[boundary.status];
  const heading=<><strong title={boundary.label}>{boundary.label}</strong><span>{boundary.technology ? <TechnologyMark technology={boundary.technology}/> : boundary.kind}</span><small>{status}</small></>;
  return <div className={`topology-boundary topology-${boundary.status}`}
    style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    data-boundary-id={boundary.id} data-parent-id={boundary.parentId}>
    {onSelect?<button type="button" className="topology-boundary-heading" onClick={onSelect} aria-label={`${boundary.label} · ${boundary.kind} · ${status}`}>{heading}</button>:<div className="topology-boundary-heading">{heading}</div>}
    <div className="topology-boundary-progress-track"><div className={`topology-boundary-progress${boundary.progress.indeterminate ? ' indeterminate' : ''}`}
      role="progressbar" aria-label={`${boundary.label}: recorded component progress`} aria-valuemin={0}
      aria-valuemax={boundary.progress.total || undefined} aria-valuenow={boundary.progress.indeterminate ? undefined : boundary.progress.completed}
      aria-valuetext={boundary.progress.indeterminate ? 'Not fully verified' : `${boundary.progress.completed} of ${boundary.progress.total} observed`}
      style={{ width: `${boundary.progress.total ? boundary.progress.completed / boundary.progress.total * 100 : 0}%` }}/></div>
  </div>;
}
