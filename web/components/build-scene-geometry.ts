import type { BuildScene } from '../../src/core/build-scene.ts';

/** Coordinates position cards and wires; text remains ordinary, unscaled HTML. */
export function buildSceneGeometry(scene: Pick<BuildScene, 'nodes' | 'edges'>) {
  const columns = [...new Set(scene.nodes.map(node => node.column))].sort((a, b) => a - b);
  const rows = Math.max(0, ...scene.nodes.map(node => node.row)) + 1;
  const rowHeight = scene.nodes.some(node => node.embedded.length > 0) ? 216 : 184;
  const width = 164 + Math.max(1, columns.length) * 190 + 16;
  const height = 18 + rows * rowHeight + (scene.edges.length ? 60 + Math.min(2, scene.edges.length - 1) * 16 : 8);
  const locations = new Map(scene.nodes.map(node => [node.id, {
    x: 164 + columns.indexOf(node.column) * 190,
    y: 18 + node.row * rowHeight,
  }]));
  return { width, height, locations };
}

export const buildSceneCategory = {
  compute: 'Compute', storage: 'Storage', network: 'Network', identity: 'Identity',
  space: 'Boundary', policy: 'Access', resource: 'Resource',
} as const;
