import { lazy, Suspense, useEffect, useState } from 'react';
import type { OnboardingVersionAction } from '../../../../src/core/onboarding-versions.ts';
import type { DashboardState } from '../../../../src/core/types.ts';
import { DetailsPanel } from '../../../components/DetailsPanel.tsx';
import { VersionReview } from './VersionReview.tsx';
import { VersionHistory } from './VersionHistory.tsx';
import { currentSetupLabel } from './model.ts';
import versionStyles from './versions.css' with { type: 'text' };

const EvidenceView = lazy(() => import('../../../components/EvidenceView.tsx'));
export default function OnboardingVersionPanel({ state, posting, technical = false, onAction }: { state: DashboardState; posting: boolean; technical?: boolean; onAction?(input: OnboardingVersionAction): void }) {
  const view = state.onboardingRegistry!, [opened, setOpened] = useState<'review' | 'history' | 'recording'>(), [selected, setSelected] = useState(view.activeVersionId), [showTechnical, setShowTechnical] = useState(technical);
  useEffect(() => { setSelected(view.activeVersionId); setOpened(undefined); }, [view.id, view.activeVersionId]);
  const disabled = posting || state.busy || view.busy;
  return <><style>{versionStyles}</style><section className="setup-version-strip" aria-label="Setup versions"><span>Setup version</span><strong>{currentSetupLabel(view)}</strong>
    {['blocked', 'incomplete'].includes(view.status) && <span className="setup-version-attention">Update needs attention</span>}
    <button type="button" disabled={disabled} onClick={() => { setSelected(view.review?.fromVersionId === view.activeVersionId && view.review.head === view.head ? view.review.toVersionId : view.activeVersionId); setOpened('review'); }}>{view.review ? 'Review setup update' : 'Change setup'}</button><button type="button" onClick={() => setOpened('history')}>Version history</button>
  </section>
  {opened && <DetailsPanel title={opened === 'review' ? 'Review setup update' : opened === 'history' ? 'Setup version history' : 'Configuration update recording'} onClose={() => setOpened(undefined)}><div className="setup-version-panel">
    {opened === 'review' ? <VersionReview view={view} selected={selected} setSelected={setSelected} disabled={disabled} technical={showTechnical} onTechnical={() => setShowTechnical(!showTechnical)} onAction={onAction}/>
      : opened === 'history' ? <VersionHistory view={view}/> : <Suspense fallback={<p>Opening native update recording…</p>}><EvidenceView recording={state.onboardingRegistryRecording} running={view.busy} title="Configuration update"/></Suspense>}
    {opened !== 'recording' && <button type="button" className="setup-version-text-button" disabled={!state.onboardingRegistryRecording} onClick={() => setOpened('recording')}>Inspect update recording</button>}
  </div></DetailsPanel>}
  </>;
}
