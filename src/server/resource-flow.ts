import { readResourceFlowAction, readResourceFlowState, type ResourceFlowAction, type ResourceFlowState } from '../core/resource-flow.ts';
import type { DashboardState, OutputArtifact, Recording } from '../core/types.ts';

export interface ResourceFlowReviewOptions {
  workflow: {
    snapshot(): Promise<ResourceFlowState>;
    subscribe(listener: (state: ResourceFlowState) => void): () => void;
    start(): Promise<ResourceFlowState>;
    resume(input: { pauseToken: string; profileId: string }): Promise<ResourceFlowState>;
  };
  target?: DashboardState['target']; neoUrl?: string;
  artifacts?(): Promise<OutputArtifact[]>;
  /** The fixed host can supply its latest admitted native snapshot; requests cannot choose a path. */
  recording?(state: ResourceFlowState): Promise<Recording | undefined>;
}
export interface ResourceFlowPublication {
  state: ResourceFlowState; busy: boolean; error?: string; artifacts?: OutputArtifact[]; recording?: Recording;
}
export class ResourceFlowRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** Owns a single fixed workflow. The transport only names an action and configured profile. */
export class ResourceFlowReview {
  private state?: ResourceFlowState;
  private pending = false;
  private blocked = false;
  private completion: Promise<void> = Promise.resolve();
  private unsubscribe?: () => void;
  private readonly options: ResourceFlowReviewOptions;
  private readonly publish: (publication: ResourceFlowPublication) => void;
  constructor(options: ResourceFlowReviewOptions, publish: (publication: ResourceFlowPublication) => void) {
    this.options = options; this.publish = publish;
  }

  async initialize(): Promise<void> {
    this.accept(await this.options.workflow.snapshot());
    this.unsubscribe = this.options.workflow.subscribe(state => {
      try { this.accept(state); }
      catch { if (this.state) this.publish({ state: this.state, busy: this.pending,
        error: 'A workflow update could not be matched to this target. Inspect its saved recording.' }); }
    });
    await this.outputs();
  }
  whenIdle(): Promise<void> { return this.completion; }
  dispose(): void { this.unsubscribe?.(); this.unsubscribe = undefined; }

  action(value: ResourceFlowAction): void {
    const input = readResourceFlowAction(value), state = this.state;
    if (!state) throw new ResourceFlowRequestError(409, 'The configured workflow has not loaded');
    if (this.blocked) throw new ResourceFlowRequestError(409, 'The workflow target or recorded execution changed; inspect its saved evidence');
    if (this.pending || state.status === 'running') throw new ResourceFlowRequestError(409, 'This workflow is already running');
    if (input.action === 'start' && state.status !== 'idle') throw new ResourceFlowRequestError(409, 'This workflow has already started; use its recorded outcome or current pause');
    if (input.action === 'resume' && (state.status !== 'paused' || input.pauseToken !== state.pause?.token
      || !state.pause.profiles.some(profile => profile.id === input.profileId))) {
      throw new ResourceFlowRequestError(409, 'Select a configured profile for the current pause');
    }
    this.pending = true; this.publish({ state, busy: true });
    this.completion = this.perform(input);
  }
  private async perform(input: ResourceFlowAction): Promise<void> {
    let error: string | undefined;
    try {
      this.accept(input.action === 'start' ? await this.options.workflow.start()
        : await this.options.workflow.resume({ pauseToken: input.pauseToken, profileId: input.profileId }));
    } catch {
      error = 'The workflow action could not complete. Its saved state and native evidence are retained.';
      try { this.accept(await this.options.workflow.snapshot()); } catch { /* Keep the last admitted state. */ }
    } finally {
      this.pending = false;
      try { await this.outputs(error); }
      catch { if (this.state) this.publish({ state: this.state, busy: this.state.status === 'running',
        error: 'Workflow outputs could not be displayed. Inspect the retained native evidence.' }); }
    }
  }
  private accept(value: ResourceFlowState): void {
    let state: ResourceFlowState;
    try { state = readResourceFlowState(value); }
    catch { this.blocked = true; throw Error('The native workflow data could not be admitted'); }
    const prior = this.state;
    if (prior && (state.id !== prior.id || state.resourceId !== prior.resourceId || state.definitionDigest !== prior.definitionDigest || state.mode !== prior.mode
      || state.configurationDigest !== prior.configurationDigest
      || state.target.id !== prior.target.id || state.target.scope !== prior.target.scope
      || (prior.executionId !== null && state.executionId !== prior.executionId))) {
      this.blocked = true;
      throw Error('The native workflow belongs to another definition, execution or target');
    }
    this.state = state;
    this.publish({ state, busy: this.pending || state.status === 'running' });
  }
  private async outputs(error?: string): Promise<void> {
    const state = this.state!;
    const [artifacts, recording] = await Promise.all([
      this.options.artifacts?.() ?? Promise.resolve([]), this.options.recording?.(state),
    ]);
    this.publish({ state, busy: this.pending || state.status === 'running', ...(error ? { error } : {}),
      artifacts: [{ id: 'resource-flow-state', path: 'resource-flow/state.json', mediaType: 'application/json',
        content: JSON.stringify(state, null, 2) + '\n' }, ...artifacts], ...(recording ? { recording } : {}) });
  }
}
