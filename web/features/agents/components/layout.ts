import type { AgentComponentGraphView } from '../../../../src/core/agent-components.ts';

export interface SceneBox { id: string; x: number; y: number; width: number; height: number; depth: number; collapsed?: boolean; empty?: boolean }
export interface ComponentLayout { width: number; height: number; nodes: SceneBox[]; boundaries: SceneBox[] }
type Entry = { id: string; type: 'node' | 'boundary'; width: number; height: number; rank: number; layout?: ComponentLayout; collapsed?: boolean; empty?: boolean };
const nodeWidth = 152, nodeHeight = 88, gapX = 28, gapY = 12, inset = 12, heading = 30;

/** Containment supplies the boxes; only order relations supply the execution ranks. */
export function layoutComponentGraph(view: Pick<AgentComponentGraphView, 'nodes' | 'boundaries' | 'relations'>, collapsed: ReadonlySet<string>): ComponentLayout {
  const nodeIds = new Set(view.nodes.map(node => node.id)), ranks = new Map(view.nodes.map(node => [node.id, 0]));
  const order = view.relations.filter(edge => edge.kind === 'order' && nodeIds.has(edge.from) && nodeIds.has(edge.to));
  // Admission rejects cycles. The bound also makes this pure renderer safe for a caller-supplied partial view.
  for (let pass = 0; pass < view.nodes.length; pass++) {
    let changed = false;
    for (const edge of order) {
      const next = (ranks.get(edge.from) ?? 0) + 1;
      if (next > (ranks.get(edge.to) ?? 0)) { ranks.set(edge.to, next); changed = true; }
    }
    if (!changed) break;
  }
  const boundaryIds = new Set(view.boundaries.map(boundary => boundary.id));
  const nodeParents = new Map(view.nodes.map(node => [node.id, node.boundaryId && boundaryIds.has(node.boundaryId) ? node.boundaryId : undefined]));
  const boundaryParents = new Map(view.boundaries.map(boundary => [boundary.id, boundary.parentId && boundaryIds.has(boundary.parentId) ? boundary.parentId : undefined]));
  const active = new Set<string>();
  function children(parent?: string): ComponentLayout {
    const entries: Entry[] = [
      ...view.nodes.filter(node => nodeParents.get(node.id) === parent).map(node => ({ id: node.id, type: 'node' as const, width: nodeWidth, height: nodeHeight, rank: ranks.get(node.id) ?? 0 })),
      ...view.boundaries.filter(boundary => boundaryParents.get(boundary.id) === parent).map(boundary => {
        if (active.has(boundary.id)) return { id: boundary.id, type: 'boundary' as const, width: 210, height: 120, rank: 0, collapsed: true };
        if (collapsed.has(boundary.id)) return { id: boundary.id, type: 'boundary' as const, width: 210, height: 124, rank: minRank(boundary.id), collapsed: true };
        active.add(boundary.id); const layout = children(boundary.id); active.delete(boundary.id);
        return { id: boundary.id, type: 'boundary' as const, width: Math.max(210, layout.width + inset * 2), height: Math.max(124, layout.height + heading + inset), rank: minRank(boundary.id), layout, empty: !layout.nodes.length && !layout.boundaries.length };
      }),
    ];
    entries.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
    return pack(entries);
  }
  function minRank(id: string): number {
    const descendants = new Set([id]);
    for (let pass = 0; pass < view.boundaries.length; pass++) for (const boundary of view.boundaries) if (boundary.parentId && descendants.has(boundary.parentId)) descendants.add(boundary.id);
    const values = view.nodes.filter(node => node.boundaryId && descendants.has(node.boundaryId)).map(node => ranks.get(node.id) ?? 0);
    return values.length ? Math.min(...values) : 0;
  }
  function pack(entries: Entry[]): ComponentLayout {
    const result: ComponentLayout = { width: 0, height: 0, nodes: [], boundaries: [] };
    const positions = new Map<string, { x: number; y: number }>();
    const uniqueRanks = [...new Set(entries.map(entry => entry.rank))];
    if (entries.every(entry => entry.type === 'node') && uniqueRanks.length > 1) {
      let x = 0;
      for (const rank of uniqueRanks.sort((a, b) => a - b)) {
        const column = entries.filter(entry => entry.rank === rank);
        column.forEach((entry, index) => positions.set(entry.id, { x, y: index * (nodeHeight + gapY) }));
        x += nodeWidth + gapX;
      }
    } else {
      const largest = [...entries].sort((a, b) => b.width - a.width)[0];
      if (largest && largest.width > 400 && entries.length > 1 && entries.filter(entry => entry !== largest).every(entry => entry.width <= 250)) {
        positions.set(largest.id, { x: 0, y: 0 }); let y = 0;
        for (const entry of entries.filter(entry => entry !== largest)) { positions.set(entry.id, { x: largest.width + gapX, y }); y += entry.height + gapY; }
      } else {
        const columns = Math.min(3, Math.max(1, entries.length)), widths = Array.from({ length: columns }, (_, col) => Math.max(0, ...entries.filter((_, index) => index % columns === col).map(entry => entry.width)));
        const rows = Math.ceil(entries.length / columns), heights = Array.from({ length: rows }, (_, row) => Math.max(0, ...entries.slice(row * columns, (row + 1) * columns).map(entry => entry.height)));
        entries.forEach((entry, index) => { const col = index % columns, row = Math.floor(index / columns); positions.set(entry.id, { x: widths.slice(0, col).reduce((a, b) => a + b + gapX, 0), y: heights.slice(0, row).reduce((a, b) => a + b + gapY, 0) }); });
      }
    }
    for (const entry of entries) {
      const { x, y } = positions.get(entry.id)!;
      const box: SceneBox = { id: entry.id, x, y, width: entry.width, height: entry.height, depth: 0, ...(entry.collapsed ? { collapsed: true } : {}), ...(entry.empty ? { empty: true } : {}) };
      result.width = Math.max(result.width, x + entry.width); result.height = Math.max(result.height, y + entry.height);
      if (entry.type === 'node') result.nodes.push(box);
      else {
        result.boundaries.push(box);
        if (entry.layout) {
          const move = (child: SceneBox) => ({ ...child, x: child.x + x + inset, y: child.y + y + heading, depth: child.depth + 1 });
          result.nodes.push(...entry.layout.nodes.map(move)); result.boundaries.push(...entry.layout.boundaries.map(move));
        }
      }
    }
    return result;
  }
  const result = children();
  return { ...result, width: Math.max(300, result.width), height: Math.max(190, result.height) };
}
