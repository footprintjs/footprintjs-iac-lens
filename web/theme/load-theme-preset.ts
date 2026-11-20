export type PaperThemePresets=typeof import('./paper-presets.ts');
let paper:Promise<PaperThemePresets>|undefined;

/** The optional UI peer stays outside the initial shell and loads only for a requested preset. */
export function loadPaperThemePresets():Promise<PaperThemePresets> {
 return paper??=import('./paper-presets.ts').catch(error=>{paper=undefined;throw error;});
}
