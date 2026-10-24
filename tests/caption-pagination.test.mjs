import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createCaptionPanel} from '../dist/caption-panel.mjs';
import {captionsPanelMarkup} from '../dist/panel-markup.mjs';
import {createDemoProject} from '../dist/core/project.mjs';

function fixture(count=101){
 let project=createDemoProject(),blocked=false,html='',nodes=new Map();
 project.duration=20000;project.clips=[{start:0,end:20000}];
 project.captions=Array.from({length:count},(_,i)=>({start:i,end:i+1,text:`찾기 ${i}`,basis:'source',timing:'estimated'}));
 const log=[],history=[],future=[];
 const target={querySelector:selector=>nodes.get(selector)||null,get innerHTML(){return html;},set innerHTML(value){
  html=value;nodes=new Map();
  const node=(selector,dataset={})=>{const n={dataset,value:'',focus(){if (!this.disabled) log.push(['focus',selector]);},scrollIntoView(){},setSelectionRange(a,b){log.push(['selection',selector,a,b]);}};nodes.set(selector,n);return n;};
  for(const match of value.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
   const n=node('#'+match[1]);n.disabled=/\bdisabled(?:\s|>)/.test(match[0]);
  }
  for(const match of value.matchAll(/data-(caption-text|caption-start|caption-end|caption-keywords|caption-speaker|delete-caption)="(\d+)"/g)){
   const key=match[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase());node(`[data-${match[1]}="${match[2]}"]`,{[key]:match[2]});
  }
 }};
 const query=selector=>nodes.get(selector)||null;
 const queryAll=selector=>[...nodes].filter(([key])=>key.startsWith(selector.slice(0,-1)+'=')).map(([,node])=>node);
 let panel;const render=()=>panel.render(target,{},{});
 panel=createCaptionPanel({query,queryAll,getProject:()=>project,getDuration:()=>project.duration,sourceTime:()=>0,
  edit(change,refresh){if(blocked)return;history.push(structuredClone(project));change();log.push(['edit']);if(refresh)render();},refresh:render,toast:message=>log.push(['toast',message])});
 render();
 return {panel,query,target,log,history,render,project:()=>project,setProject:p=>{project=p;render();},block:()=>blocked=true,
  undo(){future.push(project);project=history.pop();render();},redo(){project=future.pop();render();}};
}
const rows=f=>[...f.target.innerHTML.matchAll(/data-caption-text="(\d+)"/g)].map(m=>+m[1]);
const input=(f,id,value)=>{const n=f.query(id);n.value=value;n.oninput();};

test('only 50 globally indexed rows mount, pagination/focus are presentation-only and retain cloned-project page',()=>{
 const f=fixture(10000),before=structuredClone(f.project());
 assert.equal(rows(f).length,50);assert.equal(f.query('[data-caption-text="50"]'),null);
 // 50 split/merge action groups bring this estimated-cue fixture to 79,824 bytes, still bounded independently of 10,000 cues.
 // Explicit locale text/attribute markers add bounded metadata to the same 50 rows.
 assert.ok(Buffer.byteLength(f.target.innerHTML)<180000);
 f.panel.focus(49);assert.equal(rows(f)[0],0);
 f.panel.focus(50);assert.equal(rows(f)[0],50);assert.equal(f.query('[data-caption-text="49"]'),null);
 assert.match(f.target.innerHTML,/51–100 \/ 10000/);
 f.setProject(structuredClone(f.project()));assert.equal(rows(f)[0],50);
 f.query('#nextCaptionPage').onclick();assert.equal(rows(f)[0],100);
 f.query('#previousCaptionPage').onclick();assert.equal(rows(f)[0],50);
 f.panel.focus(9999);assert.equal(rows(f)[0],9950);assert.equal(rows(f).at(-1),9999);
 assert.deepEqual(f.project(),before);assert.equal(f.history.length,0);assert.ok(!f.log.some(e=>e[0]==='edit'));
});

test('search and replacement cover all 10000 rows, reveal off-page hits and keep fields across renders',()=>{
 const f=fixture(10000);input(f,'#captionFind','찾기');input(f,'#captionReplacement','교정');
 assert.equal(f.query('#captionSearchStatus').textContent,'자막 0 / 10000');
 f.query('#previousCaptionMatch').onclick();assert.equal(rows(f)[0],9950);
 assert.deepEqual(f.log.at(-1),['selection','[data-caption-text="9999"]',0,2]);
 f.query('#nextCaptionMatch').onclick();assert.equal(rows(f)[0],0);
 assert.equal(f.query('#captionFind').value,'찾기');assert.equal(f.query('#captionReplacement').value,'교정');
 f.query('#replaceAllCaptions').onclick();assert.ok(f.project().captions.every(c=>c.text.startsWith('교정')));assert.equal(f.history.length,1);
});

test('add, last-page deletion, undo/redo and imported first-row focus keep global targets correct',()=>{
 const f=fixture(50);f.query('#addCaption').onclick();assert.deepEqual(rows(f),[50]);assert.match(f.project().captions[50].text,/새로운/);
 f.query('[data-delete-caption="50"]').onclick();assert.equal(rows(f)[0],0);assert.equal(f.project().captions.length,50);
 f.undo();assert.equal(f.project().captions.length,51);f.panel.focus(50);assert.deepEqual(rows(f),[50]);
 f.redo();assert.equal(rows(f)[0],0);
 const imported={...f.project(),captions:Array.from({length:80},(_,i)=>({start:i,end:i+1,text:'import'}))};
 f.setProject(imported);f.panel.focus(79);assert.equal(rows(f)[0],50);f.panel.focus(0);assert.equal(rows(f)[0],0);
 f.setProject({...imported,captions:[]});f.panel.focus(-1);assert.deepEqual(f.log.at(-1),['focus','#addCaption']);
});

