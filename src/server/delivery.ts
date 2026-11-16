import { readDeliveryState, type DeliveryState } from 'footprintjs-iac/delivery';
import { loadDeliveryRecording } from 'footprintjs-iac/delivery/workflow';
import { projectDeliveryState, readDeliveryAction, readDeliveryView, type DeliveryAction, type DeliveryView } from '../core/delivery.ts';
import type { DashboardState } from '../core/types.ts';

export type DeliveryPublication = Partial<Pick<DashboardState,'graph'|'design'|'binding'|'schedulePreview'|'run'|'recording'|'connections'|'identity'|'revisionReview'|'neoUrl'|'appAccess'|'artifacts'|'target'|'systemView' | 'systemTopology'|'changeAssessment'>>;
export interface DeliveryReviewOptions {
  id: string; buttonLabel?: string;
  workflow: { snapshot(): Promise<DeliveryState>; start(): Promise<DeliveryState>; subscribe(listener: (state: DeliveryState) => void): () => void };
  /** Native provider/check events supplied by the fixed host, independent of delivery-stage progress. */
  subscribePublication?(listener: (publication: DeliveryPublication) => void): () => void;
}
export class DeliveryRequestError extends Error { readonly status: number; constructor(status: number, message: string) { super(message); this.status=status; } }
export class DeliveryReview {
  private view?: DeliveryView;
  private definitionDigest?: string;
  private stop?: () => void;
  private stopPublication?: () => void;
  private pending = false;
  private completion: Promise<void> = Promise.resolve();
  private readonly options: DeliveryReviewOptions;
  private readonly publish: (view: DeliveryView) => void;
  private readonly publication: (patch: DeliveryPublication) => void;
  constructor(options: DeliveryReviewOptions, publish: (view: DeliveryView) => void, publication: (patch: DeliveryPublication) => void) {
    this.options=options;this.publish=publish;this.publication=publication;
  }
  get isBusy(): boolean { return this.pending || this.view?.status === 'running'; }
  async initialize(): Promise<void> {
    const state = this.admit(await this.options.workflow.snapshot());
    this.accept(state);
    if (state.status === 'running') {
      this.view = { ...this.view!,status:'incomplete',error:'Previous execution needs inspection. Its stored progress does not confirm an active delivery in this viewer.' };
      this.publish(this.snapshot());
    }
    this.stop = this.options.workflow.subscribe(state => this.accept(this.admit(state)));
    this.stopPublication = this.options.subscribePublication?.(patch => this.publication(patch));
    await this.attachRecording(state);
  }
  action(input: DeliveryAction): void {
    let action: DeliveryAction;
    try { action = readDeliveryAction(input); } catch { throw new DeliveryRequestError(400,'Choose the configured delivery'); }
    if (action.deliveryId !== this.options.id) throw new DeliveryRequestError(400,'Choose the configured delivery');
    if (this.isBusy) throw new DeliveryRequestError(409,'A delivery is already running');
    if (this.view?.status !== 'idle') throw new DeliveryRequestError(409,'This version already has a retained delivery outcome');
    this.pending = true;
    this.completion = this.perform();
  }
  snapshot(): DeliveryView { if (!this.view) throw Error('Initialize delivery first'); return structuredClone(this.view); }
  whenIdle(): Promise<void> { return this.completion; }
  dispose(): void { this.stop?.(); this.stopPublication?.(); }
  private admit(input: DeliveryState): DeliveryState {
    const state = readDeliveryState(input);
    if (state.definition.id !== this.options.id || (this.definitionDigest && this.definitionDigest !== state.definitionDigest)) throw Error('Delivery definition changed');
    this.definitionDigest ??= state.definitionDigest; return state;
  }
  private accept(state: DeliveryState): void {
    const next = projectDeliveryState(state,this.options.buttonLabel);
    if (this.view?.executionId === next.executionId && this.view.recording) next.recording = this.view.recording;
    this.view = next; this.publish(this.snapshot());
  }
  private async attachRecording(state: DeliveryState): Promise<void> {
    const latest = state.recordings.at(-1);
    if (!latest) return;
    try { this.view = readDeliveryView({ ...this.view!, recording: await loadDeliveryRecording(latest.evidencePath, { runId: latest.runId, definitionDigest: state.definitionDigest,
      ...(state.executionId ? { executionId: state.executionId } : {}) }) }); }
    catch { this.view!.error = 'The delivery outcome is retained, but its native recording could not be opened.'; }
    this.publish(this.snapshot());
  }
  private async perform(): Promise<void> {
    try { const state = this.admit(await this.options.workflow.start()); this.accept(state); await this.attachRecording(state); }
    catch {
      try { const state = this.admit(await this.options.workflow.snapshot()); this.accept(state); await this.attachRecording(state); } catch { /* Retain the last admitted state. */ }
      if (this.view) { this.view.error = 'This delivery did not finish. Inspect its retained outcome before starting another version.'; this.publish(this.snapshot()); }
    } finally { this.pending = false; }
  }
}
