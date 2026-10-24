import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { setLocale } from '../dist/i18n.mjs';

async function fixture() {
    const f=await createAppFixture();
    vm.runInContext(`state.overlays=['A','B','C','D'].map((id,i)=>({...newCard(12),id,text:id,
        role:'free',start:i,end:i+2,enabled:i!==2}));selectedCard='B';effectTab='cards';
        current=1;history=[];switchPanel('effects');renderInspector();`,f.context);
    f.controls=()=>f.element('#panelContent').querySelector('#effectControls');
    f.action=(id,event={})=>f.controls().querySelector('#'+id).onclick(event);
    f.order=()=>f.evaluate('state.overlays.map(card=>card.id)');
    return f;
}

test('one-step stacking reorders stored cards only, preserving selection, playhead and trim drafts in one undo', async () => {
    const f=await fixture(),before=f.evaluate('state');
    f.element('#trimStart').value='1.25';f.element('#trimEnd').value='11.75';
    f.action('sceneForward');
    assert.deepEqual(f.order(),['A','C','B','D']);
    assert.deepEqual(f.evaluate('state'),{...before,overlays:[before.overlays[0],before.overlays[2],before.overlays[1],before.overlays[3]]});
    assert.equal(f.evaluate('selectedCard'),'B');
    assert.equal(f.evaluate('history.length'),1);
    assert.equal(f.evaluate('current'),1);
    assert.equal(f.element('#trimStart').value,'1.25');assert.equal(f.element('#trimEnd').value,'11.75');
    vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state'),before);
    vm.runInContext('undo(true)',f.context);assert.deepEqual(f.order(),['A','C','B','D']);
    f.action('sceneBackward');assert.deepEqual(f.order(),['A','B','C','D']);
});

test('front/back still work and step edges are inert with localized four-button markup', async () => {
    const f=await fixture();
    try {
        for(const locale of ['ko','en','zh-CN']) {
            setLocale(locale,{persist:false});vm.runInContext('renderPanel()',f.context);
            assert.match(f.controls().innerHTML,/class="panel-actions scene-stacking-actions"/);
            assert.equal((f.controls().innerHTML.match(/id="scene(?:Forward|Backward|ToFront|ToBack)"/g)||[]).length,4);
        }
        f.action('sceneToFront');assert.deepEqual(f.order(),['A','C','D','B']);
        const count=f.evaluate('history.length');
        assert.match(f.controls().innerHTML,/id="sceneForward" disabled/);
        f.action('sceneForward');f.action('sceneToFront');assert.equal(f.evaluate('history.length'),count);
        f.action('sceneToBack');assert.deepEqual(f.order(),['B','A','C','D']);
        assert.match(f.controls().innerHTML,/id="sceneBackward" disabled/);
        f.action('sceneBackward');assert.equal(f.evaluate('history.length'),count+1);
    } finally {setLocale('ko',{persist:false});}
});

test('edge focus moves to enabled opposite step on newly rendered controls', async () => {
    const f=await fixture(),root=f.element('#panelContent'),target=f.controls(),query=target.querySelector.bind(target);
    let html=target.innerHTML,buttons=new Map();
    const remount=value=>{
        html=value;buttons=new Map();
        for(const id of ['sceneForward','sceneBackward','sceneToFront','sceneToBack']) buttons.set('#'+id,{
            disabled:new RegExp(`id="${id}" disabled`).test(value),focus(){f.doc.activeElement=this;}
        });
    };
    remount(html);
    target.querySelector=selector=>buttons.get(selector)||query(selector);
    Object.defineProperty(target,'innerHTML',{configurable:true,get:()=>html,set:remount});
    vm.runInContext("selectedCard='C';renderPanel();",f.context);
    const original=target.querySelector('#sceneForward');
    original.onclick();
    assert.equal(f.doc.activeElement,target.querySelector('#sceneBackward'));
    assert.notEqual(f.doc.activeElement,original);
    assert.equal(f.doc.activeElement.disabled,false);
    assert.equal(root.querySelector('#effectControls'),target);
});

test('stale controls, selection, project, modal and IME cannot reorder', async () => {
    for(const change of ['renderPanel()',"selectedCard='A'",'state=structuredClone(state)',"panel='text'","effectTab='motion'","modalOpen('Other','content')"]) {
        const f=await fixture(),old=f.controls().querySelector('#sceneForward').onclick;
        vm.runInContext(change,f.context);const before=f.evaluate('state');old();
        assert.deepEqual(f.evaluate('state'),before);assert.equal(f.evaluate('history.length'),0);
    }
    const f=await fixture();
    f.action('sceneForward',{isComposing:true});f.action('sceneBackward',{keyCode:229});
    f.controls().oncompositionstart();f.action('sceneForward');f.controls().oncompositionend();
    assert.deepEqual(f.order(),['A','B','C','D']);
});

test('stack actions honor busy/recovery boundaries and failed-valid changes remain memory-only', async () => {
    const conditions=['editorReady=false','exporting=true','loadingMedia=true','transcribing=true',
        "Object.defineProperty(audioRecording,'requesting',{value:true})",
        "Object.defineProperty(audioRecording,'current',{value:{}})",
        "persistence.restorePhase='restoring'","persistence.restorePhase='failed';persistence.recoveryValid=false"];
    for(const condition of conditions) {
        const f=await fixture();vm.runInContext(condition,f.context);
        for(const id of ['sceneForward','sceneBackward','sceneToFront','sceneToBack']) f.action(id);
        assert.deepEqual(f.order(),['A','B','C','D']);assert.equal(f.evaluate('history.length'),0);
    }
    const f=await fixture(),writes=[];f.context.localStorage.setItem=(...args)=>writes.push(args);
    vm.runInContext("persistence.restorePhase='failed';persistence.recoveryValid=true",f.context);
    for(const id of ['sceneForward','sceneBackward','sceneToFront','sceneToBack']) f.action(id);
    assert.equal(f.evaluate('history.length'),4);
    await vm.runInContext('saveProject(true);scheduleSave();undo()',f.context);
    await new Promise(resolve=>setTimeout(resolve,300));
    assert.deepEqual(writes,[]);
});
