import type { AgentView } from '../../../src/core/agent-platform.ts';
import { RecordingSummary } from './AgentDetails.tsx';
import { statusLabels, type RecordedTurnRow } from './model.ts';
import { RecordedStages } from './RecordedStages.tsx';

export function ConversationDetails({ agent, row }: { agent: AgentView; row: RecordedTurnRow }) {
  return <div className="agents-details"><dl><div><dt>Agent</dt><dd>{agent.label}</dd></div><div><dt>Conversation</dt><dd><code>{row.conversationId}</code></dd></div>
    <div><dt>Observed revision</dt><dd>{row.revisionId ? <code>{row.revisionId}</code> : 'Not supplied by this recording'}</dd></div>
    <div><dt>Turn</dt><dd><code>{row.turn.id}</code></dd></div><div><dt>Current outcome</dt><dd>{statusLabels[row.turn.status]}</dd></div></dl>
    <RecordedStages stages={row.turn.stages} title="Recorded agent flow" empty="No native stages were supplied for this turn."/>
    <RecordingSummary reference={row.turn.recording}/>
    <div className="agents-limitation">This summary contains recorded stage identities and outcomes. Prompts, tool arguments, results and private credentials are not loaded into this view.</div>
  </div>;
}
