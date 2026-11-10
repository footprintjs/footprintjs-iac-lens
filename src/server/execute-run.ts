import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { FileStateStore, InfraEngine, KubernetesAdapter, SimulatorAdapter,
  type ApplyResult, type InfraGraph } from 'footprint-iac';
import type { DeploymentRecorder } from 'footprint-iac/progress';
import type { Recording } from '../core/types.ts';
import type { NeoTarget } from './neo.ts';
import { claimFreshNeo } from './claim-fresh-neo.ts';

/** The delay belongs to the simulated provider readiness check, not the view. */
export class ReviewSimulator extends SimulatorAdapter {
  readonly readinessDelay: number;
  constructor(file: string, readinessDelay = 650) { super({ file }); this.readinessDelay = readinessDelay; }
  override async waitReady(): Promise<void> {
    await delay(this.readinessDelay);
    await super.waitReady();
  }
}

export async function executeRun(options: {
  graph: InfraGraph; directory: string; recorder: DeploymentRecorder;
  simulator: SimulatorAdapter; neo?: NeoTarget; requireFreshCreate?: boolean;
}): Promise<{ result: ApplyResult; recording?: Recording; captureError?: string }> {
  const engine = new InfraEngine({
    adapters: options.neo ? [new KubernetesAdapter({ context: options.neo.context,
      kubeconfig: options.neo.kubeconfig, namespace: 'footprint-iac-neo-test', timeoutMs: 180_000 })] : [options.simulator],
    store: new FileStateStore(options.neo?.stateDirectory ?? resolve(options.directory, 'state')),
    traceDirectory: resolve(options.directory, 'traces'), maxConcurrency: 2,
    recorders: [options.recorder], chartObservers: [options.recorder],
  });
  if (options.requireFreshCreate && options.neo?.freshClaimPath) {
    await claimFreshNeo(options.neo.freshClaimPath, () => engine.plan(options.graph));
  }
  const result = await engine.apply(options.graph);
  if (options.requireFreshCreate && options.neo?.freshClaimPath
    && result.plan.operations.some(operation => operation.action !== 'create')) {
    throw new Error('The target changed after fresh admission. This run is not a first-creation recording; inspect its saved engine evidence.');
  }
  try {
    const evidence = JSON.parse(await readFile(result.evidencePath, 'utf8'));
    return { result, recording: { snapshot: evidence.snapshot, structure: evidence.structure,
      narrativeEntries: evidence.narrative } };
  } catch (error) {
    return { result, captureError: error instanceof Error ? error.message : String(error) };
  }
}
