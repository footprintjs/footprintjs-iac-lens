import {createContext,useContext,type ReactNode} from 'react';
import {resolveLensTheme,type ResolvedLensTheme} from './resolve-theme.ts';

const LensThemeContext=createContext<ResolvedLensTheme>(resolveLensTheme());
export function LensThemeProvider({value,children}:{value:ResolvedLensTheme;children:ReactNode}) {
  return <LensThemeContext.Provider value={value}>{children}</LensThemeContext.Provider>;
}
export function useLensTheme(): ResolvedLensTheme { return useContext(LensThemeContext); }
