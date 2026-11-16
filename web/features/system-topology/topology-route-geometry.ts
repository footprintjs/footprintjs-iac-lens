import type { TopologyBox } from './topology-layout.ts';

export interface TopologyPoint { x: number; y: number }
export interface TopologyRoute {
  path: string; x: number; y: number; points: readonly TopologyPoint[]; labelHidden?: boolean;
}
export interface Rect { x: number; y: number; width: number; height: number }
export interface Port { edge: TopologyPoint; out: TopologyPoint; penalty: number }
export const LABEL_WIDTH = 72, LABEL_HEIGHT = 20;
export const samePoint = (a: TopologyPoint, b: TopologyPoint) => a.x === b.x && a.y === b.y;
export const inside = (p: TopologyPoint, r: Rect, pad = 2) => p.x > r.x - pad && p.x < r.x + r.width + pad && p.y > r.y - pad && p.y < r.y + r.height + pad;
export const overlaps = (a: Rect, b: Rect, pad = 2) => a.x < b.x + b.width + pad && a.x + a.width > b.x - pad && a.y < b.y + b.height + pad && a.y + a.height > b.y - pad;
export const labelRect = (point: TopologyPoint): Rect => ({ x: point.x - LABEL_WIDTH / 2, y: point.y - LABEL_HEIGHT / 2, width: LABEL_WIDTH, height: LABEL_HEIGHT });
export function blocked(a: TopologyPoint, b: TopologyPoint, rectangles: readonly Rect[], pad = 2): boolean {
  return rectangles.some(r => a.x === b.x
    ? a.x > r.x - pad && a.x < r.x + r.width + pad && Math.max(a.y, b.y) > r.y - pad && Math.min(a.y, b.y) < r.y + r.height + pad
    : a.y > r.y - pad && a.y < r.y + r.height + pad && Math.max(a.x, b.x) > r.x - pad && Math.min(a.x, b.x) < r.x + r.width + pad);
}

/** Separate ports keep fan-in and fan-out arrowheads from merging. */
export function ports(box: TopologyBox, other: TopologyBox, used: readonly TopologyRoute[]): Port[] {
  const { x, y, width: w, height: h } = box, cx = x + w / 2, cy = y + h / 2;
  const dx = other.x + other.width / 2 - cx, dy = other.y + other.height / 2 - cy;
  const preferred = Math.abs(dx) > Math.abs(dy) ? dx >= 0 ? 'right' : 'left' : dy >= 0 ? 'bottom' : 'top';
  const occupied = used.flatMap(route => route.points.length ? [route.points[0]!, route.points.at(-1)!] : []);
  return ['top', 'bottom', 'left', 'right'].flatMap(side => [0, -24, 24, -48, 48].flatMap((offset, index) => {
    if ((side === 'left' || side === 'right') && Math.abs(offset) > h / 2 - 16) return [];
    const edge = side === 'top' || side === 'bottom'
      ? { x: cx + offset, y: side === 'top' ? y : y + h }
      : { x: side === 'left' ? x : x + w, y: cy + offset };
    if (occupied.some(point => Math.hypot(point.x - edge.x, point.y - edge.y) < 16)) return [];
    const out = { x: edge.x + (side === 'left' ? -16 : side === 'right' ? 16 : 0), y: edge.y + (side === 'top' ? -12 : side === 'bottom' ? 24 : 0) };
    return [{ edge, out, penalty: (side === preferred ? 0 : 48) + index * 3 }];
  }));
}

/** Curves stay inside the free orthogonal corridor, with straight terminal stubs. */
export function roundedPath(points: readonly TopologyPoint[]): string {
  if (!points.length) return '';
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, c = points[i + 1];
    if (!c) { path += ` L ${b.x} ${b.y}`; continue; }
    const nextLength = Math.abs(c.x - b.x) + Math.abs(c.y - b.y);
    const radius = Math.min(6, (Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) / 2, nextLength / 2,
      i === points.length - 2 ? Math.max(0, nextLength - 10) : Infinity);
    const entry = { x: b.x + Math.sign(a.x - b.x) * radius, y: b.y + Math.sign(a.y - b.y) * radius };
    const exit = { x: b.x + Math.sign(c.x - b.x) * radius, y: b.y + Math.sign(c.y - b.y) * radius };
    path += ` L ${entry.x} ${entry.y} Q ${b.x} ${b.y} ${exit.x} ${exit.y}`;
  }
  return path;
}

/** Cost near parallel lines is proportional to shared length; crossings are explicit. */
export function congestion(a: TopologyPoint, b: TopologyPoint, used: readonly TopologyRoute[]): number {
  let cost = 0;
  for (const route of used) for (let i = 1; i < route.points.length; i++) {
    const c = route.points[i - 1]!, d = route.points[i]!;
    const vertical = a.x === b.x, otherVertical = c.x === d.x;
    if (vertical === otherVertical) {
      const distance = Math.abs(vertical ? a.x - c.x : a.y - c.y);
      const overlap = vertical
        ? Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))
        : Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
      if (overlap > 0 && distance < 10) cost += overlap * (10 - distance) * 3;
    } else {
      const v = vertical ? a : c, h = vertical ? c : a, v2 = vertical ? b : d, h2 = vertical ? d : b;
      if (v.x >= Math.min(h.x, h2.x) && v.x <= Math.max(h.x, h2.x) && h.y >= Math.min(v.y, v2.y) && h.y <= Math.max(v.y, v2.y)) cost += 28;
    }
  }
  return cost;
}