test('blur/change commits before page click, IME blocks paging and off-page focus/search',()=>{
 const f=fixture(101),field=f.query('[data-caption-text="0"]');
 field.value='작성 완료';field.onchange(); // Native click follows this change/blur boundary.
 f.query('#nextCaptionPage').onclick();assert.equal(f.project().captions[0].text,'작성 완료');assert.equal(f.history.length,1);
 input(f,'#captionFind','찾기');input(f,'#captionReplacement','');
 f.target.oncompositionstart();const markup=f.target.innerHTML,count=f.log.length;
 f.query('#nextCaptionPage').onclick();f.panel.focus(100);f.query('#previousCaptionMatch').onclick();
 assert.equal(f.target.innerHTML,markup);assert.equal(f.log.length,count);
 f.target.oncompositionend();f.panel.focus(100);assert.deepEqual(rows(f),[100]);
});

test('blocked add/delete/split neither focus nor announce success and full list refuses addition',()=>{
 const f=fixture(51);f.project().captions[0].text='긴 자막을 여러 부분으로 나누는 문장입니다';f.block();
 f.query('#captionChunkSize').value='5';const before=structuredClone(f.project());
 f.query('#addCaption').onclick();f.query('[data-delete-caption="0"]').onclick();f.query('#splitLongCaptions').onclick();
 assert.deepEqual(f.project(),before);assert.deepEqual(f.log,[]);
 const full=fixture(10000);full.query('#addCaption').onclick();assert.equal(full.project().captions.length,10000);assert.equal(full.history.length,0);
});

test('markup hides pagination for <=50 cues and bounds a supplied page after array shrink',()=>{
 const css=fs.readFileSync(new URL('../dist/styles/workspace-state.css',import.meta.url),'utf8');
 assert.match(css,/\.caption-pages\[hidden\]\s*\{\s*display:\s*none/);
 const p=createDemoProject();assert.match(captionsPanelMarkup(p,{}),/aria-label="자막 페이지" hidden/);
 const f=fixture(51);f.panel.focus(50);f.setProject({...f.project(),captions:f.project().captions.slice(0,1)});
 assert.deepEqual(rows(f),[0]);assert.match(f.target.innerHTML,/aria-label="자막 페이지" hidden/);
});


test('detached controls cannot edit shifted indices or navigate after a newer render',()=>{
 const f=fixture(101),oldField=f.query('[data-caption-text="0"]'),oldNext=f.query('#nextCaptionPage');
 oldField.value='committed';oldField.onchange();assert.equal(f.history.length,1);
 oldNext.onclick();assert.equal(rows(f)[0],50);
 oldField.value='stale';oldField.onchange();oldNext.onclick();
 assert.equal(f.project().captions[0].text,'committed');assert.equal(f.history.length,1);assert.equal(rows(f)[0],50);
 const second=f.query('[data-caption-text="50"]');f.undo();second.value='old row';second.onchange();
 assert.equal(f.project().captions[50].text,'찾기 50');assert.equal(f.history.length,0);
});


test('external replacement releases detached composition ownership without stale end clearing a new session',()=>{
 const f=fixture(101);f.target.oncompositionstart();const staleEnd=f.target.oncompositionend,staleStart=f.target.oncompositionstart;
 f.setProject(structuredClone(f.project()));f.query('#nextCaptionPage').onclick();assert.equal(rows(f)[0],50);
 staleStart();f.query('#nextCaptionPage').onclick();assert.deepEqual(rows(f),[100]);
 f.target.oncompositionstart();staleEnd();f.query('#previousCaptionPage').onclick();assert.deepEqual(rows(f),[100]);
 f.target.oncompositionend();f.query('#previousCaptionPage').onclick();assert.equal(rows(f)[0],50);
});


test('page-boundary navigation focuses the remaining enabled pager control',()=>{
 const f=fixture(101);
 f.query('#nextCaptionPage').onclick();assert.deepEqual(f.log.at(-1),['focus','#nextCaptionPage']);
 f.query('#nextCaptionPage').onclick();assert.equal(f.query('#nextCaptionPage').disabled,true);
 assert.deepEqual(f.log.at(-1),['focus','#previousCaptionPage']);
 f.query('#previousCaptionPage').onclick();assert.deepEqual(f.log.at(-1),['focus','#previousCaptionPage']);
 f.query('#previousCaptionPage').onclick();assert.equal(f.query('#previousCaptionPage').disabled,true);
 assert.deepEqual(f.log.at(-1),['focus','#nextCaptionPage']);
});

test('export format persists through paging while detached selector cannot override it',()=>{
 const f=fixture(101),select=f.query('#captionExportFormat');select.value='txt';select.onchange();
 f.query('#nextCaptionPage').onclick();assert.equal(f.query('#captionExportFormat').value,'txt');
 select.value='vtt';select.onchange();f.render();assert.equal(f.query('#captionExportFormat').value,'txt');
 assert.equal(f.history.length,0);assert.ok(!f.log.some(e=>e[0]==='edit'));
});
