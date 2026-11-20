import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build,type Metafile} from 'esbuild';
import {paperDark,paperLight,tokensToCSSVars} from 'footprint-explainable-ui';
import {resolveLensTheme} from '../web/theme/resolve-theme.ts';
import {lensTokenVariables} from '../web/theme/css-variables.ts';
import {lightPalette,darkPalette} from '../web/theme/palettes.ts';
import {accentForeground} from '../web/theme/contrast.ts';
import type {LensTheme,LensThemeTokens} from '../web/theme/types.ts';
import {loadPaperThemePresets} from '../web/theme/load-theme-preset.ts';

const root=resolve(import.meta.dirname,'..');

test('Paper uses the installed public presets without mutating them or replacing explicit host tokens',async()=>{
 const presets=await loadPaperThemePresets();
 assert.equal(await loadPaperThemePresets(),presets,'the optional preset module is shared across mounts');
 assert.equal(presets.paperLight,paperLight);assert.equal(presets.paperDark,paperDark);
 for(const [mode,base]of [['light',paperLight],['dark',paperDark]] as const){
  const before=JSON.stringify(base),resolved=resolveLensTheme({preset:'paper',mode},base);
  for(const [key,value]of Object.entries(base.colors!))assert.equal(resolved.tokens.colors![key as keyof typeof base.colors],value);
  for(const group of ['fontFamily','typography','spacing','radii','borders','elevation','nodes','motion','controls'] as const)assert.deepEqual(resolved.tokens[group],base[group]);
  const overridden=resolveLensTheme({preset:'paper',mode,tokens:{colors:{primary:'#ffffff',nodeCursor:'#001122',onNodeCursor:'#eeeeee'},fontFamily:{sans:'Host Sans'},nodes:{radius:'17px'}}},base);
  assert.equal(overridden.tokens.colors!.bgPrimary,base.colors!.bgPrimary);
  assert.equal(overridden.tokens.colors!.primary,'#ffffff');assert.equal(overridden.tokens.colors!.onPrimary,'#000000');
  assert.equal(overridden.tokens.colors!.nodeCursor,'#001122');assert.equal(overridden.tokens.colors!.onNodeCursor,'#eeeeee');
  assert.equal(overridden.tokens.fontFamily!.sans,'Host Sans');assert.equal(overridden.tokens.fontFamily!.mono,base.fontFamily!.mono);
  assert.equal(overridden.tokens.nodes!.radius,'17px');assert.equal(JSON.stringify(base),before);
 }
 const waiting=resolveLensTheme({preset:'paper'});
 assert.equal(waiting.tokens.colors!.bgPrimary,lightPalette.colors!.bgPrimary,'no copied Paper palette pretends the optional module has loaded');
 assert.equal(waiting.preset,undefined);
});

test('the lightweight bridge matches the installed peer emitter for every supported token and alias',()=>{
 const colors=Object.fromEntries(Object.keys(lightPalette.colors!).map((key,index)=>[key,'#'+(0x234567+index*1000).toString(16)]));
 const tokens:LensThemeTokens={colors:{...colors,onPrimary:'#ffffff',onSuccess:'#101010',onError:'#ffffff',onWarning:'#101010',onTracing:'#ffffff',onNodeCursor:'#111111',onNodeVisited:'#222222',onNodeMain:'#eeeeee'},radius:'13px',fontFamily:{sans:'Example Sans',mono:'Example Mono'},
  typography:{body:'14px',label:'12px',small:'10px',title:'20px',lineHeight:'1.5',weightNormal:'400',weightMedium:'500',weightStrong:'700'},
  spacing:{xs:'2px',sm:'4px',md:'8px',lg:'12px',xl:'20px'},radii:{control:'5px',panel:'9px',badge:'12px'},borders:{width:'1px',focusWidth:'2px'},
  elevation:{panel:'none',popover:'0 2px 8px #1234',focus:'none'},nodes:{borderColor:'#334455',borderWidth:'2px',borderStyle:'dashed',radius:'8px',shadow:'none',shapeShadow:'none',badgeShadow:'none',pulseOpacity:'0',groupStatusDisplay:'inline-flex'},
  motion:{duration:'120ms',fastDuration:'80ms',easing:'linear'},controls:{height:'28px',paddingX:'8px',gap:'4px',iconSize:'16px'}};
 for(const value of [tokens,{colors:{primary:'#123456'}},{colors:{success:'#234567',accent:''}},{}]){
  assert.deepEqual(lensTokenVariables(value),tokensToCSSVars(value));
 }
});

