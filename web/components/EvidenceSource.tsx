import { lazy, Suspense, useEffect, useState } from 'react';
import type { DashboardState } from '../../src/core/types.ts';
import { ResourceFlowEvidence } from './ResourceFlowEvidence.tsx';
const EvidenceView = lazy(() => import('./EvidenceView.tsx'));

export type EvidenceKind = 'deployment' | 'connections' | 'identity' | 'workflow';
export function EvidenceSource({ state, kind, selectedResource, onKind }: { state: DashboardState; kind: EvidenceKind; selectedResource?: string; onKind(kind: EvidenceKind): void }) {
  const [childRunId, setChildRunId] = useState<string>();
  useEffect(() => { setChildRunId(undefined); }, [selectedResource]);
  const connection = kind === 'connections';
  const identity = kind === 'identity';
  const workflow = kind === 'workflow' && !!state.resourceFlow;
  const children = state.resourceFlowWorkspace?.children.filter(child => child.run.recording) ?? [];
  const selectedChild = children.find(child => child.run.id === childRunId)
    ?? (selectedResource ? children.findLast(child => child.graph.resources.some(resource => resource.id === selectedResource)) : undefined)
    ?? children.find(child => child.run.id === state.run?.id) ?? children.at(-1);
  return <><div className="evidence-source"><label>Recorded flow <select value={kind} onChange={event => onKind(event.target.value as EvidenceKind)}>
    {state.resourceFlow && <option value="workflow">Workflow orchestration</option>}<option value="deployment">Resource deployment</option><option value="connections">Connection checks</option>{state.identity && <option value="identity">Identity and access checks</option>}</select></label>
    {connection && <span>Native connection run · {state.connections?.id || 'not started'}</span>}{identity && <span>Native identity run · {state.identity?.id || 'not started'}</span>}</div>
    {workflow ? <ResourceFlowEvidence state={state}/> : <>
    {!connection && !identity && !!children.length && <div className="resource-flow-child-evidence"><label>Resource run<select value={selectedChild?.run.id ?? ''} onChange={event => setChildRunId(event.target.value)}>{children.map(child => <option key={child.run.id} value={child.run.id}>{child.phase === 'acquire' ? 'Acquire' : 'Connect'} · {child.graph.resources.length} resources · {child.run.id}</option>)}</select></label><span>Actual native resource run; the system graph also includes the other workflow phases.</span></div>}
    <Suspense fallback={<div className="empty-state"><p>Opening Flow Lens…</p></div>}><EvidenceView
      title={identity ? 'Identity and access checks' : connection ? 'Connection checks' : 'Deployment execution'}
      recording={identity ? state.identity?.recording : connection ? state.connections?.recording : selectedChild?.run.recording ?? state.run?.recording ?? state.recording}
      running={identity ? state.identity?.status === 'checking' : connection ? state.connections?.status === 'checking' : selectedChild ? selectedChild.run.status === 'running' : state.run?.status === 'running'}/></Suspense></>}
    </>;
}
