import { applicationId, applicationText, readApplicationAction, readApplicationDeployment, readApplicationInspection,
  readApplicationReview, readApplicationSelection, readApplicationStrategies, readApplicationView,
  type ApplicationAction, type ApplicationDeployment, type ApplicationInspection, type ApplicationPhase,
  type ApplicationReview as ReviewResult, type ApplicationSelection, type ApplicationTarget, type ApplicationView } from '../core/application.ts';
import type { ConnectionProfileSummary } from '../core/connection-profiles.ts';
import type { ApplicationHost, ApplicationHostSnapshot, ApplicationPublication } from './application-host.ts';
import { readApplicationPublication } from './application-publication.ts';
import { applicationSourceIdentity, applicationSourceMatches, type ApplicationSourceView } from '../core/application-source.ts';

export class ApplicationRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
function record(input: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    || Object.getOwnPropertySymbols(input).length || Object.entries(Object.getOwnPropertyDescriptors(input)).some(([key, value]) => !fields.includes(key) || !value.enumerable || !('value' in value))) throw Error('Invalid registered application result');
  return input as Record<string, unknown>;
}
function same(left: ApplicationSelection | undefined, right: ApplicationSelection | undefined): boolean {
  return left?.strategyId === right?.strategyId && left?.targetId === right?.targetId && left?.profileId === right?.profileId;
}
function passes(checks: ApplicationInspection['checks'] | undefined, required: readonly string[]): boolean {
  return required.length > 0 && required.every(id => checks?.some(check => check.id === id && check.status === 'passed'));
}
/** Coordinates operator controls only. Every plan, effect and native receipt belongs to the registered app host. */
export class ApplicationReview {
  private readonly host: ApplicationHost;
  private readonly metadata: Pick<ApplicationView, 'id' | 'label' | 'description' | 'strategies'>;
  private selection?: ApplicationSelection;
  private inspection?: ApplicationInspection;
  private review?: ReviewResult;
  private deployment?: ApplicationDeployment;
  private reviewSelection?: ApplicationSelection;
  private source?: ApplicationSourceView;
  private reviewSource = '';
  private pending = false;
  private uncertain = false;
  private phase: ApplicationPhase = 'choose';
  private error?: string;
  private generation = 0;
  private completion: Promise<void> = Promise.resolve();
  private readonly consumedReviews = new Set<string>();
  private readonly publish: (view: ApplicationView, publication?: ApplicationPublication) => void;
  private readonly profiles: () => readonly Pick<ConnectionProfileSummary, 'id' | 'adapterId'>[];
  constructor(host: ApplicationHost, publish: (view: ApplicationView, publication?: ApplicationPublication) => void,
    profiles: () => readonly Pick<ConnectionProfileSummary, 'id' | 'adapterId'>[] = () => []) {
    this.publish = publish; this.profiles = profiles;
    if (!host || host.version !== 1 || ['inspect', 'plan', 'apply', 'snapshot'].some(key => typeof host[key as 'inspect'] !== 'function')) throw Error('Register a versioned application host');
    this.metadata = { id: applicationId(host.id), label: applicationText(host.label, 160),
      ...(host.description !== undefined ? { description: applicationText(host.description, 2000) } : {}), strategies: readApplicationStrategies(host.strategies) };
    if (this.metadata.strategies.some(strategy => strategy.targets.some(target => target.requiresProfile && !host.connectionProfiles))) throw Error('Register the application connection catalog');
    this.host = Object.freeze({ ...this.metadata, version: 1,
      ...(host.connectionProfiles ? { connectionProfiles: host.connectionProfiles } : {}),
      inspect: host.inspect.bind(host), plan: host.plan.bind(host), apply: host.apply.bind(host), snapshot: host.snapshot.bind(host) });
  }
  get isBusy(): boolean { return this.pending; }
  whenIdle(): Promise<void> { return this.completion; }
  async initialize(): Promise<void> {
    try { await this.restore(); }
    catch { this.uncertain = true; this.phase = 'incomplete'; this.error = 'The application history could not be confirmed. Refresh retained status before continuing.'; }
    this.notify();
  }
  snapshot(): ApplicationView {
    const ready = this.connectionReady(), inspection = this.inspectionReady();
    return readApplicationView({ ...this.metadata, ...(this.selection ? { selection: this.selection } : {}),
      phase: this.phase, busy: this.pending, canInspect: !this.pending && ready,
      canReview: !this.pending && !this.uncertain && ready && inspection && !this.deployment,
      canDeploy: !this.pending && !this.uncertain && ready && inspection && !!this.review?.ok && !this.deployment
        && !this.consumedReviews.has(this.review.reviewId!) && same(this.selection, this.reviewSelection) && this.reviewSource === applicationSourceIdentity(this.source),
      ...(this.inspection ? { inspection: this.inspection } : {}), ...(this.review ? { review: this.review } : {}),
      ...(this.deployment ? { deployment: this.deployment } : {}), ...(this.error ? { error: this.error } : {}) });
  }
  action(input: ApplicationAction): void {
    let action: ApplicationAction;
    try { action = readApplicationAction(input); } catch { throw new ApplicationRequestError(400, 'Choose only registered application IDs and actions'); }
    if (this.pending) throw new ApplicationRequestError(409, 'Wait for the current application task to finish');
    if (action.action === 'select') { this.select(action); return; }
    if (action.action === 'inspect' && !this.connectionReady()) throw new ApplicationRequestError(409, 'Choose a registered target and saved connection before checking setup');
    if (action.action === 'review' && !this.snapshot().canReview) throw new ApplicationRequestError(409, 'Check setup and resolve recorded uncertainty before reviewing changes');
    if (action.action === 'deploy' && (!this.snapshot().canDeploy || action.reviewId !== this.review?.reviewId)) throw new ApplicationRequestError(409, 'Review the current changes before deploying this exact review');
    if (action.action === 'deploy' && this.consumedReviews.size >= 256) throw new ApplicationRequestError(409, 'This viewer has reached its deployment history limit');
    this.pending = true; this.error = undefined;
    const generation = ++this.generation;
    if (action.action === 'inspect') { this.inspection = undefined; this.review = undefined; this.reviewSelection = undefined; this.deployment = undefined; this.source = undefined; this.phase = 'inspect'; this.notify({ source: undefined }); }
    if (action.action === 'review') { this.review = undefined; this.reviewSelection = undefined; this.deployment = undefined; this.phase = 'review'; }
    if (action.action === 'deploy') { this.consumedReviews.add(action.reviewId); this.reviewSelection = undefined; this.inspection = undefined; this.phase = 'deploy'; }
    this.notify();
    this.completion = this.perform(action, generation).finally(() => { this.pending = false; this.generation++; this.notify(); });
  }
  private target(selection = this.selection): ApplicationTarget | undefined {
    return this.metadata.strategies.find(strategy => strategy.id === selection?.strategyId)?.targets.find(target => target.id === selection?.targetId);
  }
  private connectionReady(): boolean {
    const target = this.target(); if (!target || !this.selection) return false;
    if (!this.selection.profileId) return !target.requiresProfile;
    const profile = this.profiles().find(profile => profile.id === this.selection!.profileId);
    return !!profile && (!target.profileAdapterIds || target.profileAdapterIds.includes(profile.adapterId));
  }
  private sourceReady(): boolean { return this.source ? applicationSourceMatches(this.source, this.selection) && this.source.status === 'ready' : this.target()?.requiresSource !== true; }
  private inspectionReady(): boolean { return !!this.inspection?.ok && !!this.target() && this.sourceReady() && passes(this.inspection.checks, this.target()!.requiredInspectionCheckIds); }
  private select(action: Extract<ApplicationAction, { action: 'select' }>): void {
    const { action: _action, ...selection } = action;
    const target = this.target(selection);
    if (!target) throw new ApplicationRequestError(400, 'Choose a registered strategy and target');
    if (this.uncertain && !same(this.selection, selection)) throw new ApplicationRequestError(409, 'Inspect retained application state before changing a target with an uncertain effect');
    if (selection.profileId) {
      const profile = this.profiles().find(profile => profile.id === selection.profileId);
      if (!profile || (target.profileAdapterIds && !target.profileAdapterIds.includes(profile.adapterId))) throw new ApplicationRequestError(400, 'Choose a saved connection admitted for this registered target');
    }
    if (same(this.selection, selection)) return;
    this.selection = structuredClone(selection); this.inspection = undefined; this.review = undefined; this.reviewSelection = undefined;
    this.deployment = undefined; this.error = undefined; this.phase = 'choose';
    this.source = undefined; this.reviewSource = '';
    this.notify({ graph: null, design: undefined, binding: undefined, schedulePreview: undefined, run: undefined, recording: undefined,
      connections: undefined, identity: undefined, artifacts: [], systemView: undefined, changeAssessment: undefined, neoUrl: undefined, appAccess: undefined,
      target: { id: target.id, label: target.label }, source: undefined });
  }
  private observer(generation: number, operation: ApplicationAction['action']): (publication: ApplicationPublication) => void {
    return publication => {
      if (!this.pending || generation !== this.generation) return;
      try {
        const value = readApplicationPublication(publication);
        if (Object.hasOwn(value, 'source')) {
          if (value.source && !applicationSourceMatches(value.source, this.selection)) throw Error('Source selection changed');
          this.source = value.source;
        }
        if (value.phase !== undefined && (value.phase !== 'verify' || operation !== 'deploy')) throw Error('Invalid application activity phase');
        if (value.phase === 'verify') this.phase = 'verify';
        const { phase: _phase, ...patch } = value;
        this.notify(structuredClone(patch));
      } catch { this.error = 'Some native progress could not be displayed. Inspect the retained application recording.'; }
    };
  }
  private async perform(action: Exclude<ApplicationAction, { action: 'select' }>, generation: number): Promise<void> {
    try {
      if (action.action === 'refresh') { await this.restore(); return; }
      const selection = structuredClone(this.selection!);
      const publish = this.observer(generation, action.action);
      if (action.action === 'inspect') {
        const value = record(await this.host.inspect(selection, publish), ['ok', 'checks', 'publication']);
        const { publication, ...result } = value; this.inspection = readApplicationInspection(result);
        if (publication !== undefined) publish(publication as ApplicationPublication);
        if (!this.inspectionReady()) { this.inspection = { ...this.inspection, ok: false }; this.phase = this.uncertain ? 'incomplete' : 'failed'; }
        else this.phase = this.uncertain ? 'incomplete' : 'review';
      } else if (action.action === 'review') {
        const sourceIdentity = applicationSourceIdentity(this.source);
        const value = record(await this.host.plan(selection, publish), ['ok', 'reviewId', 'changes', 'publication']);
        const { publication, ...result } = value; this.review = readApplicationReview(result);
        if (publication !== undefined) publish(publication as ApplicationPublication);
        if (this.review.ok && this.sourceReady() && sourceIdentity === applicationSourceIdentity(this.source)) { this.reviewSelection = selection; this.reviewSource = sourceIdentity; this.phase = 'review'; }
        else if (this.review.ok) { this.reviewSelection = undefined; this.review = undefined; this.phase = 'failed'; throw Error('Source changed during review'); }
        else this.phase = 'failed';
      } else if (action.action === 'deploy') {
        const sourceIdentity = applicationSourceIdentity(this.source);
        const value = record(await this.host.apply({ ...selection, reviewId: action.reviewId }, publish), ['ok', 'promoted', 'status', 'checks', 'appUrl', 'publication']);
        const { publication, ...result } = value; const deployment = readApplicationDeployment(result);
        if (publication !== undefined) {
          const admitted = readApplicationPublication(publication);
          if (Object.hasOwn(admitted, 'source') && (admitted.source && !applicationSourceMatches(admitted.source, this.selection)
            || applicationSourceIdentity(admitted.source) !== sourceIdentity)) throw Error('Deployment source changed');
        }
        if (!this.sourceReady() || sourceIdentity !== applicationSourceIdentity(this.source) || sourceIdentity !== this.reviewSource) throw Error('Deployment source changed');
        if (deployment.promoted && !passes(deployment.checks, this.target()!.requiredVerificationCheckIds)) throw Error('Required application verification is incomplete');
        this.deployment = deployment;
        if (publication !== undefined) publish(publication as ApplicationPublication);
        this.uncertain = this.deployment.status === 'incomplete';
        this.phase = this.uncertain ? 'incomplete' : this.deployment.promoted ? 'ready' : 'failed';
      }
    } catch {
      if (action.action === 'deploy') { this.uncertain = true; this.phase = 'incomplete'; this.deployment = { ok: false, promoted: false, status: 'incomplete' }; }
      else if (action.action === 'refresh') {
        this.uncertain = true; this.phase = 'incomplete'; this.deployment = { ok: false, promoted: false, status: 'incomplete' };
        if (this.source) { this.source = { ...this.source, status: 'incomplete' }; this.notify({ source: this.source }); }
      }
      else this.phase = this.uncertain ? 'incomplete' : 'failed';
      this.reviewSelection = undefined;
      this.error = action.action === 'deploy'
        ? 'The application outcome is not confirmed. Refresh retained status and inspect its native recording before another deployment.'
        : 'The application host could not confirm this step. Check the registered setup and retained recording.';
    }
  }
  private async restore(): Promise<void> {
    const value = record(await this.host.snapshot(this.selection ? structuredClone(this.selection) : undefined),
      ['selection', 'inspection', 'review', 'deployment', 'publication', 'incomplete']);
    if (value.incomplete !== undefined && typeof value.incomplete !== 'boolean') throw Error('Invalid native application state');
    const selected = value.selection === undefined ? this.selection : readApplicationSelection(value.selection);
    if (selected && (!this.target(selected) || (this.selection && !same(selected, this.selection)))) throw Error('Native application selection changed');
    const inspection = value.inspection === undefined ? undefined : readApplicationInspection(value.inspection);
    const review = value.review === undefined ? undefined : readApplicationReview(value.review);
    const deployment = value.deployment === undefined ? undefined : readApplicationDeployment(value.deployment);
    const target = this.target(selected);
    if (deployment?.promoted && (!target || !passes(deployment.checks, target.requiredVerificationCheckIds))) throw Error('Required native application verification is missing');
    const patch = value.publication === undefined ? undefined : readApplicationPublication(value.publication);
    if (patch?.phase !== undefined) throw Error('A retained snapshot cannot be a running operation');
    const source = patch?.source;
    if (source && !applicationSourceMatches(source, selected)) throw Error('Retained source selection changed');
    if (deployment?.promoted && (target?.requiresSource || source) && source?.status !== 'ready') throw Error('Retained source proof is missing');
    this.selection = selected; this.inspection = inspection; this.review = review; this.deployment = deployment;
    this.source = source; this.reviewSource = applicationSourceIdentity(source);
    if (value.incomplete === true || this.deployment?.status === 'incomplete') this.uncertain = true;
    else if (value.incomplete === false) this.uncertain = false;
    if (this.uncertain && this.deployment?.promoted) this.deployment = { ok: false, promoted: false, status: 'incomplete' };
    this.reviewSelection = !this.uncertain && this.inspectionReady() && this.review?.ok && !this.deployment
      && !this.consumedReviews.has(this.review.reviewId!) ? this.selection : undefined;
    this.phase = this.uncertain ? 'incomplete' : this.deployment ? this.deployment.promoted ? 'ready' : 'failed' : this.review?.ok || this.inspectionReady() ? 'review' : 'choose';
    this.notify({ ...structuredClone(patch), source });
  }
  private notify(publication?: ApplicationPublication): void {
    try { this.publish(this.snapshot(), publication); }
    catch { this.error = 'Some native progress could not be displayed. Inspect the retained application recording.'; }
  }
}
