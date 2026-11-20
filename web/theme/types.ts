import type {ThemeTokens} from 'footprint-explainable-ui';

/** The installed Flow Lens theme contract; no renderer-specific or future-release tokens. */
export type LensThemeTokens = ThemeTokens;
export interface LensTheme {
  mode?: 'light' | 'dark';
  /** Opt into the installed Explainable UI Paper palette, loaded on demand. */
  preset?: 'paper';
  tokens?: LensThemeTokens;
}
