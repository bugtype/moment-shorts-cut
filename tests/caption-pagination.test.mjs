import {prepareCommand} from '../dist/core/commands.mjs';
import { formatError } from '../dist/i18n.mjs';
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
  const node=(selector,dataset={})=>{const n={setCustomValidity(value) { this.validationMessage = value; }, reportValidity() { return !this.validationMessage; }, attributes: {}, setAttribute(name, value) { this.attributes[name] = String(value); }, getAttribute(name) { return this.attributes[name] ?? null; }, removeAttribute(name) { delete this.attributes[name]; },dataset,value:'',focus(){if (!this.disabled) log.push(['focus',selector]);},scrollIntoView(){},setSelectionRange(a,b){log.push(['selection',selector,a,b]);}};nodes.set(selector,n);return n;};
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
  execute(name,args){
   if(blocked)return false;
   const result=prepareCommand(project,name,args);
   if(!result.project)return false;
   history.push(structuredClone(project));project=result.project;log.push(['edit']);render();return true;
  },
  edit(change,refresh){if(blocked)return;history.push(structuredClone(project));change();log.push(['edit']);if(refresh)render();},refresh:render,toast:message=>log.push(['toast',formatError(message)])});
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
 assert.equal(f.query('#captionSearchStatus').textContent,'일치 0 / 10000');
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

test('whole-list split keeps composing drafts mounted and permits a committed retry',()=>{
 for(const mode of ['owner','event','key229']){
  const f=fixture(1), originalText='오늘은 자막을 고쳐요. 다음은 시간을 맞춰요.';
  f.project().captions[0].text=originalText;f.render();
  const input=f.query('[data-caption-text="0"]'), button=f.query('#splitLongCaptions');
  input.value='오늘은 자막을 바꿔요. 다음은 시간을 맞춰요.';
  f.query('#captionChunkSize').value='12';
  if(mode==='owner')f.target.oncompositionstart();
  const before=structuredClone(f.project()),html=f.target.innerHTML;
  const event=mode==='event'?{isComposing:true}:mode==='key229'?{keyCode:229}:{};
  button.onclick(event);button.onclick(event);
  assert.deepEqual(f.project(),before);
  assert.equal(f.history.length,0);assert.deepEqual(f.log,[]);
  assert.equal(f.target.innerHTML,html);
  assert.equal(f.query('[data-caption-text="0"]'),input,'Do not detach the composing input');
  assert.equal(input.value,'오늘은 자막을 바꿔요. 다음은 시간을 맞춰요.');
  if(mode==='owner')f.target.oncompositionend();
  assert.deepEqual(f.project(),before);assert.equal(f.history.length,0,'Composition end must not run a deferred split');
  input.onchange(); // Explicit completed edit, not an implicit commit by Split.
  assert.equal(f.history.length,1);
  button.onclick({isComposing:false,keyCode:13});
  assert.equal(f.history.length,2);
  assert.deepEqual(f.project().captions.map(c=>c.text),['오늘은 자막을 바꿔요.','다음은 시간을 맞춰요.']);
  assert.ok(f.project().captions.every(c=>c.basis==='source'&&c.timing==='estimated'));
  assert.notEqual(f.query('[data-caption-text="0"]'),input,'A successful explicit split still remounts');
 }
});

