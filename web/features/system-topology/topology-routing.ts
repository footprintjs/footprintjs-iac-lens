import type { TopologyBox } from './topology-layout.ts';
import { blocked, congestion, inside, labelRect, ports, roundedPath, type Port, type Rect, type TopologyPoint, type TopologyRoute } from './topology-route-geometry.ts';
import { placeTopologyLabel } from './topology-route-labels.ts';
export type { TopologyPoint, TopologyRoute } from './topology-route-geometry.ts';
interface Search { key: string; x: number; y: number; direction: number; cost: number; score: number; port: number }

/** A bounded visibility grid reserves room for nodes, titles, other badges and wires. */
export function routeTopologyConnection(from: TopologyBox, to: TopologyBox, boxes: ReadonlyMap<string, TopologyBox>, used: readonly TopologyRoute[] = [], options: { label?: boolean; bottomPorts?: boolean } = {}): TopologyRoute {
  const all = [...boxes.values()];
  const obstacles: Rect[] = all.map(box => ({ ...box, height: box.kind === 'boundary' ? 28 : box.height }));
  const rectangles = [...obstacles, ...used.filter(route => !route.labelHidden).map(labelRect)];
  const width = Math.max(...all.map(box => box.x + box.width)) + 14;
  const height = Math.max(...all.map(box => box.y + box.height)) + 22;
  function available(box: TopologyBox, other: TopologyBox): Port[] {
    return ports(box, other, used).filter(port => !inside(port.out, box)
      && !rectangles.some(rect => inside(port.out, rect))
      && !blocked(port.edge, port.out, rectangles.filter(rect => rect !== box && !(rect.x === box.x && rect.y === box.y && rect.width === box.width && rect.height === box.height))));
  }
  const sources = available(from, to).filter(port => !options.bottomPorts || port.edge.y === from.y + from.height);
  const targets = available(to, from).filter(port => !options.bottomPorts || port.edge.y === to.y + to.height);
  const empty = (): TopologyRoute => ({ path: '', x: 0, y: 0, points: [], labelHidden: true });
  if (!sources.length || !targets.length) return empty();
  const coordinates = (axis: 'x' | 'y') => {
    const limit = axis === 'x' ? width : height;
    const raw = [4, limit - 4, ...rectangles.flatMap(rect => [rect[axis] - 6, rect[axis] + (axis === 'x' ? rect.width : rect.height) + 6]),
      ...sources.map(port => port.out[axis]), ...targets.map(port => port.out[axis]),
      ...used.flatMap(route => route.points.flatMap(point => [point[axis] - 10, point[axis] + 10]))].filter(value => value >= 2 && value <= limit - 2);
    return [...new Set(raw)].sort((a, b) => a - b);
  };
  const xs = coordinates('x'), ys = coordinates('y');
  const key = (x: number, y: number, direction: number) => `${x}:${y}:${direction}`;
  const queue: Search[] = [], best = new Map<string, number>(), previous = new Map<string, string>(), states = new Map<string, Search>();
  const heuristic = (x: number, y: number) => Math.min(...targets.map(port => Math.abs(x - port.out.x) + Math.abs(y - port.out.y) + port.penalty));
  function push(row: Search) {
    let index = queue.length; queue.push(row);
    while (index) { const parent = (index - 1) >> 1; if (queue[parent]!.score <= row.score) break; queue[index] = queue[parent]!; index = parent; }
    queue[index] = row;
  }
  function pop(): Search {
    const first = queue[0]!, last = queue.pop()!;
    if (queue.length) {
      let index = 0;
      while (index * 2 + 1 < queue.length) {
        let child = index * 2 + 1; if (child + 1 < queue.length && queue[child + 1]!.score < queue[child]!.score) child++;
        if (queue[child]!.score >= last.score) break; queue[index] = queue[child]!; index = child;
      }
      queue[index] = last;
    }
    return first;
  }
  sources.forEach((port, index) => {
    const x = xs.indexOf(port.out.x), y = ys.indexOf(port.out.y), direction = port.out.x === port.edge.x ? 2 : 1;
    const id = key(x, y, direction), cost = port.penalty;
    const row = { key: id, x, y, direction, cost, score: cost + heuristic(port.out.x, port.out.y), port: index };
    if (cost >= (best.get(id) ?? Infinity)) return;
    best.set(id, cost); states.set(id, row); push(row);
  });
  let final: Search | undefined, target: Port | undefined, finalCost = Infinity, visits = 0;
  while (queue.length && visits++ < 60000) {
    const current = pop(); if (current.cost !== best.get(current.key)) continue; if (current.score >= finalCost) break;
    const point = { x: xs[current.x]!, y: ys[current.y]! };
    for (const end of targets) if (point.x === end.out.x && point.y === end.out.y) {
      const cost = current.cost + end.penalty + (current.direction === (end.out.x === end.edge.x ? 2 : 1) ? 0 : 14);
      if (cost < finalCost) { final = current; target = end; finalCost = cost; }
    }
    for (const [dx, dy, direction] of [[1, 0, 1], [-1, 0, 1], [0, 1, 2], [0, -1, 2]]) {
      const x = current.x + dx!, y = current.y + dy!;
      if (x < 0 || y < 0 || x >= xs.length || y >= ys.length) continue;
      const next = { x: xs[x]!, y: ys[y]! }; if (blocked(point, next, rectangles)) continue;
      const cost = current.cost + Math.abs(next.x - point.x) + Math.abs(next.y - point.y)
        + (current.direction !== direction ? 14 : 0) + congestion(point, next, used);
      const id = key(x, y, direction!); if (cost >= (best.get(id) ?? Infinity)) continue;
      const row = { key: id, x, y, direction: direction!, cost, score: cost + heuristic(next.x, next.y), port: current.port };
      best.set(id, cost); previous.set(id, current.key); states.set(id, row); push(row);
    }
  }
  if (!final || !target) return empty();
  const points: TopologyPoint[] = [target.edge]; let state: Search | undefined = final;
  while (state) { points.push({ x: xs[state.x]!, y: ys[state.y]! }); const prior = previous.get(state.key); state = prior ? states.get(prior) : undefined; }
  points.push(sources[final.port]!.edge); points.reverse();
  const compact = points.filter((point, index) => {
    const a = points[index - 1], b = points[index + 1];
    return !a || !b || !(a.x === point.x && point.x === b.x || a.y === point.y && point.y === b.y);
  });
  const route = { path: roundedPath(compact), x: 0, y: 0, points: compact };
  if (options.label === false) return { ...route, labelHidden: true };
  const labelled = placeTopologyLabel(route, obstacles, used, width, height);
  if (labelled.labelHidden && !options.bottomPorts) {
    const alternate = routeTopologyConnection(from, to, boxes, used, { ...options, bottomPorts: true });
    if (alternate.path && !alternate.labelHidden) return alternate;
  }
  return labelled;
}
