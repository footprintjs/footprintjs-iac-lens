import type {LensThemeTokens} from './types.ts';

const fontFamily = {
  sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
};

/** Plain values can be forwarded to the current Flow Lens provider without self-referencing CSS variables. */
export const lightPalette: LensThemeTokens = {
  colors: {
    primary: '#3569b4', success: '#28755a', error: '#b34253', warning: '#94651b',
    nodeCursor: '#3569b4', nodeVisited: '#28755a', nodeMain: '#3569b4',
    accent: '#3569b4', accentBg: '#edf3fc', tracing: '#287f78',
    chip1: '#326f86', chip2: '#94651b', chip3: '#76609b', chip4: '#a4547b',
    bg: '#f7f8fa', bgElevated: '#ffffff', bgPrimary: '#f7f8fa',
    bgSecondary: '#f0f3f7', bgTertiary: '#e6ebf2',
    textPrimary: '#293d52', textSecondary: '#52657a', textMuted: '#66768a', border: '#dce3ec',
  },
  radius: '10px', fontFamily,
};

export const darkPalette: LensThemeTokens = {
  colors: {
    primary: '#91b8f1', success: '#79c6a5', error: '#ef9aab', warning: '#e5bb73',
    nodeCursor: '#91b8f1', nodeVisited: '#79c6a5', nodeMain: '#91b8f1',
    accent: '#91b8f1', accentBg: '#253851', tracing: '#7bc7bf',
    chip1: '#81bbd2', chip2: '#e5bb73', chip3: '#b6a0db', chip4: '#db9bbe',
    bg: '#151d28', bgElevated: '#1d2836', bgPrimary: '#151d28',
    bgSecondary: '#253244', bgTertiary: '#354357',
    textPrimary: '#e4ecf6', textSecondary: '#c0cedf', textMuted: '#a3b4c9', border: '#405168',
  },
  radius: '10px', fontFamily,
};
