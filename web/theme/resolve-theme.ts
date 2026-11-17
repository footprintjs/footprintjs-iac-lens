import type {CSSProperties} from 'react';
import type {LensTheme,LensThemeTokens} from './types.ts';
import {lightPalette,darkPalette} from './palettes.ts';
import {lensTokenVariables} from './css-variables.ts';
import {accentForeground} from './contrast.ts';

export interface ResolvedLensTheme {
  mode: 'light' | 'dark';
  tokens: LensThemeTokens;
  style: CSSProperties;
}

export function resolveLensTheme(input?: LensTheme): ResolvedLensTheme {
  const mode=input?.mode??'light',base=mode==='dark'?darkPalette:lightPalette;
  const overrides=input?.tokens,colors={...base.colors,...overrides?.colors};
  // One primary/success override changes the associated chart defaults unless the host supplied a distinct role.
  if (overrides?.colors?.primary) {
    if (overrides.colors.accent===undefined) colors.accent=overrides.colors.primary;
    if (overrides.colors.nodeCursor===undefined) colors.nodeCursor=overrides.colors.primary;
    if (overrides.colors.nodeMain===undefined) colors.nodeMain=overrides.colors.primary;
  }
  if (overrides?.colors?.success && overrides.colors.nodeVisited===undefined) colors.nodeVisited=overrides.colors.success;
  const pairs={onPrimary:'primary',onSuccess:'success',onError:'error',onWarning:'warning',onTracing:'tracing',onNodeCursor:'nodeCursor',onNodeVisited:'nodeVisited',onNodeMain:'nodeMain'} as const;
  for(const [foreground,fill]of Object.entries(pairs) as [keyof typeof pairs,typeof pairs[keyof typeof pairs]][]) {
    if(colors[foreground]===undefined)colors[foreground]=accentForeground(colors[fill]);
  }
  const tokens:LensThemeTokens={...base,...overrides,colors,radius:overrides?.radius??base.radius,fontFamily:{...base.fontFamily,...overrides?.fontFamily}};
  for(const group of ['typography','spacing','radii','borders','elevation','nodes','motion','controls'] as const){
    if(base[group]||overrides?.[group])Object.assign(tokens,{[group]:{...base[group],...overrides?.[group]}});
  }
  return {mode,tokens,style:{...lensTokenVariables(tokens),
    '--lens-on-accent':accentForeground(colors.accent),
    '--lens-on-primary':colors.onPrimary,
    '--lens-on-success':colors.onSuccess,colorScheme:mode} as CSSProperties};
}
