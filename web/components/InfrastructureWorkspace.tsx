import { useState } from 'react';
import type { DashboardState } from '../../src/core/types.ts';
import { workspaceViews, type View } from '../lib/workspace-views.ts';
import { projectDeploymentFlow } from '../../src/core/deployment-flow.ts';
import { deploymentStepTitle } from '../lib/deployment-flow-view.ts';
import { ArtifactsView } from './ArtifactsView.tsx';
import { DeploymentFlow } from './DeploymentFlow.tsx';
import { EvidenceSource, type EvidenceKind } from './EvidenceSource.tsx';
import { Icon } from './Icon.tsx';
import { Inspector } from './Inspector.tsx';
import { RunningSystem } from './RunningSystem.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import './synchronized-workspace.css';
import { DetailsPanel } from './DetailsPanel.tsx';

export function InfrastructureWorkspace({ state, view, selected, evidenceKind, fitWindow = false, onView, onSelect, onConnectionSelect, onEvidenceKind }: {
  state: DashboardState;
  view: View;
  selected?: string;
  evidenceKind: EvidenceKind;
  fitWindow?: boolean;
  onView(view: View): void;
  onSelect(id?: string): void;
  onConnectionSelect(id: string): void;
  onEvidenceKind(kind: EvidenceKind): void;
}) {
  const [inspectionOpen, setInspectionOpen] = useState(false);
  const resource = state.graph?.resources.find(item => item.id === selected);
  const step = resource && projectDeploymentFlow(state).nodes.find(item => item.id === selected);
  const graphVisible = view === 'deployment' || view === 'system';
  const resourceCount = state.graph?.resources.length ?? 0;
  const componentCount = state.systemTopology?.definition.nodes.length ?? 0;
  const inventoryCount = state.systemTopology ? `${componentCount} ${componentCount === 1 ? 'component' : 'components'} · ${resourceCount} deployment ${resourceCount === 1 ? 'resource' : 'resources'}` : `${resourceCount} resources`;
  const counterpart = view === 'deployment' ? 'system' : 'deployment';
  const inspectEvidence = (kind: EvidenceKind) => { setInspectionOpen(false); onEvidenceKind(kind); onView('evidence'); };
  const inspectResource = (id?: string) => { onSelect(id); setInspectionOpen(!!id); };

  return <section className="workbench synchronized-workspace" aria-label="Infrastructure workspace">
    <div className="workbench-main">
      <div className="workbench-toolbar">
        <div className="view-tabs" role="tablist" aria-label="Infrastructure view">
          {workspaceViews.map(tab => <button key={tab.id} id={`view-${tab.id}`} role="tab"
            aria-selected={view === tab.id} aria-controls="infrastructure-panel"
            onClick={() => onView(tab.id)} className={view === tab.id ? 'view-tab active' : 'view-tab'}>
            <Icon name={tab.icon} size={16}/>{tab.name}
          </button>)}
        </div>
        <span className="graph-count">{inventoryCount}</span>
      </div>
      {resource && step && view !== 'artifacts' && <div className="resource-selection" aria-label="Shared resource selection">
        <div><strong>{deploymentStepTitle(step)}</strong><code>{resource.id}</code>
          <StatusBadge status={step.progress.status} action={step.progress.action}/>
          {view === 'evidence' && evidenceKind === 'deployment' && step.progress.runtimeStageId && <code>{step.progress.runtimeStageId}</code>}</div>
        <div>{fitWindow && <button className="button button-secondary" onClick={() => setInspectionOpen(true)}>Inspect resource</button>}
          <button className="button button-secondary" onClick={() => onView(counterpart)}>
          {counterpart === 'system' ? 'Show in running system' : 'Show in deployment flow'}<Icon name="arrow" size={14}/>
        </button><button className="icon-button" onClick={() => inspectResource(undefined)} aria-label="Clear resource selection"><Icon name="close" size={16}/></button></div>
      </div>}
      <div id="infrastructure-panel" role="tabpanel" aria-labelledby={`view-${view}`}>
        {view === 'deployment' ? <DeploymentFlow state={state} selected={selected} fitWindow={fitWindow} onSelect={inspectResource}/>
          : view === 'system' ? <RunningSystem state={state} selected={selected} fitWindow={fitWindow} onSelect={inspectResource} onConnectionSelect={onConnectionSelect}/>
            : view === 'evidence' ? <EvidenceSource state={state} kind={evidenceKind} selectedResource={selected} onKind={onEvidenceKind}/>
              : <ArtifactsView artifacts={state.artifacts ?? []}/>}
      </div>
      {resource && graphVisible && (fitWindow
        ? inspectionOpen && <DetailsPanel title={step ? deploymentStepTitle(step) : resource.id} onClose={() => setInspectionOpen(false)}>
          <Inspector state={state} resource={resource} onClose={() => setInspectionOpen(false)} onEvidence={inspectEvidence}/>
        </DetailsPanel>
        : <Inspector state={state} resource={resource} onClose={() => onSelect(undefined)} onEvidence={inspectEvidence}/>) }
    </div>
  </section>;
}
