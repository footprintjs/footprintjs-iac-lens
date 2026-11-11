import { Component, useMemo, type ComponentProps, type ReactNode } from 'react';
import { ExplainableShell, graphFromStructure } from 'footprint-explainable-ui';
import type { Recording } from '../../src/core/types.ts';
import { Icon } from './Icon.tsx';

class EvidenceBoundary extends Component<{ children: ReactNode }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    return this.state.error ? <div className="empty-state"><Icon name="evidence" size={35}/><h3>This recording could not be displayed</h3><p>{this.state.error}</p><p className="small">The deployment status above is unchanged. Inspect the saved evidence to investigate this display error.</p></div> : this.props.children;
  }
}

export default function EvidenceView({ recording, running, title = 'Deployment execution' }: { recording?: Recording; running: boolean; title?: string }) {
  const prepared = useMemo(() => {
    try { return { graph: recording?.structure ? graphFromStructure(recording.structure) : undefined }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [recording?.structure]);
  const graph = prepared.graph;
  if (prepared.error) return <div className="empty-state"><Icon name="evidence" size={35}/><h3>The saved chart could not be read</h3><p>{prepared.error}</p><p className="small">Recorded resource progress is still available on the system graph.</p></div>;
  if (!recording?.snapshot || !graph?.nodes.length) return <div className="empty-state evidence-empty"><span className="empty-icon"><Icon name="evidence" size={30}/></span><h3>{running ? 'The execution record is being captured' : 'The run tells its own story'}</h3><p>{running ? 'Watch live resource progress on the system graph. The native Flow Lens opens when the run’s snapshot and chart are available.' : 'Start a deployment, then inspect its stages, decisions, state changes and captured dependencies here.'}</p><span className="source-chip">Powered by FootPrint Flow Lens</span></div>;
  type ShellProps = ComponentProps<typeof ExplainableShell>;
  return <div className="evidence-view"><div className="evidence-notice"><Icon name="evidence" size={16}/><span>Native recorded execution · move the cursor to inspect captured state. Recorded dependencies describe this run; external gaps remain unknown.</span></div>
    <EvidenceBoundary key={String((recording.snapshot as { runId?: unknown }).runId ?? 'recording')}>
      <ExplainableShell runtimeSnapshot={recording.snapshot as ShellProps['runtimeSnapshot']} traceGraph={graph}
        showStageId
        narrativeEntries={recording.narrativeEntries as ShellProps['narrativeEntries']} title={title}
        traceTheme={{ mode: 'light', visited: '#317b68', current: '#3478db' }}
        panelLabels={{ topology: 'Execution structure', details: 'Recorded evidence', timeline: 'Stage timeline' }}
        defaultExpanded={{ details: true, topology: false, timeline: false }}/>
    </EvidenceBoundary>
  </div>;
}
