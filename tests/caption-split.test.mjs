import {LocalizedError} from '../dist/core/validation.mjs';
import {message as msg} from '../dist/i18n.mjs';
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
import {splitCaptionAtOffset} from '../dist/effects.mjs';
const project=()=>{const p=createDemoProject();p.captions=[{start:1,end:12,text:'Hello world',basis:'source',speaker:'1',keywords:'Hello'}];return p;};
const split=(p,textOffset=6)=>prepareCommand(p,'captions.split',{captionIndex:0,textOffset});
test('single split preserves literal text, metadata and exact endpoints with grapheme-weighted timing',()=>{
 const p=project(),before=structuredClone(p),r=split(p);
 assert.deepEqual(r.data,{updated:true,outputDuration:12,createdCaptionIndex:1});
 assert.deepEqual(r.project.captions,[{...p.captions[0],end:7,text:'Hello ',timing:'estimated'},{...p.captions[0],start:7,text:'world',timing:'estimated'}]);
 assert.deepEqual(p,before);const expected=structuredClone(p);expected.captions=r.project.captions;assert.deepEqual(r.project,expected);
 for(const cluster of ['😀','é','한','🇰🇷','👍🏽','👨‍👩‍👧‍👦']){
  const cue={start:0,end:2,text:cluster+'Z'};
  const parts=splitCaptionAtOffset(cue,cluster.length);assert.equal(parts[0].end,1);assert.equal(parts[0].text,cluster);
  for(let i=1;i<cluster.length;i++)assert.throws(()=>splitCaptionAtOffset(cue,i));
 }
});
test('invalid offsets, whitespace halves, exhausted precision and capacity reject atomically',()=>{
 for(const offset of [-1,0,11,2000,.5,'6',null,NaN,Infinity])assert.throws(()=>split(project(),offset),e=>e.code==='INVALID_ARGUMENT');
 for(const captionIndex of [-1,1,.5,'0'])assert.throws(()=>prepareCommand(project(),'captions.split',{captionIndex,textOffset:6}));
 for(const cue of [{start:0,end:1,text:'  A'},{start:0,end:1,text:'A  '},{start:1,end:1+Number.EPSILON,text:'AB'}]){
  const p=project();p.captions=[cue];const before=structuredClone(p);assert.throws(()=>split(p,1));assert.deepEqual(p,before);
 }
 const p=project();p.captions=Array.from({length:9999},()=>({...p.captions[0]}));assert.equal(split(p).project.captions.length,10000);p.captions.push({...p.captions[0]});assert.throws(()=>split(p));
});
test('missing Intl refuses without codepoint fallback; newline and source/timeline export semantics remain explicit',async()=>{
 const source=await fs.readFile(new URL('../dist/effects.mjs',import.meta.url),'utf8');
 const helper=vm.runInNewContext(source.replace(/^import .*;$/gm,'').replace(/export /g,'')+';splitCaptionAtOffset',{Intl:{},LocalizedError,msg});
 assert.throws(()=>helper({start:0,end:2,text:'AB'},1),/안전한 문자 분할/);
 const p=project();p.captions=[{start:0,end:2,text:'AB'}];p.clips=[{start:0,end:2},{start:0,end:2}];p.speed=2;
 assert.equal(projectSubtitles(split(p,1).project,{format:'txt'}),'A\n\nB\n\nA\n\nB\n');
 p.captions[0].basis='timeline';assert.equal(projectSubtitles(split(p,1).project,{format:'txt'}),'A\n\nB\n');
 p.captions[0].text='A\nB';const r=split(p,2).project;assert.equal(r.captions[0].text,'A\n');assert.throws(()=>projectSubtitles(r),/빈 줄/);
});
test('actual caret split commits blur text, reveals page50, preserves trim and rejects stale/IME/selection/busy',async()=>{
 const {context,evaluate,element,doc}=await createAppFixture();const p=project();p.duration=120;p.clips=[{start:0,end:120}];p.captions=Array.from({length:51},(_,i)=>({start:i,end:i+1,text:`cue ${i}`}));context.seed=p;
 doc.querySelectorAll=selector=>{
  const attr=selector.match(/^\[data-([\w-]+)\]$/)?.[1];if(!attr)return [];
  return [...element('#panelContent').innerHTML.matchAll(new RegExp('data-'+attr+'="(\\d+)"','g'))].map(match=>{
   const node=element(`[data-${attr}="${match[1]}"]`);node.dataset[attr.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=match[1];return node;
  });
 };
 vm.runInContext("state=seed;history=[];future=[];selected=0;current=2;renderTimeline();renderInspector();switchPanel('captions');",context);
 element('#trimStart').value='1.50';element('#trimEnd').value='3.50';
 const input=element('[data-caption-text="49"]');input.value='Hello world';input.onchange();input.setSelectionRange(6,6);
 const button=element('[data-split-caption="49"]'),oldClick=button.onclick,before=evaluate('state'),h=evaluate('history.length');
 button.onclick();assert.equal(evaluate('state.captions.length'),52);assert.equal(evaluate('state.captions[49].text'),'Hello ');assert.equal(evaluate('state.captions[50].text'),'world');assert.equal(evaluate('history.length'),h+1);
 assert.equal(evaluate('current'),2);assert.equal(doc.activeElement,element('[data-caption-text="50"]'));assert.match(element('#panelContent').innerHTML,/data-caption-text="50"/);
 assert.deepEqual([element('#trimStart').value,element('#trimEnd').value],['1.50','3.50']);oldClick();assert.equal(evaluate('history.length'),h+1);
 vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),before);vm.runInContext('undo(true)',context);assert.equal(evaluate('state.captions.length'),52);
 vm.runInContext("undo();app.captionPanel.focus(49)",context);
 const node=element('[data-caption-text="49"]');node.value='Hello world';node.setSelectionRange(1,4);const unchanged=evaluate('({state,current,history})');element('[data-split-caption="49"]').onclick();assert.deepEqual(evaluate('({state,current,history})'),unchanged);
 node.setSelectionRange(6,6);element('#panelContent').oncompositionstart();element('[data-split-caption="49"]').onclick();assert.deepEqual(evaluate('({state,current,history})'),unchanged);element('#panelContent').oncompositionend();
 vm.runInContext('exporting=true',context);element('[data-split-caption="49"]').onclick();assert.deepEqual(evaluate('({state,current,history})'),unchanged);
});
test('real CLI splits dry-run and saved project, preserving existing file on invalid retry',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-split-'));try{
 const input=path.join(dir,'in.json'),out=path.join(dir,'out.json');await fs.writeFile(input,JSON.stringify(createProjectDocument(project())));
 const run=(captionIndex,flags)=>spawnSync(process.execPath,[fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),'exec','captions.split','--project',input,'--json',JSON.stringify({captionIndex,textOffset:6}),...flags],{encoding:'utf8'});
 let r=run(0,['--dry-run']);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).preview.project.captions.length,2);
 r=run(0,['--out',out]);assert.equal(r.status,0,r.stderr);const saved=await fs.readFile(out,'utf8');r=run(2,['--out',out,'--overwrite']);assert.equal(r.status,1);assert.equal(await fs.readFile(out,'utf8'),saved);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});


test('split/merge/delete actions share a wrapping group outside time fields',async()=>{
 const html=captionsPanelMarkup(project(),{});
 const actions=html.match(/<div class="caption-row-actions"[^>]*>/)?.[0];
 assert.ok(actions);assert.match(actions,/role="group"/);assert.match(actions,/aria-label="자막 1 편집"/);assert.match(actions,/data-i18n-aria-label="panels.cueEdit"/);
 assert.match(html,/data-split-caption="0"[^>]*title="커서 위치에서 나누기"/);
 assert.ok(html.indexOf('caption-row-actions')>html.indexOf('</textarea>'));
 const css=await fs.readFile(new URL('../dist/styles/inspector-dialogs.css',import.meta.url),'utf8');
 assert.match(css,/\.caption-row-actions\s*\{[^}]*flex-wrap:wrap/);
});
