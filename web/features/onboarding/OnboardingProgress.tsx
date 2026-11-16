import type { OnboardingSnapshot } from '../../../src/core/onboarding.ts';
import { Icon } from '../../components/Icon.tsx';
import { OnboardingCheckList } from './OnboardingChecks.tsx';

const statuses = { pending: 'Waiting', running: 'Working', passed: 'Ready', failed: 'Needs attention', unknown: 'Not confirmed' };

/** Keeps completed setup evidence available without squeezing the system graph. */
export function OnboardingProgress({ view, technical = false, compact = false, focused = false, onDetails }: {
  view: OnboardingSnapshot; technical?: boolean; compact?: boolean; focused?: boolean; onDetails(): void;
}) {
  const applicationChecks = view.deployment?.checks, checks = applicationChecks ?? view.checks;
  const affected = view.review?.changes.filter(change => change.action !== 'noop').length;
  const contents = <>
    <ol className="onboarding-stages" aria-label="Recorded setup progress">{view.stages.map((stage, index) => <li key={stage.id} className={'onboarding-stage-' + stage.status} aria-label={`${stage.label}: ${statuses[stage.status]}`}><span className="onboarding-stage-number">{stage.status === 'passed' ? <Icon name="check" size={14}/> : index + 1}</span><strong>{stage.label}</strong><small>{statuses[stage.status]}</small></li>)}</ol>
    {(!focused || technical) && <OnboardingCheckList checks={checks} application={applicationChecks !== undefined} technical={technical}/>}
    {view.review && (!focused || technical) && <div className="onboarding-review"><strong>{affected ?? 0} {(affected ?? 0) === 1 ? 'change' : 'changes'}</strong><span>{view.review.changes.filter(change => change.action === 'noop').length} unchanged</span><button type="button" onClick={onDetails}>Review details</button></div>}
  </>;
  return compact ? <details className="onboarding-completed-progress"><summary><Icon name="check" size={14}/><span>{view.stages.filter(stage => stage.status === 'passed').length} steps completed{checks.length ? ` · ${checks.length} recorded ${checks.length === 1 ? 'check' : 'checks'}` : ''}</span><span className="onboarding-progress-open">View progress</span></summary>{contents}</details> : contents;
}
