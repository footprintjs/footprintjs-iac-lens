import { componentShape, type ComponentNode } from './model.ts';

/** Logical roles and measured storage mode select the glyph; a store is not automatically a database. */
export function ComponentGlyph({ node, x, y, scale = 1 }: { node: ComponentNode; x: number; y: number; scale?: number }) {
  const shape = componentShape(node);
  return <g transform={`translate(${x},${y}) scale(${scale})`} className="agent-component-glyph" data-shape={shape} aria-hidden="true">
    {shape === 'context' ? <><circle className="agent-component-shape-fill" r="22"/><path d="M-10-5H10M-10 2H6M-10 9H1"/></>
      : shape === 'database' ? <><path className="agent-component-shape-fill" d="M-21-16C-21-25 21-25 21-16V15C21 24-21 24-21 15Z"/><ellipse cx="0" cy="-16" rx="21" ry="8"/><path d="M-21-1C-21 8 21 8 21-1M-21 10C-21 19 21 19 21 10"/></>
      : shape === 'memory' ? <><rect className="agent-component-shape-fill" x="-27" y="-14" width="54" height="28" rx="5"/>{[-17, -6, 5, 16].map(point => <g key={point}><rect x={point} y="-7" width="7" height="13" rx="1.5"/><path d={`M${point + 2} 14v5`}/></g>)}</>
      : shape === 'process' ? <><rect className="agent-component-shape-fill" x="-20" y="-20" width="40" height="40" rx="9"/><rect x="-11" y="-11" width="22" height="22" rx="5"/>{[-10, 0, 10].map(point => <path key={point} d={`M${point}-26v6M${point} 20v6M-26 ${point}h6M20 ${point}h6`}/>)}</>
      : shape === 'connection' ? <><path d="M-22 14 0-15 22 14M-22 14H22"/><circle className="agent-component-shape-fill" cx="0" cy="-15" r="8"/><circle className="agent-component-shape-fill" cx="-22" cy="14" r="8"/><circle className="agent-component-shape-fill" cx="22" cy="14" r="8"/></>
      : <><rect className="agent-component-shape-fill" x="-23" y="-20" width="46" height="17" rx="5"/><rect className="agent-component-shape-fill" x="-23" y="3" width="46" height="17" rx="5"/><path d="M-15-12H5M-15 11H5"/><circle cx="14" cy="-12" r="1"/><circle cx="14" cy="11" r="1"/></>}
  </g>;
}
