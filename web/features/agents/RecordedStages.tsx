import type { AgentStageView } from '../../../src/core/agent-platform.ts';
import { statusLabels } from './model.ts';

/** Keep the host's admitted stage order and outcome; no clocks or transition events are created here. */
export function RecordedStages({ stages, title = 'Recorded flow', empty = 'No native stages were supplied.' }: {
  stages: readonly AgentStageView[]; title?: string; empty?: string;
}) {
  return <section><h3>{title}</h3>{stages.length ? <ol className="agents-turn-flow" aria-label="Recorded subflow stages">{stages.map((stage, index) => <li key={`${stage.runtimeStageId ?? stage.id}:${stage.sequence ?? index}`} data-status={stage.status}>
    <strong>{stage.label}</strong><span className={'agents-state agents-state-' + stage.status}>{statusLabels[stage.status]}</span>
    {stage.kind && <small>{stage.kind === 'decision' ? 'Decision' : stage.kind === 'tool' ? 'Tool call' : stage.kind === 'model' ? 'Model call' : 'Recorded stage'}</small>}
    {stage.sequence !== undefined && <small>Sequence {stage.sequence}</small>}{stage.runtimeStageId && <small><code>{stage.runtimeStageId}</code></small>}
  </li>)}</ol> : <p>{empty}</p>}</section>;
}
