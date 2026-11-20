import type { DeploymentChart } from 'footprintjs-iac/progress';
import type { AdapterDeploymentEdge, AdapterDeploymentResource, AdapterDeploymentStage } from './adapter-deployment.ts';

type Native = DeploymentChart['structure'];
export interface BranchAncestor { gateId: string; branchId: string }
export interface AdapterTopology { resources: AdapterDeploymentResource[]; ancestry: Map<string, BranchAncestor[]>; children: Map<string, string[]> }
const absolute = (scope: string, id: string) => scope ? `${scope}/${id}` : id;

/** Mounted charts own namespaces; references stay within their native scope. */
export function buildAdapterTopology(chart: DeploymentChart, selected?: string, includeStandalone = false): AdapterTopology {
  const root = new Map<string, Native>(), pending = [chart.structure];
  while (pending.length) {
    const stage = pending.pop()!;
    if (root.size > 4096) throw Error('Oversized chart');
    if (!stage.isLoopReference) root.set(stage.id, stage);
    if (stage.next) pending.push(stage.next);
    if (stage.children) pending.push(...stage.children);
  }
  const ancestry = new Map<string, BranchAncestor[]>(), children = new Map<string, string[]>(), resources: AdapterDeploymentResource[] = [];
  let work = 0;
  for (const binding of chart.resources) {
    if (selected && binding.resourceId !== selected) continue;
    const mount = root.get(binding.executeStageId);
    if (!mount || (!mount.subflowStructure && !includeStandalone)) continue;
    const resource: AdapterDeploymentResource = { resourceId: binding.resourceId, label: mount.name, action: binding.action,
      rootScope: binding.executeStageId, stages: [], edges: [], scopes: [] };
    if (!mount.subflowStructure) {
      resource.scopes.push({ id: mount.id, label: mount.name });
      resource.stages.push({ id: mount.id, stageId: mount.id, label: mount.name, kind: 'stage', nativeKind: mount.type,
        scope: mount.id, resourceId: binding.resourceId, status: 'pending', runtimeStageIds: [], executions: 0, column: 0, row: 0 });
      resources.push(resource);
      continue;
    }
    const byId = new Map<string, AdapterDeploymentStage>();
    function scope(first: Native, id: string, label: string, ancestors: BranchAncestor[], parentScope?: string, mountStageId?: string): void {
      resource.scopes.push({ id, label, ...(parentScope ? { parentScope } : {}), ...(mountStageId ? { mountStageId } : {}) });
      const heights = new WeakMap<object, number>();
      function height(node: Native): number {
        if (++work > 12000) throw Error('Oversized adapter chart');
        const prior = heights.get(node); if (prior !== undefined) return prior;
        const value = node.isLoopReference ? 1 : Math.max(1, node.children?.reduce((sum, child) => sum + height(child), 0) ?? 0, node.next ? height(node.next) : 1);
        heights.set(node, value); return value;
      }
      function chain(node: Native, column: number, lane: number, ancestors: BranchAncestor[]): { exits: string[]; column: number } {
        if (++work > 12000) throw Error('Oversized adapter chart');
        const full = absolute(id, node.id);
        if (node.isLoopReference) return { exits: [], column };
        if (byId.has(full)) throw Error('Ambiguous adapter stage');
        const kind = node.subflowStructure ? 'subflow' : ['decider', 'selector', 'fork'].includes(node.type) ? 'decision' : node.type === 'loop' ? 'loop' : 'stage';
        const stage: AdapterDeploymentStage = { id: full, stageId: node.id, label: node.name.split('/').at(-1)!, kind, nativeKind:node.type,
          scope: id, resourceId: binding.resourceId, status: 'pending', runtimeStageIds: [], executions: 0, column, row: lane };
        byId.set(full, stage); resource.stages.push(stage); ancestry.set(full, ancestors);
        if (node.subflowStructure) {
          stage.childScope = full;
          scope(node.subflowStructure, full, stage.label, ancestors, id, full);
        }
        let exits = [full], endColumn = column;
        if (node.children?.length) {
          children.set(full, node.children.map(child => absolute(id, child.id)));
          exits = [];
          let branchRow = lane;
          for (const child of node.children) {
            const target = absolute(id, child.id), kind = child.isLoopReference ? 'loop' : 'branch';
            resource.edges.push({ id: `${full}->${target}`, source: full, target, kind, label: child.name.split('/').at(-1) });
            const result = chain(child, column + 1, branchRow, [...ancestors, { gateId: full, branchId: target }]);
            // Loop references point back; they do not become completion prerequisites for the continuation.
            if (!child.isLoopReference) exits.push(...result.exits);
            endColumn = Math.max(endColumn, result.column); branchRow += height(child);
          }
        }
        if (node.next) {
          const target = absolute(id, node.next.id);
          for (const source of exits) resource.edges.push({ id: `${source}->${target}`, source, target, kind: node.next.isLoopReference ? 'loop' : 'next' });
          return chain(node.next, endColumn + 1, lane, ancestors);
        }
        return { exits, column: endColumn };
      }
      chain(first, 0, 0, ancestors);
    }
    scope(mount.subflowStructure, binding.executeStageId, mount.name, []);
    // The base adapter chart's stable admission stage identifies a provider-neutral adapter body.
    resource.adapterScope = resource.scopes.filter(scope => resource.stages.some(stage => stage.scope === scope.id && stage.stageId === 'adapter-admit'))
      .sort((a, b) => resource.stages.filter(stage => stage.scope === b.id).length - resource.stages.filter(stage => stage.scope === a.id).length)[0]?.id;
    resources.push(resource);
  }
  return { resources, ancestry, children };
}
