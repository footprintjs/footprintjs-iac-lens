import { ComponentGlyph } from './ComponentGlyph.tsx';
import type { SceneBox } from './layout.ts';
import { componentStatusLabels, labelLines, progressPresentation, type ComponentNode as ComponentNodeView } from './model.ts';

export function ComponentNode({ node, box, onInspect }: { node: ComponentNodeView; box: SceneBox; onInspect(): void }) {
  const lines = labelLines(node.label), label = `${node.label}: ${componentStatusLabels[node.status]}`;
  return <g className="agent-component-node" data-status={node.status} data-component-id={node.id} role="button" tabIndex={0} aria-label={label} transform={`translate(${box.x},${box.y})`} onClick={onInspect} onKeyDown={event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onInspect(); }
  }}>
    <rect className="agent-component-hit" x="0" y="0" width={box.width} height={box.height} rx="10"/>
    <ComponentGlyph node={node} x={box.width / 2} y={22} scale={.72}/>
    <text x={box.width / 2} y="51" textAnchor="middle" className="agent-component-name">{lines.map((line, index) => <tspan key={index} x={box.width / 2} dy={index ? 14 : 0}>{line}</tspan>)}</text>
    <text x={box.width / 2} y={lines.length > 1 ? 81 : 70} textAnchor="middle" className="agent-component-state">{componentStatusLabels[node.status]}</text>
    <title>{`${label}. ${progressPresentation(node.progress).label}.${node.sharing === 'shared' ? ' Shared resource.' : ''}`}</title>
  </g>;
}
