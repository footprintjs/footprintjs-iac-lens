import type { TopologyConnectionView } from 'footprintjs-iac/system-topology';

// Connection identity uses colour; check outcomes remain explicit in each badge.
const palette = ['var(--fp-chip-1, #5265ad)', 'var(--fp-chip-2, #087e98)', 'var(--fp-chip-3, #9060ad)', 'var(--fp-chip-4, #9a6a27)', 'var(--fp-tracing, #287f78)', 'var(--fp-accent, #af5788)'];
export function connectionColours(connections: readonly TopologyConnectionView[]): ReadonlyMap<string, string> {
  return new Map(connections.map(edge => edge.id).sort().map((id, index) => [id, palette[index % palette.length]!]));
}
export function connectionColour(edge: TopologyConnectionView, colours: ReadonlyMap<string, string>): string {
  if (edge.status === 'connected') return colours.get(edge.id) ?? palette[0]!;
  if (edge.status === 'failed') return 'var(--fp-color-error, #cf5464)';
  if (edge.status === 'checking') return 'var(--fp-color-warning, #b67a18)';
  return 'var(--fp-text-muted, #94a6bb)';
}
