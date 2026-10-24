import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {initLocale,setLocale} from '../dist/i18n.mjs';

async function fixture(setup='') {
    const f=await createAppFixture();
    vm.runInContext(`state.clips=[{start:0,end:2},{start:3,end:6},{start:8,end:12}];selected=2;current=7;history=[];future=[];globalThis.saves=0;scheduleSave=()=>saves++;${setup};switchPanel('settings');`,f.context);
    f.open=()=>f.element('#panelMoveClip').onclick();
    f.confirm=value=>{f.element('#clipMovePosition').value=String(value);f.element('#confirmClipMove').onclick();};
    f.snapshot=()=>f.evaluate('({state,history,future,current,selected,saves,playing})');
    return f;
}

test('move selected clip to numbered position is one undoable edit, follows selection and seeks destination start',async()=>{
    const f=await fixture(),before=f.evaluate('state');f.element('#panelTrimStart').value='';f.element('#trimEnd').value='11.234';f.open();
    assert.equal(f.element('#clipMovePosition').value,'3');f.confirm(1);
    assert.deepEqual(f.evaluate('state.clips'),[before.clips[2],before.clips[0],before.clips[1]]);
    assert.equal(f.evaluate('selected'),0);assert.equal(f.evaluate('current'),0);assert.equal(f.evaluate('playing'),false);
    assert.equal(f.evaluate('history.length'),1);assert.equal(f.element('#modal').open,false);assert.equal(f.element('#panelTrimStart').value,'');assert.equal(f.element('#trimEnd').value,'11.234');
    assert.deepEqual(f.evaluate('state.captions'),before.captions);assert.deepEqual(f.evaluate('state.overlays'),before.overlays);
    vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state.clips'),before.clips);
    vm.runInContext('undo(true)',f.context);assert.deepEqual(f.evaluate('state.clips'),[before.clips[2],before.clips[0],before.clips[1]]);
});

test('cancel and same position preserve drafts, playback, history and save state',async()=>{
    for(const cancel of [true,false]){
        const f=await fixture();f.element('#panelTrimStart').value='invalid draft';
        const before=f.snapshot();f.open();
        if(cancel)f.element('#cancelClipMove').onclick();else f.confirm(3);
        assert.deepEqual(f.snapshot(),before);assert.equal(f.element('#panelTrimStart').value,'invalid draft');
    }
});

test('invalid position stays open; composition and modified Enter are inert',async()=>{
    const f=await fixture(),before=f.snapshot();f.open();
    for(const value of ['',0,4,1.5,'NaN','Infinity']){f.confirm(value);assert.equal(f.element('#modal').open,true);assert.deepEqual(f.snapshot(),before);}
    const input=f.element('#clipMovePosition');input.value='1';input.oncompositionstart();f.element('#confirmClipMove').onclick();assert.deepEqual(f.snapshot(),before);
    input.oncompositionend();input.onkeydown({key:'Enter',ctrlKey:true});assert.deepEqual(f.snapshot(),before);
    let prevented=false;input.onkeydown({key:'Enter',preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(f.evaluate('selected'),0);
});

test('stale project, contents, media, selection and panel refuse dialog commits',async()=>{
    for(const mutation of ['selected=1','state.speed=2','state=structuredClone(state)',"sources.videoFile={}","sources.audioFile={}","switchPanel('text')"]){
        const f=await fixture();f.open();vm.runInContext(mutation,f.context);const before=f.snapshot();f.confirm(1);assert.deepEqual(f.snapshot(),before);
    }
});

test('busy and recovery block both direct move and arrows without seeking',async()=>{
    for(const mutation of ['loadingMedia=true','transcribing=true','exporting=true',"Object.defineProperty(persistence,'restorePhase',{get:()=> 'failed'})", "Object.defineProperty(audioRecording,'current',{get:()=>({})})"]){
        const f=await fixture();f.open();vm.runInContext(mutation,f.context);const before=f.snapshot();f.confirm(1);f.element('#moveLeft').onclick();assert.deepEqual(f.snapshot(),before);
    }
});

test('1000 indexed clips move directly; identical ranges remain index-based; arrows use shared command',async()=>{
    const f=await fixture('state.clips=Array.from({length:1000},()=>({start:1,end:2}));selected=999');
    f.open();f.confirm(1);assert.equal(f.evaluate('selected'),0);assert.equal(f.evaluate('history.length'),1);assert.equal(f.evaluate('state.clips.length'),1000);
    f.element('#moveRight').onclick();assert.equal(f.evaluate('selected'),1);assert.equal(f.evaluate('current'),1);assert.equal(f.evaluate('history.length'),2);
});

test('dialog field stays stable across languages and stale closed/reopened handlers are inert',async()=>{
    const f=await fixture();f.open();const old=f.element('#confirmClipMove').onclick;f.element('#cancelClipMove').onclick();f.open();
    f.element('#clipMovePosition').value='1';old();assert.equal(f.evaluate('selected'),2);
    for(const locale of ['en','zh-CN','ko']){setLocale(locale,{persist:false});assert.equal(f.element('#clipMovePosition').value,'1');}
    f.element('#confirmClipMove').onclick();assert.equal(f.evaluate('selected'),0);initLocale();
});


test('desktop and settings entry points are present and localized',async()=>{
    assert.match(fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8'),/id="moveClipButton"[^>]*><span data-i18n="panels.moveClip"/);
    for(const [locale,label] of [['ko','클립 이동…'],['en','Move clip…'],['zh-CN','移动片段…']]){
        const f=await fixture();setLocale(locale,{persist:false});vm.runInContext('renderPanel()',f.context);
        assert.ok(f.element('#panelContent').innerHTML.includes(label));
        f.element('#moveClipButton').onclick();assert.equal(f.element('#clipMovePosition').value,'3');
    }
    initLocale();
});


test('valid failed recovery permits in-memory reorder and undo but never browser persistence',async()=>{
    const f=await fixture(),writes=[];f.context.localStorage.setItem=(key,value)=>writes.push({key,value});
    vm.runInContext("persistence.restorePhase='failed';persistence.recoveryValid=true",f.context);
    const before=f.evaluate('state.clips');f.open();f.confirm(1);
    assert.equal(f.evaluate('selected'),0);assert.equal(f.evaluate('history.length'),1);
    f.element('#moveRight').onclick();assert.equal(f.evaluate('selected'),1);
    await vm.runInContext('saveProject(true)',f.context);assert.equal(writes.length,0);
    vm.runInContext('undo();undo()',f.context);assert.deepEqual(f.evaluate('state.clips'),before);
    assert.equal(writes.length,0);
    vm.runInContext('persistence.recoveryValid=false',f.context);
    const failed=f.snapshot();f.element('#moveRight').onclick();assert.deepEqual(f.snapshot(),failed);
});
