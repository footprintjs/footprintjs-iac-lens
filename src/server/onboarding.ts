import { readOnboardingAction, readOnboardingSnapshot, type OnboardingAction, type OnboardingSnapshot } from '../core/onboarding.ts';
import { readOnboardingVersionAction, readOnboardingVersionSnapshot, type OnboardingVersionAction, type OnboardingVersionSnapshot } from '../core/onboarding-versions.ts';
import type { Recording } from '../core/types.ts';
import type { ApplicationPublication } from './application-host.ts';
import { readApplicationPublication } from './application-publication.ts';
import type { OnboardingHost, OnboardingWorkflowPort } from './onboarding-host.ts';
import { admitOnboardingVersion, sameOnboardingDefinition, readOnboardingVersionPublication } from './onboarding-version-admission.ts';
import { readOnboardingRecording } from './onboarding-evidence.ts';

export class OnboardingRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export interface OnboardingPublication {
  view: OnboardingSnapshot; recording?: Recording; publication?: ApplicationPublication; error?: string;
  registry?: OnboardingVersionSnapshot; registryRecording?: Recording;
}
function captureWorkflow(value: OnboardingWorkflowPort): OnboardingWorkflowPort {
  if (!value || ['snapshot', 'dispatch', 'subscribe'].some(key => typeof value[key as 'snapshot'] !== 'function')) throw Error('Register one native onboarding workflow');
  return Object.freeze({ snapshot: value.snapshot.bind(value), dispatch: value.dispatch.bind(value), subscribe: value.subscribe.bind(value),
    ...(value.recording ? { recording: value.recording.bind(value) } : {}) });
}
/** Transport serialization and safe projections only. This class never implements workflow stages. */
export class OnboardingSession {
  private readonly host: OnboardingHost;
  private readonly publish: (value: OnboardingPublication) => void;
  private view?: OnboardingSnapshot;
  private recording?: Recording;
  private registry?: OnboardingVersionSnapshot;
  private registryRecording?: Recording;
  private pending = false;
  private completion: Promise<void> = Promise.resolve();
  private stops: (() => void)[] = [];
  private disposed = false;
  private error?: string;
  constructor(host: OnboardingHost, publish: (value: OnboardingPublication) => void) {
    this.publish = publish;
    if (!host || host.version !== 1) throw Error('Register one native onboarding workflow');
    const registry = host.registry;
    if (registry && ['snapshot', 'dispatch', 'subscribe'].some(key => typeof registry[key as 'snapshot'] !== 'function')) throw Error('Register the native configuration registry');
    if (host.registryPublication && (!registry || typeof host.registryPublication.snapshot !== 'function' || typeof host.registryPublication.subscribe !== 'function')) throw Error('Register a version-scoped publication port');
    const workflow = captureWorkflow(registry?.activeWorkflow ?? host.workflow);
    this.host = Object.freeze({ version: 1, workflow,
      ...(registry ? { registry: Object.freeze({ activeWorkflow: workflow, snapshot: registry.snapshot.bind(registry), dispatch: registry.dispatch.bind(registry), subscribe: registry.subscribe.bind(registry),
        ...(registry.recording ? { recording: registry.recording.bind(registry) } : {}) }) } : {}),
      ...(host.registryPublication ? { registryPublication: Object.freeze({ snapshot: host.registryPublication.snapshot.bind(host.registryPublication), subscribe: host.registryPublication.subscribe.bind(host.registryPublication) }) } : {}),
      ...(host.publication ? { publication: host.publication.bind(host) } : {}), ...(host.subscribePublication ? { subscribePublication: host.subscribePublication.bind(host) } : {}) });
  }
  async initialize(): Promise<void> {
    if (this.host.registry) this.acceptRegistry(await this.host.registry.snapshot());
    else this.accept(await this.host.workflow.snapshot());
    this.stops.push(this.host.workflow.subscribe(value => { try {
      const admitted = readOnboardingSnapshot(value);
      if (this.registry && !sameOnboardingDefinition(admitted, this.registry.active)) throw Error('Active workflow changed outside the registry');
      this.accept(admitted); if (this.registry) this.registry = readOnboardingVersionSnapshot({ ...this.registry, active: this.view,
        history: this.registry.history.map(entry => entry.head === this.registry!.head ? { ...entry, workflow: this.view } : entry) }); this.notify();
    } catch { this.fail(); } }));
    if (this.host.registry) this.stops.push(this.host.registry.subscribe(value => { try { this.acceptRegistry(value); this.notify(); } catch { this.fail(); } }));
    if (this.host.registryPublication) this.stops.push(this.host.registryPublication.subscribe(value => {
      try { this.publishVersioned(value); } catch { this.evidenceError(); }
    }));
    else if (!this.host.registry && this.host.subscribePublication) this.stops.push(this.host.subscribePublication(publication => {
      try { this.notify(readApplicationPublication(publication)); } catch { this.error = 'Some native progress could not be displayed. Read the retained recording.'; this.notify(); }
    }));
    await this.refreshEvidence(); this.notify();
  }
  whenIdle(): Promise<void> { return this.completion; }
  dispose(): void { this.disposed = true; for (const stop of this.stops.splice(0)) stop(); }
  snapshot(): OnboardingSnapshot {
    if (!this.view) throw Error('Read the registered onboarding workflow first');
    const busy = this.pending || this.registry?.busy || this.view.busy;
    const blocked = busy || this.registry?.status === 'incomplete' || this.registry?.status === 'activating';
    return readOnboardingSnapshot({ ...this.view, ...(busy ? { busy: true } : {}), ...(blocked ? { canDiscover: false, canConfigure: false, canVerify: false, canReview: false, canDeploy: false,
      canReconcile: !busy && this.registry?.status === 'incomplete' && this.view.canReconcile } : {}) });
  }
  registrySnapshot(): OnboardingVersionSnapshot | undefined {
    if (!this.registry) return undefined;
    const busy = this.pending || this.registry.busy || this.view?.busy === true;
    return readOnboardingVersionSnapshot({ ...this.registry, active: this.snapshot(), ...(busy ? { busy: true, canReview: false, canActivate: false, canReconcile: false } : {}) });
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
      try {
        if (this.host.registry && action.action === 'refresh') this.acceptRegistry(await this.host.registry.dispatch({ action: 'refresh' }));
        else { const result = await this.host.workflow.dispatch(action); if (this.host.registry) this.acceptRegistry(await this.host.registry.snapshot()); else this.accept(result); }
      }
      catch { await this.restoreAfterFailure(); this.error = 'The step could not be confirmed. Read its native result before continuing.'; }
      finally { this.pending = false; await this.refreshEvidence(); this.notify(); }
    })();
  }
  versionAction(input: OnboardingVersionAction): void {
    if (!this.host.registry || !this.registry) throw new OnboardingRequestError(409, 'No versioned onboarding registry was registered');
    let action: OnboardingVersionAction;
    try { action = readOnboardingVersionAction(input); } catch { throw new OnboardingRequestError(400, 'Choose a registered setup version and its sealed review'); }
    if (this.pending || this.registry.busy || this.view?.busy) throw new OnboardingRequestError(409, 'Wait for the current onboarding task');
    if (action.action === 'review-version' && !this.registry.versions.some(version => version.id === action.versionId)) throw new OnboardingRequestError(400, 'Choose a registered setup version');
    const admitted = action.action === 'refresh' || action.action === 'review-version' && this.registry.canReview
      || action.action === 'activate-version' && this.registry.canActivate && action.reviewId === this.registry.review?.reviewId
      || action.action === 'reconcile-activation' && this.registry.canReconcile && action.reviewId === this.registry.review?.reviewId;
    if (!admitted) throw new OnboardingRequestError(409, 'Review the current configuration change and resolve retained uncertainty first');
    this.pending = true; this.error = undefined; this.notify();
    this.completion = (async () => {
      try { this.acceptRegistry(await this.host.registry!.dispatch(action)); }
      catch { await this.restoreAfterFailure(); this.error = 'The configuration update could not be confirmed. Read the original registry recording.'; }
      finally { this.pending = false; await this.refreshEvidence(); this.notify(); }
    })();
  }
  private accept(input: unknown): void {
    const view = readOnboardingSnapshot(input), current = this.view;
    if (current && !sameOnboardingDefinition(current, view)) throw Error('Registered onboarding identity changed');
    if ((this.recording?.snapshot as { runId?: unknown } | undefined)?.runId !== view.recording?.runId) this.recording = undefined;
    this.view = view;
  }
  private acceptRegistry(input: unknown): void {
    const next = admitOnboardingVersion(input, this.registry); if (!next) return;
    if (!this.registry || !sameOnboardingDefinition(this.view!, next.active) || this.registry.activeVersionId !== next.activeVersionId
      || (this.recording?.snapshot as { runId?: unknown } | undefined)?.runId !== next.active.recording?.runId) this.recording = undefined;
    if ((this.registryRecording?.snapshot as { runId?: unknown } | undefined)?.runId !== next.recording?.runId) this.registryRecording = undefined;
    this.registry = next; this.view = next.active;
  }
  private async restoreAfterFailure(): Promise<void> {
    try { if (this.host.registry) this.acceptRegistry(await this.host.registry.snapshot()); else this.accept(await this.host.workflow.snapshot()); }
    catch { this.fail(); }
  }
  private async refreshEvidence(): Promise<void> {
    try {
      if (this.host.workflow.recording) {
        const candidate = await this.host.workflow.recording();
        this.recording = readOnboardingRecording(candidate, this.view?.recording?.runId);
      }
      if (this.host.registry) {
        if (this.host.registry.recording) this.registryRecording = readOnboardingRecording(await this.host.registry.recording(), this.registry?.recording?.runId);
        if (this.host.registryPublication) this.publishVersioned(await this.host.registryPublication.snapshot());
      } else {
        const publication = await this.host.publication?.();
        if (publication) this.notify(readApplicationPublication(publication));
      }
    } catch { this.evidenceError(); }
  }
  private publishVersioned(input: unknown): void {
    const value = readOnboardingVersionPublication(input);
    if (!this.registry || value.head < this.registry.head) return;
    if (value.head !== this.registry.head || value.versionId !== this.registry.activeVersionId) throw Error('Application evidence belongs to another configuration head');
    this.notify(value.publication);
  }
  private evidenceError(): void {
    this.error = 'Some native evidence could not be confirmed. Read the retained workflow before continuing.'; this.notify();
  }
  private fail(): void {
    if (!this.view) return;
    this.view = { ...this.view, status: 'incomplete', busy: false,
      ...(this.view.deployment ? { deployment: { ok: false, promoted: false, status: 'incomplete' } } : {}),
      stages: this.view.stages.map(stage => stage.status === 'running' || stage.id === 'deploy' && this.view?.deployment?.promoted ? { ...stage, status: 'unknown' } : stage),
      canDiscover: false, canConfigure: false, canVerify: false, canReview: false, canDeploy: false, canReconcile: false };
    this.error = 'The registered workflow record could not be confirmed. Refresh its retained status.';
    if (this.registry) this.registry = readOnboardingVersionSnapshot({ ...this.registry, active: this.view, status: 'incomplete', busy: false, canReview: false, canActivate: false, canReconcile: false });
    this.notify();
  }
  private notify(publication?: ApplicationPublication): void {
    if (!this.disposed && this.view) this.publish({ view: this.snapshot(), ...(this.registry ? { registry: this.registrySnapshot() } : {}),
      ...(this.registryRecording ? { registryRecording: structuredClone(this.registryRecording) } : {}),
      ...(this.recording ? { recording: structuredClone(this.recording) } : {}), ...(publication ? { publication } : {}), ...(this.error ? { error: this.error } : {}) });
  }
}
