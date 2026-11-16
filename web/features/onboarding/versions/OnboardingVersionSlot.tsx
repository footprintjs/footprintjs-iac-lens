import { lazy, Suspense } from 'react';
import type { DashboardState } from '../../../../src/core/types.ts';
import type { OnboardingVersionAction } from '../../../../src/core/onboarding-versions.ts';
const OnboardingVersionPanel = lazy(() => import('./OnboardingVersionPanel.tsx'));

/** Version controls remain outside the initial dashboard and legacy onboarding chunks. */
export function OnboardingVersionSlot({ state, posting, technical, onAction }: { state: DashboardState; posting: boolean; technical?: boolean; onAction?(input: OnboardingVersionAction): void }) {
  if (!state.onboardingRegistry) return null;
  return <Suspense fallback={<div role="status">Reading setup versions…</div>}><OnboardingVersionPanel state={state} posting={posting} technical={technical} onAction={onAction}/></Suspense>;
}
