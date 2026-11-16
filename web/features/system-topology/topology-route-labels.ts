import { blocked, labelRect, overlaps, type Rect, type TopologyPoint, type TopologyRoute } from './topology-route-geometry.ts';

/** Badges belong to a straight segment, clear of cards, bends and other wires. */
export function placeTopologyLabel(route: TopologyRoute, obstacles: readonly Rect[], used: readonly TopologyRoute[], width: number, height: number): TopologyRoute {
  const segments = route.points.slice(1).map((b, index) => ({ a: route.points[index]!, b }));
  segments.sort((a, b) => Math.abs(b.a.x - b.b.x) - Math.abs(a.a.x - a.b.x));
  for (const { a, b } of segments) {
    const horizontal = a.y === b.y, length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (length < (horizontal ? 88 : 36)) continue;
    for (const fraction of [.5, .35, .65, .2, .8]) {
      const point: TopologyPoint = { x: Math.round(a.x + (b.x - a.x) * fraction), y: Math.round(a.y + (b.y - a.y) * fraction) };
      const rect = labelRect(point);
      if (rect.x < 3 || rect.y < 3 || rect.x + rect.width > width - 3 || rect.y + rect.height > height - 3) continue;
      if (horizontal ? Math.min(Math.abs(point.x - a.x), Math.abs(point.x - b.x)) < 44 : Math.min(Math.abs(point.y - a.y), Math.abs(point.y - b.y)) < 18) continue;
      if (obstacles.some(obstacle => overlaps(rect, obstacle, 3))) continue;
      if (used.some(other => !other.labelHidden && overlaps(rect, labelRect(other), 4))) continue;
      if (used.some(other => other.points.some((end, index) => index > 0 && blocked(other.points[index - 1]!, end, [rect], 3)))) continue;
      return { ...route, ...point };
    }
  }
  return { ...route, labelHidden: true };
}
