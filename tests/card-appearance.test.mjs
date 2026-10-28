import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createDemoProject} from '../dist/core/project.mjs';
import {newCard} from '../dist/effects.mjs';
import {createAppFixture} from './fixtures/app.mjs';
import {mountEffectsPanel} from '../dist/effects-panel.mjs';
const keys=['color','accent','background','size','stroke','backgroundOpacity','presentation','animation'];
const project=()=>({...createDemoProject(),overlays:[{...newCard(12),id:'source',color:'#123456',accent:'#abcdef',background:'#654321',size:44,stroke:6,backgroundOpacity:.4,presentation:'panel',animation:'pop'},{...newCard(12),id:'target',text:'Target',detail:'Keep',label:'CTA',start:6,end:10,x:.2,y:.7,width:.5,role:'free',kind:'countdown',enabled:false}]});
const button=(f,id)=>f.element('#panelContent #effectControls #'+id);
async function fixture(){const f=await createAppFixture();f.context.seed=project();vm.runInContext('state=seed;selectedCard="source";selected=0;current=2;history=[];future=[];globalThis.saves=0;scheduleSave=()=>saves++;renderInspector();switchPanel("effects");',f.context);return f;}
test('copy is read-only; paste copies exactly eight appearance fields with one undo and preserved current/trim/selection',async()=>{
 const f=await fixture(),{context,evaluate,element,doc}=f;const original=evaluate('state');
 button(f,'copySceneAppearance').onclick();assert.deepEqual(evaluate('state'),original);assert.equal(evaluate('history.length'),0);assert.equal(evaluate('saves'),0);assert.equal(doc.activeElement,button(f,'copySceneAppearance'));
 vm.runInContext('selectedCard="target";renderPanel()',context);element('#trimStart').value='1.50';element('#trimEnd').value='3.50';
 const stale=button(f,'pasteSceneAppearance').onclick;stale();const expected=structuredClone(original);for(const key of keys)expected.overlays[1][key]=original.overlays[0][key];
 assert.deepEqual(evaluate('state'),expected);assert.equal(evaluate('history.length'),1);assert.equal(evaluate('current'),2);assert.equal(evaluate('selectedCard'),'target');assert.deepEqual([element('#trimStart').value,element('#trimEnd').value],['1.50','3.50']);assert.equal(doc.activeElement,button(f,'pasteSceneAppearance'));
 stale();button(f,'pasteSceneAppearance').onclick();assert.equal(evaluate('history.length'),1);
 vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),original);vm.runInContext('undo(true)',context);assert.deepEqual(evaluate('state'),expected);
});
test('snapshot survives source changes/removal and new project, but old callbacks cannot target replacement',async()=>{
 const f=await fixture(),{context,evaluate}=f;button(f,'copySceneAppearance').onclick();const captured=evaluate('state.overlays[0]');
 vm.runInContext('state.overlays[0].color="#ffffff";state.overlays.shift();selectedCard="target";renderPanel()',context);button(f,'pasteSceneAppearance').onclick();assert.equal(evaluate('state.overlays[0].color'),captured.color);
 const stale=button(f,'pasteSceneAppearance').onclick;context.replacement=project();vm.runInContext('state=replacement;selectedCard="target"',context);const before=evaluate('state');stale();assert.deepEqual(evaluate('state'),before);
 vm.runInContext('renderPanel()',context);button(f,'pasteSceneAppearance').onclick();assert.equal(evaluate('state.overlays[1].color'),captured.color);
});
test('paste requires clipboard/current target and shared busy guard without phantom history',async()=>{
 const f=await fixture(),{context,evaluate}=f;const before=evaluate('state');button(f,'pasteSceneAppearance').onclick();assert.deepEqual(evaluate('state'),before);assert.equal(evaluate('history.length'),0);
 button(f,'copySceneAppearance').onclick();vm.runInContext('selectedCard="target";renderPanel();exporting=true;',context);button(f,'pasteSceneAppearance').onclick();assert.deepEqual(evaluate('state'),before);assert.equal(evaluate('history.length'),0);
 vm.runInContext('exporting=false;state.overlays=[];',context);button(f,'pasteSceneAppearance').onclick();assert.equal(evaluate('state.overlays.length'),0);assert.equal(evaluate('history.length'),0);
});
test('mounted style controls disable empty paste and reject stale/replaced-project callbacks',()=>{
 let p=project(),controls,copied=false,copies=0,pastes=0,focus='',remountOnCopy=true,copyFailure=false;const root={querySelector:()=>controls,querySelectorAll:()=>[]};
 Object.defineProperty(root,'innerHTML',{set(){controls={nodes:new Map(),querySelector(id){return this.nodes.get(id)||null;},querySelectorAll(){return [];}};const owned=controls;
 Object.defineProperty(owned,'innerHTML',{set(html){for(const m of html.matchAll(/<button[^>]*id="([^"]+)"[^>]*>/g))owned.nodes.set('#'+m[1],{disabled:/\bdisabled/.test(m[0]),focus(){assert.equal(this.disabled,false);focus=m[1];}});}});}});
 const render=()=>{const source=p;mountEffectsPanel(root,{state:p,total:12,tab:'cards',selected:'target',current:()=>p===source,hasCopiedAppearance:copied,copyAppearance(){if(copyFailure==='throw')throw new Error('copy failed');if(copyFailure)return false;copies++;copied=true;if(remountOnCopy)render();return true;},pasteAppearance(){pastes++;render();return true;}});};
 render();assert.equal(controls.querySelector('#pasteSceneAppearance').disabled,true);const old=controls.querySelector('#copySceneAppearance').onclick;old();assert.equal(copies,1);assert.equal(controls.querySelector('#pasteSceneAppearance').disabled,false);assert.equal(focus,'copySceneAppearance');old();assert.equal(copies,1);
 const stale=controls.querySelector('#pasteSceneAppearance').onclick;p=structuredClone(p);stale();assert.equal(pastes,0);render();controls.querySelector('#pasteSceneAppearance').onclick();assert.equal(pastes,1);assert.equal(focus,'pasteSceneAppearance');
 copied=false;remountOnCopy=false;render();
 const currentCopy=controls.querySelector('#copySceneAppearance'),currentPaste=controls.querySelector('#pasteSceneAppearance');
 assert.equal(currentPaste.disabled,true);const priorFocus=focus;
 copyFailure=true;currentCopy.onclick();assert.equal(currentPaste.disabled,true);assert.equal(focus,priorFocus);
 copyFailure='throw';assert.throws(()=>currentCopy.onclick(),/copy failed/);assert.equal(currentPaste.disabled,true);
 copyFailure=false;const beforeCopies=copies;currentCopy.onclick();currentCopy.onclick();
 assert.equal(copies,beforeCopies+2,'still-current Copy can be repeated');
 assert.equal(controls.querySelector('#pasteSceneAppearance'),currentPaste);assert.equal(currentPaste.disabled,false);
 assert.equal(focus,'copySceneAppearance');
 copied=false;render();currentCopy.onclick();assert.equal(copies,beforeCopies+2);assert.equal(controls.querySelector('#pasteSceneAppearance').disabled,true);
});
