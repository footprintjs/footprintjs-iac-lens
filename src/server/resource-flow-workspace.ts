import { validateInfraGraph } from 'footprintjs-iac/graph';
import { readDeploymentSchedulePreview } from 'footprintjs-iac/progress';
import { projectDeploymentSchedulePreview } from '../core/native-deployment-chart.ts';
import { readSystemViewDefinition } from '../core/capabilities.ts';
import { readRevisionReview } from '../core/revision-review.ts';
import { readResourceFlowWorkspace, type ResourceFlowWorkspaceFrame, type ResourceFlowWorkspaceState } from '../core/resource-flow-workspace.ts';
import type { ResourceFlowState } from '../core/resource-flow.ts';
import type { ResourceFlowWorkspaceOptions } from './resource-flow.ts';

export type { ResourceFlowWorkspaceOptions } from './resource-flow.ts';
export type { ResourceFlowWorkspaceFrame, ResourceFlowWorkspaceState } from '../core/resource-flow-workspace.ts';

/** Canonical design and exact phase graphs are configured once by the trusted host. */
export function readWorkspaceOptions(options: ResourceFlowWorkspaceOptions): ResourceFlowWorkspaceOptions {
  const graph = validateInfraGraph(options.graph);
  const phaseGraphs = Object.fromEntries(Object.entries(options.phaseGraphs).map(([phase, value]) => {
    if (!['acquire', 'connect'].includes(phase)) throw Error('Unknown configured resource workflow phase');
    const child = validateInfraGraph(value);
    if (child.name !== graph.name || !child.resources.length || child.resources.some(resource => !graph.resources.some(item => item.id === resource.id))) {
      throw Error('A resource workflow phase graph must name canonical resources');
    }
    return [phase, child];
  }));
  const schedulePreview = options.schedulePreview && readDeploymentSchedulePreview(options.schedulePreview);
  if (schedulePreview && !projectDeploymentSchedulePreview({ revision: 0, busy: false, graph, schedulePreview }).chart) {
    throw Error('The resource workflow schedule must match its canonical graph');
  }
  const revisionReview = options.revisionReview && readRevisionReview(options.revisionReview);
  if (revisionReview && (revisionReview.canApply || (revisionReview.current && revisionReview.current.graphDigest !== graph.digest))) {
    throw Error('Resource workflow revision history must be read-only and match the canonical graph');
  }
  if (options.binding && options.binding.graph.digest !== graph.digest) throw Error('The resource workflow binding must match its canonical graph');
  return { ...options, graph, phaseGraphs,
    ...(options.systemView && { systemView: readSystemViewDefinition(options.systemView) }),
    ...(schedulePreview && { schedulePreview }), ...(revisionReview && { revisionReview }) };
}

/** Joins independent native child runs without inventing an aggregate apply run. */
export class ResourceFlowWorkspaceReview {
  private parent?: ResourceFlowState;
  private state?: ResourceFlowWorkspaceState;
  private waiting?: ResourceFlowWorkspaceFrame;
  private unsubscribe?: () => void;
  private failed = false;
  readonly options: ResourceFlowWorkspaceOptions;
  private readonly publish: (state: ResourceFlowWorkspaceState | undefined, error?: string) => void;
  constructor(options: ResourceFlowWorkspaceOptions,
    publish: (state: ResourceFlowWorkspaceState | undefined, error?: string) => void) { this.options = options; this.publish = publish; }

  async initialize(parent: ResourceFlowState): Promise<void> {
    this.parentChanged(parent);
    this.unsubscribe = this.options.subscribe(frame => this.receive(frame));
    await this.refresh();
  }
  parentChanged(parent: ResourceFlowState): void {
    this.parent = parent;
    if (this.waiting && this.waiting.executionId === parent.executionId) {
      const frame = this.waiting; this.waiting = undefined; this.receive(frame);
    }
  }
  async refresh(): Promise<void> {
    try { this.receive(await this.options.snapshot()); }
    catch { this.reject(); }
  }
  dispose(): void { this.unsubscribe?.(); this.unsubscribe = undefined; }
  available(kind: 'connections' | 'identity'): boolean {
    return !this.failed && !!(kind === 'connections' ? this.options.recheckConnections : this.options.recheckIdentity);
  }
  async recheck(kind: 'connections' | 'identity'): Promise<void> {
    if (!this.available(kind)) throw Error('This fixed resource workflow check is unavailable');
    await (kind === 'connections' ? this.options.recheckConnections!() : this.options.recheckIdentity!());
    await this.refresh();
  }
  private receive(value: ResourceFlowWorkspaceFrame): void {
    try {
      const parent = this.parent;
      if (!parent) throw Error('The resource workflow is not loaded');
      // A native child observer can run before the parent state listener in the same turn.
      if (parent.executionId === null && value.executionId !== null && value.flowId === parent.id
        && value.definitionDigest === parent.definitionDigest && value.targetId === parent.target.id) {
        this.waiting = structuredClone(value); return;
      }
      const children = value.children.map(child => {
        const graph = this.options.phaseGraphs[child.phase];
        if (!graph || child.graphDigest !== graph.digest) throw Error('A native child graph was not configured for this phase');
        return { ...child, graph };
      });
      const next = readResourceFlowWorkspace({ ...value, children, phaseGraphs: this.options.phaseGraphs }, this.options.graph, parent);
      if (this.state && (next.sequence < this.state.sequence || next.flowId !== this.state.flowId
        || (this.state.executionId !== null && next.executionId !== this.state.executionId))) throw Error('The observed resource workflow changed execution');
      // A snapshot may enrich a completed run with its recording at the same native sequence.
      this.state = next; this.publish(structuredClone(next));
    } catch {
      this.reject();
    }
  }
  private reject(): void {
    this.failed = true;
    this.publish(this.state && structuredClone(this.state), 'Some native resource evidence could not be matched to this workflow. Unconfirmed progress remains unknown.');
  }
}
