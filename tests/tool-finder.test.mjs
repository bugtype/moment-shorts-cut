import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppFixture} from './fixtures/app.mjs';
import {createToolFinder} from '../dist/tool-finder.mjs';
import {createDemoProject} from '../dist/core/project.mjs';
import {findToolTargets} from '../dist/tool-finder-targets.mjs';
import {setLocale, translateFor} from '../dist/i18n.mjs';
import {messages} from '../dist/i18n/catalogs/finder.mjs';

function open(f) {
 f.element('#helpButton').onclick();
 f.element('#findToolsButton').onclick();
 assert.equal(f.element('#modal').open,true);
}
function query(f,value) { f.element('#toolFinderQuery').value=value;f.element('#toolFinderQuery').oninput(); }
const state = f => f.evaluate('JSON.stringify({state,history,future,current,playing})');

test('all ten targets reveal controls or open only the two existing dialogs without executing edits',async()=>{
 for(const [index,target] of findToolTargets().entries()){
  const f=await createAppFixture();
  f.evaluate("globalThis.finderSideEffects=0; scheduleSave=()=>finderSideEffects++; download=()=>finderSideEffects++; loadVideo=()=>finderSideEffects++; loadAudio=()=>finderSideEffects++; generateCaptions=()=>finderSideEffects++; toggleRecording=()=>finderSideEffects++; true");
  const before=state(f);open(f);
  assert.equal(state(f),before);
  f.element('#toolFinderResult'+index).onclick();
  if(target.panel){
   assert.equal(f.evaluate('panel'),target.panel);assert.equal(f.element('#modal').open,false);
   assert.equal(f.doc.activeElement,f.element(target.selector));
   if(target.details)assert.equal(f.element(target.details).open,true);
  }else{
   assert.equal(f.element('#modal').open,true);
   assert.match(f.element('#modal').innerHTML,target.action==='seek'?/id="outputSeekTime"/:/id="importProjectSettingsButton"/);
  }
  assert.equal(state(f),before);assert.equal(f.evaluate('finderSideEffects'),0);
 }
});

test('query changes, IME, cancel and replacement invalidate old actions; no automatic Enter action',async()=>{
 const f=await createAppFixture();open(f);const before=state(f);
 const old=f.element('#toolFinderResult0').onclick;
 query(f,'no-destination-xyz');old();assert.equal(f.element('#modal').open,true);
 assert.match(f.element('#toolFinderResults').innerHTML,/일치하는 도구/);
 query(f,'templates');const input=f.element('#toolFinderQuery');
 assert.equal(typeof input.onkeydown,'undefined','typing Enter does not activate a destination');
 const result=f.element('#toolFinderResult0').onclick;
 input.oncompositionstart();result();assert.equal(f.element('#modal').open,true);
 input.oncompositionend();f.element('#toolFinderResult0').onclick({keyCode:229});assert.equal(f.element('#modal').open,true);
 f.element('#cancelToolFinder').onclick();f.element('#modal').onclose?.();assert.equal(f.element('#modal').open,false);
 assert.equal(f.doc.activeElement,f.element('#helpButton'));result();assert.equal(state(f),before);
 open(f);const stale=f.element('#toolFinderResult0').onclick;
 f.evaluate('app.showProjectFiles(); true');stale();assert.match(f.element('#modal').innerHTML,/id="importProjectSettingsButton"/);
 assert.equal(state(f),before);
});

test('project, media, panel and same-panel rerenders invalidate captured navigation; busy is retryable',async()=>{
 for(const change of ["state.name='Changed'",'state=structuredClone(state)',"sources.videoFile={name:'replacement'}", "sources.sourceURL='replacement'", "switchPanel('audio')",'renderPanel()', 'selected=1']){
  const f=await createAppFixture();open(f);const old=f.element('#toolFinderResult0').onclick;
  f.evaluate(change+'; true');const before=state(f);old();
  assert.equal(f.element('#modal').open,true);assert.match(f.element('#toolFinderStatus').innerHTML,/바뀌었습니다/);assert.equal(state(f),before);
 }
 const f=await createAppFixture();open(f);const result=f.element('#toolFinderResult0').onclick;
 f.evaluate('transcribing=true; true');result();assert.equal(f.element('#modal').open,true);
 f.evaluate('transcribing=false; true');result();assert.equal(f.element('#modal').open,false);
});

