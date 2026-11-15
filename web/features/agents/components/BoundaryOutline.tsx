import type { CSSProperties } from 'react';
import type { SceneBox } from './layout.ts';
import { componentStatusLabels, progressPresentation, runtimeBoundaryLabel, type ComponentBoundary } from './model.ts';

const activate = (action: () => void) => (event: React.KeyboardEvent<SVGGElement>) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); }
};

/** Only native counts move the outline. An indeterminate moving segment communicates activity, not a percentage. */
export function BoundaryOutline({ boundary, box, onInspect, onToggle }: { boundary: ComponentBoundary; box: SceneBox; onInspect(): void; onToggle(): void }) {
  const progress = progressPresentation(boundary.progress), label = runtimeBoundaryLabel(boundary);
  const verified = boundary.status === 'ready' && boundary.observed && boundary.recording?.complete === true;
  const fraction = progress.fraction === undefined ? verified ? 100 : undefined : progress.fraction * 100;
  const width = Math.max(1, box.width), height = Math.max(1, box.height);
  const showCount = !box.collapsed && width >= 360;
  const maxLabel = Math.max(12, Math.floor((width - (showCount ? 170 : 52)) / 7));
  return <g className={'agent-runtime-boundary' + (box.collapsed ? ' agent-runtime-boundary-collapsed' : '')} data-status={boundary.status} data-boundary-id={boundary.id} transform={`translate(${box.x},${box.y})`} style={{ '--boundary-depth': box.depth } as CSSProperties}>
    <rect className="agent-boundary-surface" x="0" y="0" width={width} height={height} rx="14"/>
    <g role="progressbar" aria-label={`${label}: ${componentStatusLabels[boundary.status]}, ${progress.label}`} aria-valuemin={0} aria-valuenow={progress.determinate ? progress.completed : undefined} aria-valuemax={progress.determinate ? progress.total : undefined} aria-valuetext={progress.label}>
      <rect className="agent-boundary-track" x="1.5" y="1.5" width={width - 3} height={height - 3} rx="13" pathLength="100"/>
      {fraction !== undefined && fraction > 0 && <rect className="agent-boundary-progress" x="1.5" y="1.5" width={width - 3} height={height - 3} rx="13" pathLength="100" strokeDasharray={`${fraction} 100`} data-completed={progress.completed} data-total={progress.total}/>}
      {!progress.determinate && boundary.status === 'running' && <rect className="agent-boundary-progress agent-boundary-indeterminate" x="1.5" y="1.5" width={width - 3} height={height - 3} rx="13" pathLength="100" strokeDasharray="16 84"/>}
    </g>
    <g role="button" tabIndex={0} className="agent-boundary-inspect" aria-label={`Inspect ${label}`} onClick={onInspect} onKeyDown={activate(onInspect)}>
      <rect x="8" y="6" width={Math.max(1, width - 52)} height="29" rx="5" className="agent-boundary-header-hit"/>
      <text x="14" y="24" className="agent-boundary-title">{label.length > maxLabel ? label.slice(0, maxLabel - 1) + '…' : label}</text><title>{label}</title>
    </g>
    {showCount && <text x={width - 45} y="24" textAnchor="end" className="agent-boundary-inline-count">{progress.label}</text>}
    {!box.empty && <g role="button" tabIndex={0} className="agent-boundary-toggle" aria-label={`${box.collapsed ? 'Expand' : 'Collapse'} ${label}`} onClick={onToggle} onKeyDown={activate(onToggle)}>
      <rect x={width - 34} y="8" width="23" height="22" rx="5"/>
      <path d={`M${width - 28} 19h11${box.collapsed ? `M${width - 22.5} 13.5v11` : ''}`}/>
    </g>}
    {(box.collapsed || box.empty) && <><text x={width / 2} y="65" textAnchor="middle" className="agent-boundary-collapsed-state">{box.empty && verified ? 'Identity checked' : componentStatusLabels[boundary.status]}</text><text x={width / 2} y="88" textAnchor="middle" className="agent-boundary-count">{box.empty && !verified ? boundary.observed ? 'Observed boundary' : 'Identity not confirmed' : box.empty && !progress.total ? '' : progress.label}</text></>}
  </g>;
}
