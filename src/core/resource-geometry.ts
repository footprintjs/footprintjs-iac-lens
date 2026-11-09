import type { ResourceDescription } from './model.ts';

export interface LayoutPoint { x: number; y: number }
export interface ResourceBox { position: LayoutPoint; size: { width: number; height: number } }
export interface ResourceEdgeRoute {
  points: LayoutPoint[];
  sourceHandle: 'order-out' | 'communication-out';
  targetHandle: 'order-in' | 'communication-in';
  labelPosition?: LayoutPoint;
}

export const RESOURCE_WIDTH = 196;
export const COMMUNICATION_SOURCE_OFFSET = .68;
export const COMMUNICATION_TARGET_OFFSET = .32;

/** Conservative text metrics reserve room for wrapping without requiring a browser. */
export function resourceSize(description: ResourceDescription): ResourceBox['size'] {
  const titleLines = Math.max(1, Math.ceil(description.name.length * 7.8 / 106));
  const kindLines = Math.max(1, Math.ceil(description.kind.length * 5.8 / 106));
  const capabilityLines = Math.max(1, Math.ceil((description.capability ?? description.family).length * 5.8 / 84));
  const heading = Math.max(30, titleLines * 18.2 + 5 + kindLines * 13);
  const footer = Math.max(24, capabilityLines * 14) + 21;
  return { width: RESOURCE_WIDTH, height: Math.ceil(13 + heading + 13 + footer + 3) + 4 };
}

export function resourceColumnGap(columns: number): number {
  return columns <= 3 ? 104 : columns === 4 ? 72 : 56;
}

export function orderRoute(source: ResourceBox, target: ResourceBox): ResourceEdgeRoute {
  const start = { x: source.position.x + source.size.width, y: source.position.y + source.size.height / 2 };
  const end = { x: target.position.x, y: target.position.y + target.size.height / 2 };
  const middle = (start.x + end.x) / 2;
  return { sourceHandle: 'order-out', targetHandle: 'order-in', points: [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end] };
}

/** Communication is descriptive, so it gets its own lane outside the deployment path. */
export function communicationRoute(source: ResourceBox, target: ResourceBox, laneY: number): ResourceEdgeRoute {
  const start = { x: source.position.x + source.size.width * COMMUNICATION_SOURCE_OFFSET, y: source.position.y + source.size.height };
  const end = { x: target.position.x + target.size.width * COMMUNICATION_TARGET_OFFSET, y: target.position.y + target.size.height };
  const sourceCorridor = source.position.x + source.size.width + 24;
  const targetCorridor = target.position.x - 24;
  return {
    sourceHandle: 'communication-out', targetHandle: 'communication-in',
    points: [start, { x: start.x, y: start.y + 20 }, { x: sourceCorridor, y: start.y + 20 },
      { x: sourceCorridor, y: laneY }, { x: targetCorridor, y: laneY },
      { x: targetCorridor, y: end.y + 20 }, { x: end.x, y: end.y + 20 }, end],
    labelPosition: { x: (sourceCorridor + targetCorridor) / 2, y: laneY },
  };
}

/** Rounded orthogonal path usable by SVG, canvas adapters, or other renderers. */
export function resourceEdgePath(points: readonly LayoutPoint[], radius = 10): string {
  const distinct = points.filter((point, index) => !index || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y);
  const first = distinct[0];
  if (!first) return '';
  let path = `M ${first.x} ${first.y}`;
  for (let index = 1; index < distinct.length; index++) {
    const point = distinct[index]!;
    const previous = distinct[index - 1]!;
    const next = distinct[index + 1];
    if (!next) { path += ` L ${point.x} ${point.y}`; continue; }
    const before = Math.hypot(point.x - previous.x, point.y - previous.y);
    const after = Math.hypot(next.x - point.x, next.y - point.y);
    const turn = Math.min(radius, before / 2, after / 2);
    const entry = { x: point.x + (previous.x - point.x) / before * turn, y: point.y + (previous.y - point.y) / before * turn };
    const exit = { x: point.x + (next.x - point.x) / after * turn, y: point.y + (next.y - point.y) / after * turn };
    path += ` L ${entry.x} ${entry.y} Q ${point.x} ${point.y} ${exit.x} ${exit.y}`;
  }
  return path;
}
