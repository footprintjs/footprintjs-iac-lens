import { useState } from 'react';
import type { DashboardState, Scenario } from '../../src/core/types.ts';
import { Icon } from './Icon.tsx';

export function RunControls({ state, posting, onRun }: { state: DashboardState; posting: boolean; onRun: (scenario: Scenario) => void }) {
  const [scenario, setScenario] = useState<Scenario>('demo');
  const disabled = state.busy || posting;
  return <div className="run-controls"><label className="scenario-select"><span className="sr-only">Deployment scenario</span><select value={scenario} onChange={event => setScenario(event.target.value as Scenario)} disabled={disabled}>
    <option value="demo">Simulated deployment</option><option value="failure">Simulated failure</option><option value="neo" disabled={!state.neoAvailable}>Neo · local Kubernetes{!state.neoAvailable ? ' (not configured)' : ''}</option>
  </select></label><button className="button button-secondary" disabled={disabled || state.run?.status !== 'passed'} onClick={() => onRun('noop')} title="Reapply the current graph and verify unchanged resources">Reapply / check no-op</button>
    <button className="button button-primary" disabled={disabled || (scenario === 'neo' && !state.neoAvailable)} onClick={() => onRun(scenario)}><Icon name="play" size={16}/>{disabled ? 'Deployment running' : scenario === 'neo' ? 'Deploy Neo locally' : 'Run simulation'}</button>
  </div>;
}
