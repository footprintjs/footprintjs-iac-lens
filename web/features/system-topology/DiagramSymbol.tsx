import type {DiagramSymbolDefinition} from '../../../src/core/system-symbols.ts';

const fills={none:'none',surface:'var(--fp-bg-elevated, #fff)',subtle:'var(--fp-bg-secondary, #edf0ef)',accent:'var(--fp-accent-bg, #e5ede8)'};
const strokes={none:'none',ink:'var(--fp-text-primary, #334b63)',muted:'var(--fp-text-muted, #7f91ac)',accent:'var(--fp-accent, #465d50)'};

/** Passive consumer paths use shared paint roles, without markup, URLs or executable content. */
export function DiagramSymbol({symbol,className,size}:{symbol:DiagramSymbolDefinition;className?:string;size?:{width:number;height:number}}) {
 return <svg className={className} width={size?.width} height={size?.height} data-diagram-symbol={symbol.id} viewBox={`0 0 ${symbol.viewBox.width} ${symbol.viewBox.height}`} aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet">
  {symbol.paths.map((path,index)=><path key={index} d={path.d} fill={fills[path.fill??'none']} stroke={strokes[path.stroke??'ink']} strokeWidth={path.strokeWidth??1.5} strokeLinecap="round" strokeLinejoin="round"/>)}
 </svg>;
}
