# Shared Lens theme

`IacLens` accepts one theme for recent runs, progress cards, system boundaries,
deployment diagrams, setup panels and lazy execution evidence. It uses the
installed `footprint-explainable-ui@0.46.0` token contract. Opening the home screen
does not load the optional diagram/evidence renderer into the initial entry.

```tsx
import { IacLens, type LensTheme } from 'footprintjs-iac-lens/react';
import 'footprintjs-iac-lens/react/style.css';

const theme: LensTheme = {
  mode: 'light',
  tokens: {
    colors: {
      primary: '#425ca8',
      success: '#28755a',
      error: '#b34253',
      border: '#dce3ec',
    },
    radius: '10px',
    fontFamily: { sans: 'Inter, system-ui, sans-serif' },
  },
};

<IacLens baseUrl="" theme={theme} />;
```

Omitting `theme` gives a neutral light dashboard. `theme={{ mode: 'dark' }}`
selects the complete dark palette. Supplied color/font fields merge with that
mode's defaults; replace the theme prop to change presentation while retaining
the selected run and replay position. Filled controls derive readable foregrounds
for ordinary hex/RGB colors. Arbitrary CSS expressions retain a white fallback;
hosts using expressions should provide the corresponding `--lens-on-primary`,
`--lens-on-accent` or `--lens-on-success` foreground in their CSS with
`!important` to override the inline derived value.

The bridge accepts the current release's colors, radius, font families and
structured typography, spacing, radii, borders, elevation, node-paint, motion and
control groups. Explicit paired foreground colors override computed defaults.
The structured groups are retained and forwarded to the shared renderer; domain
cards continue to consume their declared semantic roles.
`bgPrimary` paints the outer dashboard; `bgElevated` paints cards and dialogs;
`bg` paints evidence-panel bodies. `textPrimary`, `textSecondary` and `textMuted`
control text hierarchy. `border` controls structural outlines. Categorical chip
colors distinguish connection identities; success/error/warning colors describe
their measured outcomes. A theme change never changes those outcomes.

Lens emits the matching `--fp-*` variables at its existing root and forwards the
same resolved tokens through the lazy FootPrint theme provider. Its semantic
tints, focus cue, shadows and paired text colors are derived locally. Standalone
optional UI adapters can inherit the same CSS variables from their host; they do
not acquire an additional deployment owner or an independent theme preference.

Recordings, stage IDs, native timestamps, progress counts, Existing labels and
replay frames are unchanged. The bridge only changes presentation. Version 0.46
includes additional renderer/palette capabilities. The synchronized run player
uses a flat deployment chart alongside an isometric physical system. Existing
standalone topology consumers retain the flat default; both presentations use
the same resolved theme, without another theme preference.

Owning modules: `web/theme/`, `web/App.tsx`, lazy `EvidenceView.tsx` and the
individual feature styles. `test/lens-theme.test.ts` checks compatibility with
the installed token emitter, independent foreground contrast, native-record
preservation and lazy dependency loading.
