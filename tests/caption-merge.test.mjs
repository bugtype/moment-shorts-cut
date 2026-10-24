import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareCommand} from '../dist/core/commands.mjs';
import {createDemoProject,createProjectDocument,projectSubtitles} from '../dist/core/project.mjs';
import {captionsPanelMarkup} from '../dist/panel-markup.mjs';
import {createAppFixture} from './fixtures/app.mjs';
const project=()=>{const p=createDemoProject();p.captions=[{start:0,end:1,text:'첫째',speaker:'0',keywords:'강조'},{start:2,end:3,text:'둘째',speaker:'0',keywords:'강조',timing:'estimated'},{start:4,end:5,text:'셋째'}];return p;};
const merge=p=>prepareCommand(p,'captions.merge',{captionIndex:0});
test('merge preserves metadata and other project fields, spans intentional gap and keeps estimated warning',()=>{
 const p=project(),before=structuredClone(p),r=merge(p);
 assert.deepEqual(r.data,{updated:true,outputDuration:12,mergedCaptionIndex:0});
 const expected=structuredClone(p);expected.captions.splice(0,2,{...p.captions[0],text:'첫째 둘째',end:3,timing:'estimated'});
 assert.deepEqual(r.project,expected);assert.deepEqual(p,before);
 p.captions=[{start:0,end:1,text:' A '},{start:1,end:2,text:' B ',basis:'source',speaker:'',keywords:''}];
 assert.equal(merge(p).project.captions[0].text,' A   B ');
});
test('merge rejects missing, fractional indices, conflicting metadata and temporal overlap atomically',()=>{
 for(const captionIndex of [-1,2,9999,.5,NaN,Infinity,'0',null])assert.throws(()=>prepareCommand(project(),'captions.merge',{captionIndex}),e=>e.code==='INVALID_ARGUMENT');
 for(const patch of [{basis:'timeline'},{speaker:'1'},{keywords:'other'},{start:.5},{start:0,end:.5}]){
  const p=project();Object.assign(p.captions[1],patch);const before=structuredClone(p);assert.throws(()=>merge(p),e=>e.code==='INVALID_ARGUMENT');assert.deepEqual(p,before);
 }
 for(const count of [0,1]){const p=project();p.captions.length=count;assert.throws(()=>merge(p));}
});
test('UTF-16 text limit and exact newline preservation retain existing subtitle export validation',()=>{
 const p=project();p.captions[0].text='😀'.repeat(499);p.captions[1].text='가'.repeat(1001);
 assert.equal(merge(p).project.captions[0].text.length,2000);
 p.captions[1].text+='가';assert.throws(()=>merge(p));
 p.captions[0].text='first\n';p.captions[1].text='\nsecond';
 const r=merge(p).project;assert.equal(r.captions[0].text,'first\n \nsecond');
 for(const format of ['srt','vtt'])assert.throws(()=>projectSubtitles(r,{format}),/빈 줄/);
 assert.match(projectSubtitles(r,{format:'txt'}),/^first\n \nsecond/);
});
test('merged source text follows repeated cut clips while timeline text remains once at pre-speed time',()=>{
 const p=project();p.captions.length=2;p.clips=[{start:0,end:1},{start:2,end:3},{start:0,end:3}];p.speed=2;
 assert.equal(projectSubtitles(merge(p).project,{format:'txt'}),'첫째 둘째\n\n첫째 둘째\n\n첫째 둘째\n');
 p.captions.forEach(c=>c.basis='timeline');const r=merge(p).project;
 assert.equal(projectSubtitles(r,{format:'txt'}),'첫째 둘째\n');assert.match(projectSubtitles(r,{format:'srt'}),/00:00:00,000 --> 00:00:01,500/);
});
test('actual caption merge across page boundary preserves trim/current, one undo and stale/IME/busy protection',async()=>{
 const {context,evaluate,element,doc}=await createAppFixture();const p=project();p.duration=120;p.clips=[{start:0,end:120}];p.captions=Array.from({length:51},(_,i)=>({start:i,end:i+1,text:`cue ${i}`}));context.seed=p;
 doc.querySelectorAll=selector=>{
  const attr=selector.match(/^\[data-([\w-]+)\]$/)?.[1];if(!attr)return [];
  return [...element('#panelContent').innerHTML.matchAll(new RegExp('data-'+attr+'="(\\d+)"','g'))].map(match=>{
   const node=element(`[data-${attr}="${match[1]}"]`);node.dataset[attr.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=match[1];return node;
  });
 };
 vm.runInContext("state=seed;history=[];future=[];selected=0;current=2;renderTimeline();renderInspector();switchPanel('captions');",context);
 element('#trimStart').value='1.50';element('#trimEnd').value='3.50';
 const button=element('[data-merge-caption="49"]'),before=evaluate('state'); const oldClick=button.onclick;
 button.onclick();assert.equal(evaluate('state.captions.length'),50);assert.equal(evaluate('state.captions[49].text'),'cue 49 cue 50');assert.equal(evaluate('history.length'),1);assert.equal(evaluate('current'),2);
 assert.equal(doc.activeElement,element('[data-caption-text="49"]'));assert.deepEqual([element('#trimStart').value,element('#trimEnd').value],['1.50','3.50']);
 oldClick();assert.equal(evaluate('history.length'),1);
 vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),before);vm.runInContext('undo(true)',context);assert.equal(evaluate('state.captions.length'),50);
 vm.runInContext('undo()',context);
 const node=element('[data-caption-text="49"]');node.value='committed';node.onchange();const h=evaluate('history.length');element('[data-merge-caption="49"]').onclick();assert.equal(evaluate('state.captions[49].text'),'committed cue 50');assert.equal(evaluate('history.length'),h+1);
 vm.runInContext('undo()',context);const input=element('[data-caption-text="49"]');element('#panelContent').oncompositionstart();const unchanged=evaluate('({state,history,current})');element('[data-merge-caption="49"]').onclick();assert.deepEqual(evaluate('({state,history,current})'),unchanged);element('#panelContent').oncompositionend();
 vm.runInContext('exporting=true',context);element('[data-merge-caption="49"]').onclick();assert.deepEqual(evaluate('({state,history,current})'),unchanged);
});
test('real CLI merges dry-run and saved project, preserving existing file on invalid retry',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-merge-'));try{
 const input=path.join(dir,'in.json'),out=path.join(dir,'out.json');await fs.writeFile(input,JSON.stringify(createProjectDocument(project())));
 const run=(captionIndex,flags)=>spawnSync(process.execPath,[fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),'exec','captions.merge','--project',input,'--json',JSON.stringify({captionIndex}),...flags],{encoding:'utf8'});
 let r=run(0,['--dry-run']);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).preview.project.captions.length,2);
 r=run(0,['--out',out]);assert.equal(r.status,0,r.stderr);const saved=await fs.readFile(out,'utf8');r=run(2,['--out',out,'--overwrite']);assert.equal(r.status,1);assert.equal(await fs.readFile(out,'utf8'),saved);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('merge controls retain global page indices and disable only the final authored row',()=>{
 const p=project();p.captions=Array.from({length:51},(_,i)=>({start:i,end:i+1,text:'cue'}));
 const first=captionsPanelMarkup(p,{page:0}),last=captionsPanelMarkup(p,{page:1});
 assert.equal([...first.matchAll(/data-merge-caption=/g)].length,50);
 assert.match(first,/data-merge-caption="49"[^>]*>합치기/);
 assert.doesNotMatch(first,/data-merge-caption="49"[^>]*disabled/);
 assert.match(last,/data-merge-caption="50"[^>]*disabled/);
});
