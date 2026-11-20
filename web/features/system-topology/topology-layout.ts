import {routeTopologyConnection,type TopologyRoute} from './topology-routing.ts';
import type { SystemTopologyView } from 'footprintjs-iac/system-topology';
export interface TopologyBox { id: string; kind: 'node' | 'boundary'; x: number; y: number; width: number; height: number; depth: number }
/** Presentation dimensions only; no profile supplies resource meaning or work order. */
export interface TopologyGeometryProfile {nodeWidth?:number;nodeHeight?:number;boundaryHeaderWidth?:number;boundaryHeaderHeight?:number;boundaryTop?:number;nodeAnchorHeight?:number}
export const symbolGeometryProfile:Readonly<TopologyGeometryProfile>=Object.freeze({nodeWidth:224,nodeHeight:128,boundaryHeaderWidth:332});
export const componentArtworkSize = Object.freeze({width:144,height:124});
/** Upright consumer objects include artwork, native annotations and an unframed boundary caption. */
export const objectGeometryProfile:Readonly<TopologyGeometryProfile>=Object.freeze({
  nodeWidth:224,
  nodeHeight:componentArtworkSize.height+92,
  nodeAnchorHeight:componentArtworkSize.height,
  boundaryHeaderWidth:332,
  boundaryHeaderHeight:80,
  boundaryTop:96,
});
const dimension=(value:number|undefined,fallback:number)=>typeof value==='number'&&Number.isFinite(value)&&value>=32&&value<=512?value:fallback;
interface Group { box: TopologyBox; children: Group[] }
/** Placement is a tree of host/runtime boundaries, never a deployment schedule. */
export function layoutSystemTopology(view: SystemTopologyView,profile:TopologyGeometryProfile={}): { width: number; height: number; boxes: TopologyBox[] } {
  // Reserve actual wire corridors; card text keeps its original size.
  const gapX=40,gapY=40,inset=14,header=dimension(profile.boundaryTop,28);
  const nodeWidth=dimension(profile.nodeWidth,184),nodeHeight=dimension(profile.nodeHeight,104),boundaryWidth=dimension(profile.boundaryHeaderWidth,240);
  function group(id?: string, depth = 0): Group {
    const nested = view.boundaries.filter(row => row.parentId === id).map(row => group(row.id, depth + 1));
    const nodes: Group[] = view.nodes.filter(row => row.boundaryId === id).map(row => ({ box: { id: row.id, kind: 'node', x: 0, y: 0, width: nodeWidth, height: nodeHeight, depth }, children: [] }));
    const children = [...nested, ...nodes], rows: Group[][] = [];
    const rowLimit = id ? 3 * nodeWidth + 2 * gapX : 1200;
    let row: Group[] = [], used = 0;
    for (const child of children) {
      if (row.length && (row.length === 3 || used + gapX + child.box.width > rowLimit)) { rows.push(row); row = []; used = 0; }
      row.push(child); used += (row.length > 1 ? gapX : 0) + child.box.width;
    }
    if (row.length) rows.push(row);
    let y = id ? header + inset : 6, width = id ? boundaryWidth : 220;
    for (const row of rows) {
      let x = inset;
      for (const child of row) { child.box.x = x; child.box.y = y; x += child.box.width + gapX; }
      width = Math.max(width, x - gapX + inset); y += Math.max(...row.map(child => child.box.height), 0) + gapY;
    }
    return { box: { id: id ?? '', kind: 'boundary', x: 0, y: 0, width, height: Math.max(id ? 94 : 160, y - gapY + inset), depth }, children };
  }
  const root = group(), boxes: TopologyBox[] = [];
  function flatten(row: Group, parentX: number, parentY: number): void {
    const box = { ...row.box, x: row.box.x + parentX, y: row.box.y + parentY };
    if (box.id) boxes.push(box);
    row.children.forEach(child => flatten(child, box.x, box.y));
  }
  flatten(root, 0, 0);
  return { width: root.box.width, height: root.box.height + 8, boxes };
}
export function topologyConnectionPath(from: TopologyBox, to: TopologyBox, lane = 0, boxes?: ReadonlyMap<string, TopologyBox>, used: readonly TopologyRoute[] = []): { path: string; x: number; y: number } {
  if (boxes) return routeTopologyConnection(from,to,boxes,used);
  const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
  if (horizontal) {
    const forward = to.x >= from.x, x1 = from.x + (forward ? from.width : 0), x2 = to.x + (forward ? 0 : to.width);
    const y1 = from.y + from.height / 2, y2 = to.y + to.height / 2, bend = (x1 + x2) / 2 + lane * 8;
    return { path: `M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}`, x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  }
  const forward = to.y >= from.y, x1 = from.x + from.width / 2, x2 = to.x + to.width / 2;
  const y1 = from.y + (forward ? from.height : 0), y2 = to.y + (forward ? 0 : to.height), bend = (y1 + y2) / 2 + lane * 8;
  return { path: `M ${x1} ${y1} C ${x1} ${bend}, ${x2} ${bend}, ${x2} ${y2}`, x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
}
