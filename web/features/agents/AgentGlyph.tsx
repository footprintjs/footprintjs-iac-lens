/** Decorative motion follows the recorded state supplied by the feature projection. */
export function AgentGlyph({ kind, active = false }: { kind: 'agent' | 'environment' | 'infrastructure'; active?: boolean }) {
  return <svg className={'agents-glyph' + (active ? ' agents-glyph-active' : '')} viewBox="0 0 128 120" aria-hidden="true" focusable="false">
    <circle className="agents-glyph-halo" cx="64" cy="60" r="49"/>
    {kind === 'infrastructure' ? <>
      {[27, 50, 73].map(y => <g key={y}><rect className="agents-glyph-solid" x="31" y={y} width="66" height="20" rx="6"/><path className="agents-glyph-detail" d={`M40 ${y+7}h23m-23 6h15`}/><circle className="agents-glyph-light" cx="85" cy={y+10} r="2.5"/></g>)}
    </> : kind === 'environment' ? <>
      <path className="agents-glyph-solid" d="m64 20 40 21v43l-40 22-40-22V41z"/>
      <path className="agents-glyph-detail" d="m24 41 40 22 40-22M64 63v43"/>
      <path className="agents-glyph-panel" d="m64 33 25 13-25 14-25-14z"/>
      <path className="agents-glyph-detail" d="m43 70 10 5m-10 3 10 5m22-8 10-5m-10 13 10-5"/>
    </> : <>
      <path className="agents-glyph-detail" d="M64 20v12M24 61H16v21h8m80-21h8v21h-8"/>
      <circle className="agents-glyph-light" cx="64" cy="17" r="4"/>
      <rect className="agents-glyph-solid" x="25" y="33" width="78" height="64" rx="20"/>
      <rect className="agents-glyph-panel" x="35" y="45" width="58" height="31" rx="12"/>
      <circle className="agents-glyph-light" cx="49" cy="60" r="4"/><circle className="agents-glyph-light" cx="79" cy="60" r="4"/>
      <path className="agents-glyph-detail" d="M53 86h22"/>
    </>}
  </svg>;
}
