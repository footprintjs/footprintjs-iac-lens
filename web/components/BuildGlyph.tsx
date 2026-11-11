import type { ResourceStatus } from '../../src/core/types.ts';
import './build-glyph.css';

export type BuildGlyphKind = 'compute' | 'storage' | 'network' | 'identity' | 'space' | 'policy' | 'resource' | 'code';

function ComputeShape() {
  return <>{[24, 51, 78].map((y, index) => <g key={y} className={`bg-piece bg-piece-${index}`}>
    <rect className="bg-solid" x="34" y={y} width="76" height="25" rx="7"/>
    <path className="bg-detail" d={`M45 ${y + 9}h25m-25 7h17`}/>
    <circle className="bg-light" cx="96" cy={y + 12} r="3"/>
  </g>)}</>;
}

function StorageShape() {
  return <>{[27, 51, 75].map((y, index) => <g key={y} className={`bg-piece bg-piece-${index}`}>
    <path className="bg-solid" d={`M36 ${y}v22c0 8 16 14 36 14s36-6 36-14V${y}`}/>
    <ellipse className="bg-lid" cx="72" cy={y} rx="36" ry="13"/>
    <path className="bg-detail" d={`M46 ${y + 22}c6 4 16 6 26 6`}/>
  </g>)}</>;
}

function NetworkShape() {
  return <>
    <g className="bg-network-links"><path d="M72 65 29 32M72 65l43-33M72 65l-43 37M72 65l43 37"/></g>
    <g className="bg-piece bg-piece-0"><circle className="bg-solid" cx="72" cy="65" r="18"/>
      <path className="bg-detail" d="M63 65h18m-5-5 5 5-5 5m-8-10-5 5 5 5"/></g>
    {[[29, 32], [115, 32], [29, 102], [115, 102]].map(([x, y], index) => <g key={index} className={`bg-piece bg-piece-${index % 3}`}>
      <rect className="bg-solid" x={x! - 11} y={y! - 10} width="22" height="20" rx="6"/>
      <circle className="bg-light" cx={x} cy={y} r="3"/>
    </g>)}
  </>;
}

function IdentityShape() {
  return <>
    <g className="bg-piece bg-piece-0"><path className="bg-solid" d="m67 18 35 13v29c0 23-16 38-35 49-19-11-35-26-35-49V31z"/></g>
    <g className="bg-piece bg-piece-1"><circle className="bg-lid" cx="67" cy="47" r="11"/>
      <path className="bg-lid" d="M47 82v-6c0-12 9-18 20-18s20 6 20 18v6z"/></g>
    <g className="bg-piece bg-piece-2 bg-key"><circle className="bg-solid" cx="105" cy="82" r="10"/>
      <path d="m98 89-19 19m6-6 6 6m-1-11 6 6"/></g>
  </>;
}

function SpaceShape() {
  return <>
    <g className="bg-piece bg-piece-2"><path className="bg-solid" d="m72 70 48 24-48 24-48-24z"/></g>
    <g className="bg-piece bg-piece-1"><path className="bg-lid" d="m72 19 48 24-48 24-48-24z"/>
      <path className="bg-detail" d="M24 43v51m96-51v51M72 67v51"/></g>
    <g className="bg-piece bg-piece-0"><path className="bg-boundary" d="M72 19v51M24 43l48 27 48-27"/></g>
  </>;
}

function PolicyShape() {
  return <>
    <g className="bg-piece bg-piece-0"><path className="bg-shackle" d="M49 57V42c0-31 46-31 46 0v15"/></g>
    <g className="bg-piece bg-piece-1"><rect className="bg-solid" x="34" y="54" width="76" height="52" rx="11"/>
      <circle className="bg-lid" cx="72" cy="75" r="6"/><path d="M72 81v10"/></g>
  </>;
}

function ResourceShape() {
  return <g className="bg-piece bg-piece-0">
    <path className="bg-solid" d="m72 22 42 23v48l-42 24-42-24V45z"/>
    <path className="bg-lid" d="m72 22 42 23-42 24-42-24z"/>
    <path className="bg-detail" d="M72 69v48m-21-82 42 23"/>
  </g>;
}

function CodeShape() {
  return <>
    <g className="bg-piece bg-piece-0"><rect className="bg-solid" x="21" y="26" width="102" height="74" rx="11"/>
      <path className="bg-detail" d="M21 43h102"/><circle className="bg-light" cx="32" cy="35" r="2"/>
      <circle className="bg-light" cx="40" cy="35" r="2"/><circle className="bg-light" cx="48" cy="35" r="2"/>
    </g>
    <g className="bg-code"><path d="m50 58-10 10 10 10m44-20 10 10-10 10m-17-26-9 32"/></g>
    <path className="bg-detail bg-code-cursor" d="M57 91h29"/>
  </>;
}

const shapes = { compute: ComputeShape, storage: StorageShape, network: NetworkShape,
  identity: IdentityShape, space: SpaceShape, policy: PolicyShape, resource: ResourceShape, code: CodeShape };

/** Decorative construction motion follows the supplied recorded status; it never advances it. */
export function BuildGlyph({ kind, status, small = false, checking = false }: {
  kind: BuildGlyphKind; status: ResourceStatus; small?: boolean; checking?: boolean;
}) {
  const Shape = shapes[kind];
  return <span className={`bg-glyph bg-${kind} bg-${status}${small ? ' bg-small' : ''}${status === 'deploying' && checking ? ' bg-checking' : ''}`} aria-hidden="true">
    <svg viewBox="0 0 144 132" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" focusable="false" aria-hidden="true">
      <circle className="bg-halo" cx="72" cy="64" r="52"/>
      <ellipse className="bg-ground" cx="72" cy="119" rx="47" ry="7"/>
      <g className="bg-object"><Shape/></g>
      {status === 'deploying' && <path className="bg-scan" d="M15 69h114"/>}
      {(status === 'ready' || status === 'failed') && <g className="bg-verdict">
        <circle cx="115" cy="105" r="13"/>
        <path d={status === 'ready' ? 'm109 105 4 4 8-9' : 'm111 101 8 8m-8 0 8-8'}/>
      </g>}
      {status === 'deleted' && <path className="bg-removed" d="M28 105 116 22"/>}
    </svg>
  </span>;
}
