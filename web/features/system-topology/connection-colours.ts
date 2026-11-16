import type { TopologyConnectionView } from 'footprintjs-iac/system-topology';

// Connection identity uses colour; check outcomes remain explicit in each badge.
const palette = ['#5265ad', '#087e98', '#9060ad', '#9a6a27', '#287f78', '#af5788'];
export function connectionColours(connections: readonly TopologyConnectionView[]): ReadonlyMap<string, string> {
  return new Map(connections.map(edge => edge.id).sort().map((id, index) => [id, palette[index % palette.length]!]));
}
export function connectionColour(edge: TopologyConnectionView, colours: ReadonlyMap<string, string>): string {
  if (edge.status === 'connected') return colours.get(edge.id) ?? palette[0]!;
  if (edge.status === 'failed') return '#cf5464';
  if (edge.status === 'checking') return '#b67a18';
  return '#94a6bb';
}
