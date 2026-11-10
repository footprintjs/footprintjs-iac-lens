import { readDeploymentChart, type DeploymentChart, type DeploymentResourceStages } from 'footprint-iac/progress';
import type { DashboardState } from './types.ts';

export interface NativeDeploymentBatch {
  index: number; gateStageId: string; joinStageId?: string; resourceIds: string[];
  /** A native selector scheduled these branches; this does not establish observed overlap. */
  scheduledParallel: boolean;
}
export interface NativeDeploymentNode extends DeploymentResourceStages { column: number; row: number }
export interface NativeDeploymentScheduleEdge {
  id: string; source: string; target: string; kind: 'native-schedule'; label: 'Next scheduled batch';
}
export interface NativeDeploymentChartView {
  runId: string; batches: NativeDeploymentBatch[]; nodes: NativeDeploymentNode[]; edges: NativeDeploymentScheduleEdge[];
}
export interface NativeDeploymentChartAdmission { chart?: NativeDeploymentChartView; warnings: string[] }

type NativeStage = DeploymentChart['structure'];
const unavailable = 'The native deployment chart could not be matched to this run and resource graph; its planned positions are unavailable.';
const MAX_STAGES = 20_000, MAX_RESOURCES = 4_096, MAX_BRANCHES = 128, MAX_EDGES = 100_000;

/** Project the constructor's captured topology. Never schedule resources or infer progress here. */
export function projectNativeDeploymentChart(state: DashboardState, input: unknown = state.run?.chart): NativeDeploymentChartAdmission {
  if (input === undefined) return { warnings: [] };
  try { return { chart: admit(state, readDeploymentChart(input)), warnings: [] }; }
  catch { return { warnings: [unavailable] }; }
}

function admit(state: DashboardState, chart: DeploymentChart): NativeDeploymentChartView {
  const graph = state.graph, run = state.run;
  require(graph && run && !!run.id && chart.runId === run.id && chart.stack === graph.name
    && chart.graphDigest === graph.digest);
  require(chart.resources.length > 0 && chart.resources.length <= MAX_RESOURCES
    && chart.resources.length === graph.resources.length);
  const desired = new Set(graph.resources.map(resource => resource.id));
  require(desired.size === graph.resources.length && chart.resources.every(binding => desired.has(binding.resourceId)));

  const { spine, stages } = topology(chart.structure);
  const groups = new Map<string, DeploymentResourceStages[]>();
  for (const binding of chart.resources) groups.set(binding.gateStageId, [...groups.get(binding.gateStageId) ?? [], binding]);
  require(spine.filter(stage => groups.has(stage.id)).length === groups.size);
  require(spine.every(stage => !['decider', 'selector', 'fork'].includes(stage.type) || groups.has(stage.id)));
  const spineIds = new Set(spine.map(stage => stage.id));
  const batches: NativeDeploymentBatch[] = [], nodes: NativeDeploymentNode[] = [];
  for (const gate of spine) {
    const bindings = groups.get(gate.id);
    if (!bindings) continue;
    const column = batches.length, parallel = bindings.length > 1;
    require(bindings.length <= MAX_BRANCHES && bindings.every(binding => binding.batchIndex === column));
    require(gate.type === (parallel ? 'selector' : 'decider'));
    const children = gate.children ?? [], childIds = children.map(child => child.id);
    const branchIds = (gate as NativeStage & { branchIds?: unknown }).branchIds;
    if (branchIds !== undefined) require(Array.isArray(branchIds) && branchIds.length === childIds.length
      && branchIds.every((id, index) => id === childIds[index]));
    const skipped = new Set(bindings.map(binding => binding.skipStageId));
    require(skipped.size === 1);
    const execute = new Map(bindings.map(binding => [binding.executeStageId, binding]));
    require(execute.size === bindings.length);
    const expected = new Set([...execute.keys(), ...skipped]);
    require(expected.size === bindings.length + 1 && children.length === expected.size
      && children.every(child => expected.has(child.id) && child.type === 'stage' && !spineIds.has(child.id)));
    let joinStageId: string | undefined;
    if (parallel) {
      joinStageId = bindings[0]!.joinStageId;
      require(!!joinStageId && bindings.every(binding => binding.joinStageId === joinStageId)
        && gate.next?.id === joinStageId && stages.get(joinStageId)?.type === 'stage'
        && !groups.has(joinStageId));
    } else require(bindings[0]!.joinStageId === undefined);
    const ordered = children.flatMap(child => execute.get(child.id) ?? []);
    require(ordered.length === bindings.length);
    batches.push({ index: column, gateStageId: gate.id, ...(joinStageId ? { joinStageId } : {}),
      resourceIds: ordered.map(binding => binding.resourceId), scheduledParallel: parallel });
    for (const [row, binding] of ordered.entries()) nodes.push({ ...binding, column, row });
  }
  require(nodes.length === graph.resources.length);
  const edges: NativeDeploymentScheduleEdge[] = [];
  for (let index = 1; index < batches.length; index++) {
    const before = batches[index - 1]!, after = batches[index]!;
    require(edges.length + before.resourceIds.length * after.resourceIds.length <= MAX_EDGES);
    for (const source of before.resourceIds) for (const target of after.resourceIds) edges.push({
      id: `native-schedule:${source}:${target}`, source, target, kind: 'native-schedule', label: 'Next scheduled batch',
    });
  }
  return { runId: chart.runId, batches, nodes, edges };
}

/** Walking is bounded and iterative; stage names never participate in binding or ordering. */
function topology(root: NativeStage): { spine: NativeStage[]; stages: Map<string, NativeStage> } {
  const stages = new Map<string, NativeStage>(), pending = [root];
  while (pending.length) {
    const stage = pending.pop()!;
    require(stages.size < MAX_STAGES && !stages.has(stage.id));
    stages.set(stage.id, stage);
    if (stage.next) pending.push(stage.next);
    if (stage.children) pending.push(...stage.children);
    if (stage.subflowStructure) pending.push(stage.subflowStructure);
  }
  const spine: NativeStage[] = [], seen = new Set<string>();
  let current: NativeStage | undefined = root;
  while (current) {
    require(spine.length < MAX_STAGES && !seen.has(current.id));
    seen.add(current.id); spine.push(current); current = current.next;
  }
  return { spine, stages };
}

function require(condition: unknown): asserts condition { if (!condition) throw Error('Invalid native deployment chart binding'); }
