import type { DashboardState } from '../../src/core/types.ts';
import type { HostActionInput } from '../../src/core/host-actions.ts';
export function HostActionButtons({ state, posting, onAction }: { state: DashboardState; posting: boolean; onAction?(input: HostActionInput): void }) {
  if (!state.hostActions?.controls.length || !onAction) return null;
  const disabled = posting || state.busy || state.hostActions.busy || state.resourceFlow?.status !== 'passed';
  return <div className="host-action-buttons" aria-label="Configured system actions">{state.hostActions.controls.map(control => <button key={control.id} className="simple-button simple-secondary" title={control.description}
    disabled={disabled} onClick={() => onAction({ actionId: control.id })}>{control.label}</button>)}</div>;
}
