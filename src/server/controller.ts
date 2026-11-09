import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDeploymentRecorder } from 'footprint-iac/progress';
import type { InfraGraph } from 'footprint-iac';
import type { DashboardState, Scenario } from '../core/types.ts';
import { graphArtifacts, cloudFormationExample } from './artifacts.ts';
import { demoGraph } from './graphs.ts';
import { ReviewSimulator, executeRun } from './execute-run.ts';
import type { NeoTarget } from './neo.ts';

export class RequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export class DashboardController {
  private state: DashboardState;
  private readonly listeners = new Set<() => void>();
  private readonly simulator: ReviewSimulator;
  private completion: Promise<void> = Promise.resolve();
  private activeNeo: NeoTarget | undefined;
  private readonly options: { directory: string; neo?: NeoTarget; initialScenario?: 'neo'; readinessDelay?: number };

  constructor(options: { directory: string; neo?: NeoTarget; initialScenario?: 'neo'; readinessDelay?: number }) {
    this.options = options;
    this.simulator = new ReviewSimulator(resolve(options.directory, 'provider.json'), options.readinessDelay);
    if (options.initialScenario === 'neo' && !options.neo) throw new Error('An initial Neo graph requires a prepared target');
    const neo = options.initialScenario === 'neo' ? options.neo : undefined;
    const graph = neo?.binding.graph ?? demoGraph();
    this.state = { revision: 0, graph, busy: false, mode: neo ? 'kubernetes' : 'simulator', neoAvailable: !!options.neo,
      ...(neo ? { design: neo.design, binding: neo.binding } : {}),
      ...(options.neo?.url ? { neoUrl: options.neo.url } : {}),
      target: neo ? { id: neo.binding.targetId, context: neo.context, namespace: 'footprint-iac-neo-test', label: 'Fresh local Neo Kubernetes target' }
        : { id: 'local-simulator', label: 'Local simulator · no cloud resources' },
      run: { id: '', status: 'idle', mode: neo ? 'kubernetes' : 'simulator', resources: this.pending(graph), events: [] }, artifacts: [] };
  }

  async initialize(): Promise<void> {
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    this.state.artifacts = [...await graphArtifacts(this.state.graph!), ...await cloudFormationExample()];
    this.publish();
  }
  getSnapshot(): DashboardState { return structuredClone(this.state); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  whenIdle(): Promise<void> { return this.completion; }

  start(scenario: Scenario): void {
    if (!['demo', 'failure', 'neo', 'noop'].includes(scenario)) throw new RequestError(400, 'Unknown review scenario');
    if (this.state.busy) throw new RequestError(409, 'A deployment is already running');
    if (scenario === 'neo' && !this.options.neo) throw new RequestError(409, 'Neo was not enabled from a prepared local review');
    if (scenario === 'noop' && this.state.run?.status !== 'passed') throw new RequestError(409, 'Complete a successful run before checking no-op');
    const neo = scenario === 'neo' ? this.options.neo : scenario === 'noop' ? this.activeNeo : undefined;
    const graph = scenario === 'noop' ? this.state.graph! : neo ? neo.binding.graph : demoGraph(scenario === 'failure');
    this.activeNeo = neo;
    this.simulator.faults.failBeforeApply = scenario === 'failure' ? new Set(['persistent-store']) : new Set();
    this.state = { ...this.state, graph, busy: true, mode: neo ? 'kubernetes' : 'simulator',
      ...(neo ? { design: neo.design, binding: neo.binding } : { design: undefined, binding: undefined }),
      target: neo ? { id: neo.binding.targetId, context: neo.context, namespace: 'footprint-iac-neo-test', label: 'Prepared local Neo Kubernetes fixture' }
        : { id: 'local-simulator', label: 'Local simulator · provider readiness is deliberately delayed' },
      run: { id: '', status: 'running', mode: neo ? 'kubernetes' : 'simulator', startedAt: new Date().toISOString(), resources: this.pending(graph), events: [] } };
    this.publish();
    this.completion = this.perform(graph, neo, scenario === 'neo');
  }

  private pending(graph: InfraGraph) { return graph.resources.map(resource => ({ id: resource.id, resourceId: resource.id, status: 'pending' as const })); }
  private publish(): void {
    this.state.revision++;
    for (const listener of this.listeners) { try { listener(); } catch { /* A disconnected viewer cannot change a deployment. */ } }
  }

  private async perform(graph: InfraGraph, neo?: NeoTarget, firstCreate = false): Promise<void> {
    const recorder = createDeploymentRecorder();
    const unsubscribe = recorder.subscribe(event => {
      const projected = recorder.getSnapshot();
      this.state.run = { ...this.state.run!, id: event.runId,
        resources: graph.resources.map(resource => ({
          ...(projected.resources[resource.id] ?? { resourceId: resource.id, status: 'pending' as const }), id: resource.id })),
        events: [...projected.events] };
      this.publish();
    });
    try {
      this.state.artifacts = [...await graphArtifacts(graph), ...await cloudFormationExample()];
      this.publish();
      const completed = await executeRun({ graph, directory: this.options.directory, recorder, simulator: this.simulator,
        ...(neo ? { neo } : {}), requireFreshCreate: firstCreate });
      this.state.run = { ...this.state.run!, id: completed.result.runId,
        status: completed.result.ok ? 'passed' : 'failed', finishedAt: new Date().toISOString(),
        ...(completed.recording ? { recording: completed.recording } : {}),
        report: { ok: completed.result.ok, evidencePath: completed.result.evidencePath,
          tracePath: completed.result.tracePath, traceStatus: completed.result.traceStatus,
          failure: completed.result.failure, results: completed.result.results,
          ...(completed.captureError ? { captureError: completed.captureError } : {}) } };
    } catch (error) {
      this.state.run = { ...this.state.run!, status: 'failed', finishedAt: new Date().toISOString(),
        report: { error: error instanceof Error ? error.message : String(error),
          coverage: 'Resource status shows only recorded outcomes; missing outcomes remain unknown.' } };
    } finally {
      unsubscribe(); this.state.busy = false; this.publish();
      try { await writeFile(resolve(this.options.directory, 'latest.json'), JSON.stringify(this.state, null, 2) + '\n', { mode: 0o600 }); }
      catch (error) {
        this.state.run = { ...this.state.run!, report: { deploymentReport: this.state.run?.report,
          viewerPersistenceError: error instanceof Error ? error.message : String(error) } };
        this.publish();
      }
    }
  }
}
