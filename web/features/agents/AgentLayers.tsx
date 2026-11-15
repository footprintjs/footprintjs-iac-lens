import type { AgentLayerView, AgentView } from '../../../src/core/agent-platform.ts';
import { Icon } from '../../components/Icon.tsx';
import { AgentGlyph } from './AgentGlyph.tsx';
import { agentHeadline, statusLabels } from './model.ts';

const layerNames = { infrastructure: 'Infrastructure', environment: 'Environment', agent: 'Agent' };
const layerOrder = ['infrastructure', 'environment', 'agent'] as const;

/** These are responsibility layers, not an inferred chronological deployment schedule. */
export function AgentLayers({ agent, technical, onLayer }: { agent: AgentView; technical: boolean; onLayer(layer: AgentLayerView): void }) {
  return <section className="agents-scene" aria-label="Agent deployment layers">
    <header className="agents-scene-heading"><div><h2 aria-live="polite">{agentHeadline(agent.status)}</h2><p>{agent.description ?? agent.label}</p></div>
      <span className={'agents-state agents-state-' + agent.status}>{statusLabels[agent.status]}</span></header>
    <div className="agents-layer-flow" role="group" aria-label="Infrastructure, environment and agent readiness">
      {layerOrder.map((id, index) => {
        const layer = agent.layers.find(layer => layer.id === id) ?? { id, label: layerNames[id], status: 'unknown' as const };
        return <div className="agents-layer-pair" key={id} style={{ display: 'contents' }}>
          {index > 0 && <div className="agents-support-link" role="img" aria-label={index === 1 ? 'Infrastructure supports the environment' : 'The environment supports the agent'}><Icon name="arrow" size={28}/></div>}
          <div className="agents-layer" data-status={layer.status} aria-label={`${layer.label}: ${statusLabels[layer.status]}`}>
            <span className="agents-layer-step">{layerNames[id]}</span>
            <AgentGlyph kind={id} active={layer.status === 'running'}/>
            <strong>{layer.label}</strong><small role="status">{statusLabels[layer.status]}</small>
            {technical && layer.detail && <span className="agents-layer-detail">{layer.detail}</span>}
            <button type="button" className="agents-layer-button" onClick={() => onLayer(layer)}>{layer.recording ? 'Recorded flow' : 'View details'}</button>
          </div>
        </div>;
      })}
    </div>
    <div className="agents-scene-note"><Icon name="graph" size={14}/><span>Arrows show support between layers. Progress comes from recorded work.</span></div>
  </section>;
}
