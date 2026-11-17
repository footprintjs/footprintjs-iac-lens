import type {ThemeTokens} from 'footprint-explainable-ui';

/** The installed Flow Lens theme contract; no renderer-specific or future-release tokens. */
export type LensThemeTokens = ThemeTokens;
export interface LensTheme {
  mode?: 'light' | 'dark';
  tokens?: LensThemeTokens;
}