test('native close restores Guide focus, but late closes do not steal routed dialog focus',async()=>{
 const f=await createAppFixture();open(f);
 f.element('#modal').close();f.element('#modal').onclose?.();assert.equal(f.doc.activeElement,f.element('#helpButton'));
 open(f);const close=f.element('#modal').onclose;
 query(f,'output time');f.element('#toolFinderResult0').onclick();
 assert.equal(f.doc.activeElement,f.element('#outputSeekTime'));close();
 assert.equal(f.doc.activeElement,f.element('#outputSeekTime'));
 f.element('#cancelOutputSeek').onclick();
 open(f);assert.equal(f.element('#toolFinderQuery').value,'','query is never retained between opens');
});

test('localized results preserve query/caret and callbacks, and authored project data is not searched',async()=>{
 const f=await createAppFixture();f.evaluate("state.name='PrivateUnlistedPhrase';state.captions[0].text='PrivateUnlistedPhrase'; true");open(f);
 query(f,'PrivateUnlistedPhrase');assert.match(f.element('#toolFinderResults').innerHTML,/일치하는 도구/);
 query(f,'templates');const input=f.element('#toolFinderQuery');input.focus();input.setSelectionRange(2,5);
 const handler=f.element('#toolFinderResult0').onclick,before=state(f);
 // Model the result's actual marked leaf; fixture innerHTML is not parsed.
 const leaf=f.element('#finder-label');leaf.setAttribute('data-i18n','finder.templates');leaf.setAttribute('data-i18n-params','{}');
 try{
  for(const locale of ['ko','en','zh-CN']){
   setLocale(locale,{persist:false});assert.equal(leaf.textContent,translateFor(locale,'finder.templates'));
   assert.equal(input.value,'templates');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,5);
   assert.equal(f.doc.activeElement,input);assert.equal(f.element('#toolFinderResult0').onclick,handler);assert.equal(state(f),before);
  }
 }finally{setLocale('ko',{persist:false});}
 const placeholders=value=>[...value.matchAll(/\{(\w+)\}/g)].map(match=>match[1]);
 for(const locale of ['ko','en','zh-CN'])for(const key of Object.keys(messages.ko)){
  assert.ok(messages[locale][key]);assert.deepEqual(placeholders(messages[locale][key]),placeholders(messages.ko[key]));
 }
});

test('disabled, hidden or missing controls use visible rail focus without clicking any fallback',()=>{
 for(const mode of ['disabled','hidden','missing']){
  const nodes=new Map(),events=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',focus(){events.push(['focus',id]);},click(){assert.fail('finder must not click');}});return nodes.get(id);};
  const app={state:createDemoProject(),panel:'captions',selected:0,panelRevision:0,editorReady:true,sources:{},audioRecording:{},persistence:{restorePhase:'ready'},
   query:id=>id==='#templateSearch'&&mode==='missing'?null:node(id),toast(){},
   modal:{open:false,close(){this.open=false;this.onclose?.();}},
   modalOpen(){this.modal.open=true;},
   switchPanel(panel){this.panel=panel;this.panelRevision++;},openSeek(){assert.fail('unexpected dialog');},showProjectFiles(){assert.fail('unexpected dialog');}};
  node('#templateSearch')[mode]=true;
  createToolFinder(app).open();node('#toolFinderResult0').onclick();
  assert.deepEqual(events.at(-1),['focus','[data-panel="templates"]']);
 }
});

test('blocked startup leaves Guide intact and retained Guide handlers cannot reopen finder',async()=>{
 const f=await createAppFixture();f.element('#helpButton').onclick();const old=f.element('#findToolsButton').onclick;
 f.evaluate('loadingMedia=true; true');old();assert.match(f.element('#modal').innerHTML,/guide-steps/);
 f.evaluate('loadingMedia=false; true');old();assert.match(f.element('#modal').innerHTML,/toolFinderQuery/);
 f.element('#cancelToolFinder').onclick();old();assert.equal(f.element('#modal').open,false);
});
