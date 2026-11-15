import { useEffect, useState } from 'react';
import type { AgentLayerView, AgentPlatformView } from '../../../src/core/agent-platform.ts';
import type { DashboardState } from '../../../src/core/types.ts';
import { DetailsPanel } from '../../components/DetailsPanel.tsx';
import { Icon } from '../../components/Icon.tsx';
import { AgentLayers } from './AgentLayers.tsx';
import { AgentDetails, LayerDetails } from './AgentDetails.tsx';
import { ConversationDetails } from './ConversationDetails.tsx';
import { recordedTurnRows, selectedAgent, statusLabels } from './model.ts';
import agentStyles from './agent-platform.css' with { type: 'text' };

export interface AgentWorkspaceProps {
  state: DashboardState; view: AgentPlatformView; posting: boolean; technical?: boolean; selectedAgentId?: string;
  onCheck(agentId: string): void; onRefresh(): void; onInfrastructure(): void;
}
type Panel = { kind: 'agent' } | { kind: 'layer'; id: AgentLayerView['id'] } | { kind: 'turn'; conversationId: string; turnId: string };

/** Optional view: all identities and outcomes come from the admitted host catalog and native records. */
export default function AgentWorkspace({ state, view, posting = false, technical = false, selectedAgentId, onCheck, onRefresh, onInfrastructure }: AgentWorkspaceProps) {
  const [selectedId, setSelectedId] = useState(selectedAgentId), [panel, setPanel] = useState<Panel>();
  const agent = selectedAgent(view, selectedId);
  useEffect(() => { setPanel(undefined); }, [agent?.id]);
  const disabled = posting || view.busy || state.busy;
  const turns = agent ? recordedTurnRows(agent) : [];
  const selectedLayer = panel?.kind === 'layer' ? agent?.layers.find(layer => layer.id === panel.id) : undefined;
  const selectedTurn = panel?.kind === 'turn' ? turns.find(row => row.conversationId === panel.conversationId && row.turn.id === panel.turnId) : undefined;
  const visibleTurns = turns.slice(0, 5);
  const unavailable = agent?.capabilities.filter(capability => capability.status !== 'supported').length ?? 0;
  return <main className="agents-workspace" aria-label="Agents workspace">
    <style>{agentStyles}</style>
    <header className="agents-heading"><div><span className="agents-eyebrow">Agent platform</span><h1>{view.label}</h1><p>From deployment to recorded agent activity</p></div>
      <div className="agents-actions"><button className="agents-button" onClick={onInfrastructure} type="button"><Icon name="compute" size={14}/>Manage deployment</button>
        <button className="agents-button" onClick={onRefresh} disabled={disabled} type="button">{view.busy ? 'Reading records…' : 'Refresh records'}</button></div></header>
    {view.error && <div className="agents-limitation" role="status">{view.error}</div>}
    {!view.agents.length ? <div className="agents-empty"><Icon name="graph" size={34}/><h2>No agents registered</h2><p>This app has not supplied an agent catalog yet. Its infrastructure is still available in the deployment view.</p></div>
      : <div className="agents-main"><nav className="agents-catalog" aria-label="Registered agents"><span className="agents-catalog-title">{view.agents.length} {view.agents.length === 1 ? 'agent' : 'agents'}</span>
        {view.agents.map(item => <button type="button" className="agents-catalog-card" aria-pressed={item.id === agent?.id} key={item.id} onClick={() => { setSelectedId(item.id); setPanel(undefined); }}>
          <span className="agents-card-top"><span className="agents-card-symbol"><Icon name="graph" size={17}/></span><strong>{item.label}</strong></span>
          <span className={'agents-state agents-state-' + item.status}>{statusLabels[item.status]}</span>
          {item.revisionLabel && <small>{item.revisionLabel}</small>}{technical && item.revisionId && <small>{item.revisionId}</small>}
        </button>)}</nav>
        {agent && <div className="agents-content"><div className="agents-selected-tools"><div><span className="agents-eyebrow">Selected agent</span><strong>{agent.label}</strong></div>
          <div className="agents-actions"><button type="button" className="agents-button" onClick={() => setPanel({ kind: 'agent' })}>{technical ? 'Agent details' : 'Details'}{unavailable > 0 && <span aria-label={`${unavailable} unconfirmed or unsupported capabilities`}> · {unavailable}</span>}</button>
            <button type="button" className="agents-button agents-button-primary" disabled={disabled || !agent.canCheck || agent.status === 'incomplete'} onClick={() => onCheck(agent.id)}>{view.busy ? 'Checking…' : 'Check agent'}</button></div></div>
          <AgentLayers agent={agent} technical={technical} onLayer={layer => setPanel({ kind: 'layer', id: layer.id })}/>
          <section className="agents-activity" aria-label="Recorded conversations"><header className="agents-activity-header"><h3>Conversation activity</h3><span>{agent.conversations.length} recorded {agent.conversations.length === 1 ? 'conversation' : 'conversations'}</span></header>
            <div className="agents-activity-body">{!agent.conversations.length ? <p className="agents-activity-empty">No recorded conversations yet. Only admitted activity appears here.</p>
              : !visibleTurns.length ? <p className="agents-activity-empty">No recorded turns were supplied for these conversations.</p>
              : visibleTurns.map(row => <button className="agents-activity-row" type="button" key={`${row.conversationId}:${row.turn.id}`} onClick={() => setPanel({ kind: 'turn', conversationId: row.conversationId, turnId: row.turn.id })}>
                <Icon name="graph" size={15}/><strong>{row.turn.label ?? row.conversationLabel}</strong><span className={'agents-state agents-state-' + row.turn.status}>{statusLabels[row.turn.status]}</span>
                {technical && <small>{row.turn.id}</small>}<Icon name="chevron" size={13}/></button>)}
              {turns.length > visibleTurns.length && <p className="agents-activity-empty">Showing {visibleTurns.length} of {turns.length} admitted turns.</p>}</div></section>
        </div>}
      </div>}
    <footer className="agents-footer"><span><i/>Native FootPrint records</span>{view.limitations[0] && <span>{view.limitations[0]}</span>}</footer>
    {panel && agent && <DetailsPanel title={panel.kind === 'agent' ? agent.label : panel.kind === 'layer' ? selectedLayer?.label ?? 'Recorded layer' : 'Recorded agent turn'} onClose={() => setPanel(undefined)}>
      {panel.kind === 'agent' ? <AgentDetails agent={agent}/> : selectedLayer ? <LayerDetails agent={agent} layer={selectedLayer} state={state}/> : selectedTurn ? <ConversationDetails agent={agent} row={selectedTurn}/> : <p>This record is outside the current admitted view. Choose another layer or turn to inspect its current facts.</p>}
      {view.limitations.slice(1).map((limitation, index) => <p key={index} className="agents-limitation">{limitation}</p>)}
    </DetailsPanel>}
  </main>;
}
