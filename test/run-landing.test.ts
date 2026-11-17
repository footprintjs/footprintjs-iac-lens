import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

test('the first screen opens the run journey without architecture controls',async()=>{
 const root=join(import.meta.dirname,'..');
 const result=await build({stdin:{contents:"export {IacLens} from './web/App.tsx'",resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent',plugins:[{name:'current-state',setup(builder){
  builder.onResolve({filter:/use-dashboard\.ts$/},()=>({path:'current-state',namespace:'fixture'}));
  builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"export function useDashboard(){return {state:{revision:0,graph:null,busy:false,mode:'managed'},connected:true,posting:false}}",loader:'js'}));
 }}]});
 await mkdir(join(root,'.artifacts'),{recursive:true});const directory=await mkdtemp(join(root,'.artifacts/run-landing-'));
 try{
  const file=join(directory,'render.mjs');await writeFile(file,result.outputFiles[0]!.text);const {IacLens}=await import(pathToFileURL(file).href);
  const html=renderToStaticMarkup(createElement(IacLens));
  assert.match(html,/Opening runs|Recent runs/,'the front door is recent activity');
  assert.doesNotMatch(html,/>System design<|>Infrastructure<|>Execution evidence</,'technical navigation is opened on demand');
 }finally{await rm(directory,{recursive:true,force:true});}
});