test('partial host overrides retain complete mode roles and choose a readable accent label without mutating input',()=>{
 const custom:LensTheme={mode:'dark',tokens:{colors:{primary:'#ffee99',success:'#92d3a0',border:'#596877'},fontFamily:{sans:'Host Sans'},radius:'15px'}};
 const before=JSON.stringify(custom),resolved=resolveLensTheme(custom);
 assert.equal(resolved.mode,'dark');assert.equal(resolved.tokens.colors!.bg,darkPalette.colors!.bg);
 assert.equal(resolved.tokens.colors!.accent,'#ffee99');assert.equal(resolved.tokens.colors!.nodeCursor,'#ffee99');
 assert.equal(resolved.tokens.colors!.nodeVisited,'#92d3a0');assert.equal(resolved.tokens.fontFamily!.mono,darkPalette.fontFamily!.mono);
 assert.equal(resolved.tokens.fontFamily!.sans,'Host Sans');assert.equal(resolved.tokens.radius,'15px');
 assert.equal((resolved.style as Record<string,string>)['--lens-on-accent'],'#000000');
 assert.equal((resolveLensTheme().style as Record<string,string>)['--lens-on-accent'],'#ffffff');
 assert.equal(accentForeground('rgb(255, 255, 255)'),'#000000');assert.equal(accentForeground('#000'),'#ffffff');
 assert.equal(JSON.stringify(custom),before);
 const separate=resolveLensTheme({tokens:{colors:{primary:'#123456',accent:'#ffffff',nodeCursor:'#ffee99'}}});
 assert.equal(separate.tokens.colors!.accent,'#ffffff');assert.equal(separate.tokens.colors!.nodeCursor,'#ffee99');
  const independent=resolveLensTheme({tokens:{colors:{primary:'#123456',accent:'#ffffff',success:'#eeffcc'}}}).style as Record<string,string>;
  assert.equal(independent['--lens-on-primary'],'#ffffff');
  assert.equal(independent['--lens-on-accent'],'#000000');
  assert.equal(independent['--lens-on-success'],'#000000');
  const reversed=resolveLensTheme({tokens:{colors:{primary:'#ffffff',accent:'#123456',success:'#123456'}}}).style as Record<string,string>;
  assert.equal(reversed['--lens-on-primary'],'#000000');
  assert.equal(reversed['--lens-on-accent'],'#ffffff');
  assert.equal(reversed['--lens-on-success'],'#ffffff');
 const expanded=resolveLensTheme({mode:'dark',tokens:{colors:{primary:'#fedcba',onPrimary:'#152535',nodeCursor:'#223344',onNodeCursor:'#eeeeee'},typography:{body:'15px'},nodes:{borderStyle:'dotted'},radii:{panel:'16px'},spacing:{md:'12px'}}});
 assert.equal(expanded.tokens.colors!.onPrimary,'#152535');assert.equal(expanded.tokens.colors!.onNodeCursor,'#eeeeee');
 assert.equal(expanded.tokens.colors!.onSuccess,accentForeground(expanded.tokens.colors!.success));
 assert.equal(expanded.tokens.nodes?.borderStyle,'dotted');assert.equal(expanded.tokens.typography?.body,'15px');
 assert.equal((expanded.style as Record<string,string>)['--fp-radius-panel'],'16px');assert.equal((expanded.style as Record<string,string>)['--fp-space-md'],'12px');
});

async function renderModule(){
 const result=await build({stdin:{contents:"export {IacLens} from './web/App.tsx'; export {LensThemeProvider} from './web/theme/LensThemeContext.tsx'; export {default as EvidenceView} from './web/components/EvidenceView.tsx';",resolveDir:root,loader:'ts'},
  bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent',plugins:[{name:'retained-state',setup(builder){
   builder.onResolve({filter:/use-dashboard\.ts$/},()=>({path:'retained-state',namespace:'fixture'}));
   builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export function useDashboard(){return {state:{revision:0,graph:null,busy:false,mode:"managed"},connected:true,posting:false}}',loader:'js'}));
  }}]});
 await mkdir(join(root,'.artifacts'),{recursive:true});const folder=await mkdtemp(join(root,'.artifacts/theme-render-'));
 try{const file=join(folder,'render.mjs');await writeFile(file,result.outputFiles[0]!.text);return await import(pathToFileURL(file).href);}
 finally{await rm(folder,{recursive:true,force:true});}
}

