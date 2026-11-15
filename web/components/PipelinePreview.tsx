import type { PipelineView } from '../../src/core/pipeline.ts';
/** This graph describes configuration. It is never treated as execution evidence. */
export function PipelinePreview({view}:{view:PipelineView}) {
  return <div className="pipeline-preview" aria-label="Configuration preview"><div className="pipeline-section-label">Configuration preview <span>No deployment effects</span></div>
    <div className="pipeline-preview-columns" style={{gridTemplateColumns:`repeat(${Math.min(view.catalog.stages.length,3)}, minmax(0,1fr))`}}>{view.catalog.stages.map(stage=><div key={stage.id}><strong>{stage.label}</strong><div>{view.preview?.steps.filter(step=>step.stageId===stage.id).map((step,index)=><span className="pipeline-preview-step" key={step.id}>{index>0&&<i aria-hidden="true">→</i>}{step.label}</span>)??<span className="pipeline-muted">Preview to see the flow</span>}</div></div>)}</div>
    {view.preview?.warnings.map(message=><small key={message}>{message}</small>)}</div>;
}
