import {useEffect,useMemo,useState} from 'react';
import type {LensTheme} from './types.ts';
import {resolveLensTheme} from './resolve-theme.ts';
import {loadPaperThemePresets,type PaperThemePresets} from './load-theme-preset.ts';

/** Update the existing provider value, retaining every child and its selected replay moment. */
export function useResolvedLensTheme(input?:LensTheme) {
 const [paper,setPaper]=useState<PaperThemePresets>();
 useEffect(()=>{
  if(input?.preset!=='paper'||paper)return;
  let current=true;
  void loadPaperThemePresets().then(value=>{if(current)setPaper(value);}).catch(()=>{/* Keep the readable host palette if the optional preset cannot load. */});
  return()=>{current=false;};
 },[input?.preset,paper]);
 return useMemo(()=>{
  const preset=input?.preset==='paper'&&paper?(input.mode==='dark'?paper.paperDark:paper.paperLight):undefined;
  const resolved=resolveLensTheme(input,preset);
  return preset?{...resolved,preset:'paper' as const}:resolved;
 },[input,paper]);
}
