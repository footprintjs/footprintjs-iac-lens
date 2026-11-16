import { readOnboardingAction, readOnboardingSnapshot, type OnboardingAction, type OnboardingSnapshot } from '../core/onboarding.ts';
import type { Recording } from '../core/types.ts';
import type { ApplicationPublication } from './application-host.ts';
import { readApplicationPublication } from './application-publication.ts';
import type { OnboardingHost } from './onboarding-host.ts';

export class OnboardingRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export interface OnboardingPublication { view: OnboardingSnapshot; recording?: Recording; publication?: ApplicationPublication; error?: string }
/** Transport serialization and safe projections only. This class never implements workflow stages. */
export class OnboardingSession {
  private readonly host: OnboardingHost;
  private readonly publish: (value: OnboardingPublication) => void;
  private view?: OnboardingSnapshot;
  private recording?: Recording;
  private pending = false;
  private completion: Promise<void> = Promise.resolve();
  private stops: (() => void)[] = [];
  private disposed = false;
  private error?: string;
  constructor(host: OnboardingHost, publish: (value: OnboardingPublication) => void) {
    this.publish = publish;
    if (!host || host.version !== 1 || !host.workflow || ['snapshot', 'dispatch', 'subscribe'].some(key => typeof host.workflow[key as 'snapshot'] !== 'function')) throw Error('Register one native onboarding workflow');
    this.host = Object.freeze({ version: 1, workflow: Object.freeze({ snapshot: host.workflow.snapshot.bind(host.workflow), dispatch: host.workflow.dispatch.bind(host.workflow), subscribe: host.workflow.subscribe.bind(host.workflow),
      ...(host.workflow.recording ? { recording: host.workflow.recording.bind(host.workflow) } : {}) }),
      ...(host.publication ? { publication: host.publication.bind(host) } : {}), ...(host.subscribePublication ? { subscribePublication: host.subscribePublication.bind(host) } : {}) });
  }
  async initialize(): Promise<void> {
    this.accept(await this.host.workflow.snapshot());
    this.stops.push(this.host.workflow.subscribe(value => { try { this.accept(value); this.notify(); } catch { this.fail(); } }));
    if (this.host.subscribePublication) this.stops.push(this.host.subscribePublication(publication => {
      try { this.notify(readApplicationPublication(publication)); } catch { this.error = 'Some native progress could not be displayed. Read the retained recording.'; this.notify(); }
    }));
    await this.refreshEvidence(); this.notify();
  }
  whenIdle(): Promise<void> { return this.completion; }
  dispose(): void { this.disposed = true; for (const stop of this.stops.splice(0)) stop(); }
  snapshot(): OnboardingSnapshot {
    if (!this.view) throw Error('Read the registered onboarding workflow first');
    return readOnboardingSnapshot({ ...this.view, ...(this.pending ? { busy: true, canDiscover: false, canConfigure: false, canVerify: false, canReview: false, canDeploy: false, canReconcile: false } : {}) });
  }
  action(input: OnboardingAction): void {
    let action: OnboardingAction;
    try { action = readOnboardingAction(input); } catch { throw new OnboardingRequestError(400, 'Choose an onboarding action and the exact registered review'); }
    if (this.pending || this.view?.busy) throw new OnboardingRequestError(409, 'Wait for the current onboarding task');
    const view = this.snapshot();
    const admitted = action.action === 'refresh' || action.action === 'discover' && view.canDiscover || action.action === 'configure' && view.canConfigure
      || action.action === 'verify' && view.canVerify || action.action === 'review' && view.canReview
      || action.action === 'deploy' && view.canDeploy && action.reviewId === view.review?.reviewId
      || action.action === 'reconcile' && view.canReconcile && action.reviewId === view.review?.reviewId;
    if (!admitted) throw new OnboardingRequestError(409, 'Follow the recorded onboarding steps and current review');
    this.pending = true; this.error = undefined; this.notify();
    this.completion = (async () => {
      try { this.accept(await this.host.workflow.dispatch(action)); }
      catch { try { this.accept(await this.host.workflow.snapshot()); } catch { this.fail(); } this.error = 'The step could not be confirmed. Read its native result before continuing.'; }
      finally { this.pending = false; await this.refreshEvidence(); this.notify(); }
    })();
  }
  private accept(input: unknown): void {
    const view = readOnboardingSnapshot(input), current = this.view;
    if (current && ['id', 'strategyId', 'targetId', 'configurationDigest', 'profileId'].some(key => current[key as 'id'] !== view[key as 'id'])) throw Error('Registered onboarding identity changed');
    if ((this.recording?.snapshot as { runId?: unknown } | undefined)?.runId !== view.recording?.runId) this.recording = undefined;
    this.view = view;
  }
  private async refreshEvidence(): Promise<void> {
    try {
      if (this.host.workflow.recording) {
        const candidate = await this.host.workflow.recording();
        const recording = candidate === undefined ? undefined : readApplicationPublication({ recording: candidate }).recording;
        if (recording && (recording.snapshot as { runId?: unknown }).runId !== this.view?.recording?.runId) throw Error('Onboarding recording differs from its run');
        this.recording = recording;
      }
      const publication = await this.host.publication?.();
      if (publication) this.notify(readApplicationPublication(publication));
    } catch { this.error = 'Some native evidence could not be confirmed. Read the retained workflow before continuing.'; }
  }
  private fail(): void {
    if (!this.view) return;
    this.view = { ...this.view, status: 'incomplete', busy: false,
      ...(this.view.deployment ? { deployment: { ok: false, promoted: false, status: 'incomplete' } } : {}),
      stages: this.view.stages.map(stage => stage.status === 'running' || stage.id === 'deploy' && this.view?.deployment?.promoted ? { ...stage, status: 'unknown' } : stage),
      canDiscover: false, canConfigure: false, canVerify: false, canReview: false, canDeploy: false, canReconcile: false };
    this.error = 'The registered workflow record could not be confirmed. Refresh its retained status.';
    this.notify();
  }
  private notify(publication?: ApplicationPublication): void {
    if (!this.disposed && this.view) this.publish({ view: this.snapshot(), ...(this.recording ? { recording: structuredClone(this.recording) } : {}), ...(publication ? { publication } : {}), ...(this.error ? { error: this.error } : {}) });
  }
}