const components=await renderModule();

test('the public Lens theme paints its existing root without adding a layout wrapper',()=>{
 const html=renderToStaticMarkup(createElement(components.IacLens,{fitWindow:false,theme:{mode:'dark',tokens:{colors:{primary:'#d9b3ff',bg:'#111927',border:'#526783'},fontFamily:{sans:'Host Sans'},radius:'12px'}}}));
 assert.match(html,/^<div data-lens-theme="dark"/);assert.match(html,/--fp-color-primary:#d9b3ff/);
 assert.match(html,/--fp-bg:#111927/);assert.match(html,/--fp-border:#526783/);assert.match(html,/--fp-font-sans:Host Sans/);
 assert.match(html,/--fp-radius:12px/);assert.match(html,/color-scheme:dark/);assert.doesNotMatch(html,/class="iac-lens lens-fit/);
 assert.doesNotMatch(html,/fp-theme-root/,'the dashboard shell does not load an optional renderer to apply its theme');
});

function recording(partial:boolean){
 return {snapshot:{runId:'theme-evidence',sharedState:{ready:true},executionTree:{id:'check',name:'Check',runtimeStageId:'check#0',logs:{},errors:{},metrics:{},evals:{}},
  commitLog:[{idx:0,stage:'Check',stageId:'check',runtimeStageId:'check#0',trace:[{path:'ready',verb:partial?'merge':'set'}],overwrite:{ready:true},updates:{}}]},
  structure:{id:'check',name:'Check',type:'stage'}};
}

test('both evidence presentations inherit the same current-release palette and retain the exact recording',()=>{
 const value=resolveLensTheme({mode:'dark',tokens:{colors:{primary:'#bc9bf3',bg:'#122033',bgElevated:'#1b2b40',bgPrimary:'#122033',bgSecondary:'#24364c',textPrimary:'#f1eaff',border:'#58738f',nodeVisited:'#98d3ad',nodeCursor:'#ead591'},fontFamily:{sans:'Host Sans'},radius:'11px'}});
 for(const partial of [false,true]){
  const input=recording(partial),before=JSON.stringify(input);
  const html=renderToStaticMarkup(createElement(components.LensThemeProvider,{value},createElement(components.EvidenceView,{recording:input,running:false})));
  assert.match(html,partial?/data-evidence-mode="state-timeline"/:/data-evidence-mode="full"/);
  assert.match(html,/--fp-bg:#122033/);assert.match(html,/--fp-bg-elevated:#1b2b40/);assert.match(html,/--fp-node-visited:#98d3ad/);
  assert.match(html,/--fp-node-cursor:#ead591/);assert.match(html,/--fp-font-sans:Host Sans/);assert.match(html,/--fp-radius:11px/);
  assert.doesNotMatch(html,/--fp-bg(?:-primary|-secondary|-elevated)?:#(?:fff(?:fff)?|f9fafb)/,'a nested forced-light mode must not replace the host palette');
  assert.equal(JSON.stringify(input),before);
 }
});

function staticInputs(meta:Metafile,entry:string){
 const seen=new Set<string>(),inputs=new Set<string>();
 function visit(path:string){if(seen.has(path))return;seen.add(path);const output=meta.outputs[path]!;for(const input of Object.keys(output.inputs))inputs.add(input);for(const child of output.imports)if(!child.external&&child.kind==='import-statement')visit(child.path);}
 visit(entry);return inputs;
}

test('shared theming keeps the optional evidence package outside the initial browser graph',async()=>{
 const result=await build({absWorkingDir:root,entryPoints:{app:'web/main.tsx'},outdir:'out-theme-isolation',bundle:true,write:false,format:'esm',splitting:true,platform:'browser',target:'es2022',jsx:'automatic',metafile:true,minify:true,logLevel:'silent'});
 const meta=result.metafile!,entry=Object.entries(meta.outputs).find(([,output])=>output.entryPoint==='web/main.tsx')![0];
 assert(![...staticInputs(meta,entry)].some(path=>path.includes('node_modules/footprint-explainable-ui/')));
 assert(Object.entries(meta.outputs).some(([,output])=>Object.keys(output.inputs).some(path=>path.includes('node_modules/footprint-explainable-ui/'))),'the evidence renderer remains available in a lazy chunk');
 assert(Object.values(meta.outputs).some(output=>output.entryPoint==='web/theme/paper-presets.ts'),'the requested Paper preset has its own dynamic entry');
});
