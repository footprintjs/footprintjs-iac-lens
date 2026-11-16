import { Component, lazy, Suspense, type ReactNode } from 'react';
import type { DashboardState } from '../../../src/core/types.ts';
import type { OnboardingAction } from '../../../src/core/onboarding.ts';

const OnboardingPanel = lazy(() => import('./OnboardingPanel.tsx'));
class SetupBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <section className="onboarding-fallback" role="alert"><h2>Setup view could not open</h2><p>The application recording is retained. Reload Lens to open this view again.</p></section> : this.props.children; }
}
/** The optional feature is loaded only for a registered onboarding host. */
export function OnboardingSlot({ state, posting, technical, onAction }: { state: DashboardState; posting: boolean; technical?: boolean; onAction?(input: OnboardingAction): void }) {
  if (!state.onboarding) return null;
  return <SetupBoundary><Suspense fallback={<section role="status">Opening setup…</section>}><OnboardingPanel state={state} posting={posting} technical={technical} onAction={onAction}/></Suspense></SetupBoundary>;
}