test('markup hides pagination for <=50 cues and bounds a supplied page after array shrink',()=>{
 const css=fs.readFileSync(new URL('../dist/styles/workspace-state.css',import.meta.url),'utf8');
 assert.match(css,/\.caption-pages\[hidden\]\s*\{\s*display:\s*none/);
 const p=createDemoProject();assert.match(captionsPanelMarkup(p,{}),/aria-label="자막 페이지"[^>]* hidden/);
 const f=fixture(51);f.panel.focus(50);f.setProject({...f.project(),captions:f.project().captions.slice(0,1)});
 assert.deepEqual(rows(f),[0]);assert.match(f.target.innerHTML,/aria-label="자막 페이지"[^>]* hidden/);
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

const enterPage = (f, options = {}) => {
 let prevented = false;
 f.query('#captionPageNumber').onkeydown({key:'Enter',preventDefault(){prevented=true;},...options});
 return prevented;
};

test('page jump reaches middle, tail, first and same page without editing project or history',()=>{
 const f=fixture(10000),before=structuredClone(f.project());
 for(const [page,first,last] of [[100,4950,4999],[200,9950,9999],[1,0,49],[1,0,49]]){
  const markup=f.target.innerHTML;
  input(f,'#captionPageNumber',String(page));
  assert.equal(f.target.innerHTML,markup,'typing must not rerender rows');
  if(page===200)f.query('#goCaptionPage').onclick();else assert.equal(enterPage(f),true);
  assert.equal(rows(f)[0],first);assert.equal(rows(f).at(-1),last);assert.equal(rows(f).length,50);
  assert.deepEqual(f.log.at(-1),['focus',`[data-caption-text="${first}"]`]);
  assert.equal(f.query('#captionPageNumber').value,String(page));
 }
 assert.deepEqual(f.project(),before);assert.deepEqual(f.history,[]);
 assert.ok(!f.log.some(event=>event[0]==='edit'||event[0]==='toast'));
});

test('page jump refuses blank, invalid and out-of-range values and rechecks the current caption count',()=>{
 const f=fixture(10000),before=structuredClone(f.project());
 for(const value of ['', ' ', 'NaN', 'Infinity', '1.5', '0', '-1', '201']){
  const markup=f.target.innerHTML;
  input(f,'#captionPageNumber',value);assert.equal(f.query('#captionPageNumber').validationMessage,'');
  f.query('#goCaptionPage').onclick();
  assert.equal(f.target.innerHTML,markup);assert.match(f.query('#captionPageNumber').validationMessage,/200/);
  assert.deepEqual(f.log.at(-1),['focus','#captionPageNumber']);
 }
 assert.deepEqual(f.project(),before);assert.deepEqual(f.history,[]);
 // External count changes must not rely on the input's stale max attribute.
 f.project().captions.length=51;
 input(f,'#captionPageNumber','200');assert.equal(enterPage(f),true);
 assert.match(f.query('#captionPageNumber').validationMessage,/2/);assert.equal(rows(f)[0],0);
 input(f,'#captionPageNumber','2');f.query('#goCaptionPage').onclick();
 assert.deepEqual(rows(f),[50]);assert.equal(f.query('#captionPageNumber').validationMessage||'','');
});

test('jump keyboard modifiers, composition, hidden pager and detached controls are inert',()=>{
 const f=fixture(101);input(f,'#captionPageNumber','3');const markup=f.target.innerHTML;
 for(const options of [{key:'Escape'},{isComposing:true},{keyCode:229},{ctrlKey:true},{altKey:true},{metaKey:true},{shiftKey:true}]){
  assert.equal(enterPage(f,options),false);
 }
 f.target.oncompositionstart();assert.equal(enterPage(f),false);f.query('#goCaptionPage').onclick();
 assert.equal(f.target.innerHTML,markup);assert.deepEqual(f.log,[]);
 f.target.oncompositionend();
 const oldInput=f.query('#captionPageNumber'),oldGo=f.query('#goCaptionPage');
 f.render();oldInput.onkeydown({key:'Enter',preventDefault(){assert.fail('stale Enter');}});oldGo.onclick();
 assert.deepEqual(f.log,[]);assert.equal(rows(f)[0],0);
 for(const count of [0,50]){
  const hidden=fixture(count);input(hidden,'#captionPageNumber','1');
  assert.equal(enterPage(hidden),false);hidden.query('#goCaptionPage').onclick();
  assert.deepEqual(hidden.log,[]);assert.deepEqual(hidden.history,[]);
 }
});
