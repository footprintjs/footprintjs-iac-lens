import { lazy, Suspense } from 'react';
import type { DashboardState } from '../../src/core/types.ts';
const EvidenceView = lazy(() => import('./EvidenceView.tsx'));

export type EvidenceKind = 'deployment' | 'connections' | 'identity';
export function EvidenceSource({ state, kind, onKind }: { state: DashboardState; kind: EvidenceKind; onKind(kind: EvidenceKind): void }) {
  const connection = kind === 'connections';
  const identity = kind === 'identity';
  return <><div className="evidence-source"><label>Recorded flow <select value={kind} onChange={event => onKind(event.target.value as EvidenceKind)}>
    <option value="deployment">Resource deployment</option><option value="connections">Connection checks</option>{state.identity && <option value="identity">Identity and access checks</option>}</select></label>
    {connection && <span>Native connection run · {state.connections?.id || 'not started'}</span>}{identity && <span>Native identity run · {state.identity?.id || 'not started'}</span>}</div>
    <Suspense fallback={<div className="empty-state"><p>Opening Flow Lens…</p></div>}><EvidenceView
      title={identity ? 'Identity and access checks' : connection ? 'Connection checks' : 'Deployment execution'}
      recording={identity ? state.identity?.recording : connection ? state.connections?.recording : state.run?.recording ?? state.recording}
      running={identity ? state.identity?.status === 'checking' : connection ? state.connections?.status === 'checking' : state.run?.status === 'running'}/></Suspense></>;
}
