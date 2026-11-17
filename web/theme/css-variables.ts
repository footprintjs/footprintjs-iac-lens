import type {LensThemeTokens} from './types.ts';

/** Match the current optional peer's emitter without importing its renderer into the dashboard entry. */
export function lensTokenVariables(tokens: LensThemeTokens): Record<string,string> {
  const variables: Record<string,string> = {};
  const colors = tokens.colors;
  if (colors) {
    const names: Record<keyof NonNullable<LensThemeTokens['colors']>,string> = {
      primary:'--fp-color-primary', success:'--fp-color-success', error:'--fp-color-error', warning:'--fp-color-warning',
      onPrimary:'--fp-on-primary', onSuccess:'--fp-on-success', onError:'--fp-on-error', onWarning:'--fp-on-warning',
      onTracing:'--fp-on-tracing', onNodeCursor:'--fp-on-node-cursor', onNodeVisited:'--fp-on-node-visited', onNodeMain:'--fp-on-node-main',
      nodeCursor:'--fp-node-cursor', nodeVisited:'--fp-node-visited', nodeMain:'--fp-node-main',
      accent:'--fp-accent', accentBg:'--fp-accent-bg', tracing:'--fp-tracing',
      chip1:'--fp-chip-1', chip2:'--fp-chip-2', chip3:'--fp-chip-3', chip4:'--fp-chip-4',
      bg:'--fp-bg', bgElevated:'--fp-bg-elevated', bgPrimary:'--fp-bg-primary', bgSecondary:'--fp-bg-secondary', bgTertiary:'--fp-bg-tertiary',
      textPrimary:'--fp-text-primary', textSecondary:'--fp-text-secondary', textMuted:'--fp-text-muted', border:'--fp-border',
    };
    for (const key of Object.keys(names) as (keyof typeof names)[]) {
      const value = colors[key];
      if (value) variables[names[key]] = value;
    }
    const accent = colors.accent ?? colors.primary;
    if (accent) variables['--fp-accent'] = accent;
    if (colors.success) variables['--fp-success'] = colors.success;
  }
  if (tokens.radius) {
    variables['--fp-radius'] = tokens.radius;
    variables['--fp-radius-control'] = tokens.radius;
    variables['--fp-radius-panel'] = tokens.radius;
    variables['--fp-radius-badge'] = tokens.radius;
  }
  const write=(values:Record<string,string|undefined>|undefined,names:Record<string,string>)=>{
    if(values)for(const [key,name]of Object.entries(names))if(values[key])variables[name]=values[key]!;
  };
  write(tokens.typography,{body:'--fp-font-size-body',label:'--fp-font-size-label',small:'--fp-font-size-small',title:'--fp-font-size-title',lineHeight:'--fp-line-height',weightNormal:'--fp-font-weight-normal',weightMedium:'--fp-font-weight-medium',weightStrong:'--fp-font-weight-strong'});
  write(tokens.spacing,{xs:'--fp-space-xs',sm:'--fp-space-sm',md:'--fp-space-md',lg:'--fp-space-lg',xl:'--fp-space-xl'});
  write(tokens.radii,{control:'--fp-radius-control',panel:'--fp-radius-panel',badge:'--fp-radius-badge'});
  write(tokens.borders,{width:'--fp-border-width',focusWidth:'--fp-focus-width'});
  write(tokens.elevation,{panel:'--fp-shadow-panel',popover:'--fp-shadow-popover',focus:'--fp-shadow-focus'});
  write(tokens.nodes,{borderColor:'--fp-node-border-color',borderWidth:'--fp-node-border-width',borderStyle:'--fp-node-border-style',radius:'--fp-node-radius',shadow:'--fp-node-shadow',shapeShadow:'--fp-node-shape-shadow',badgeShadow:'--fp-node-badge-shadow',pulseOpacity:'--fp-node-pulse-opacity',groupStatusDisplay:'--fp-node-group-status-display'});
  write(tokens.motion,{duration:'--fp-motion-duration',fastDuration:'--fp-motion-fast-duration',easing:'--fp-motion-easing'});
  write(tokens.controls,{height:'--fp-control-height',paddingX:'--fp-control-padding-x',gap:'--fp-control-gap',iconSize:'--fp-icon-size'});
  if (tokens.fontFamily?.sans) variables['--fp-font-sans'] = tokens.fontFamily.sans;
  if (tokens.fontFamily?.mono) variables['--fp-font-mono'] = tokens.fontFamily.mono;
  return variables;
}
