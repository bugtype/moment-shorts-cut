import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {initLocale,setLocale} from '../dist/i18n.mjs';

const trigger=f=>f.element('#panelContent #effectControls #moveSceneTime');
async function fixture(setup=''){
    const f=await createAppFixture();
    vm.runInContext(`state.overlays=[{...newCard(12),id:'moving',start:0,end:3,text:'Keep me'},{...newCard(12),id:'other',start:4,end:8}];selectedCard='moving';history=[];future=[];current=2;globalThis.saves=0;scheduleSave=()=>saves++;${setup};switchPanel('effects');renderInspector();`,f.context);
    f.open=()=>trigger(f).onclick();
    f.confirm=value=>{f.element('#cardMoveStart').value=String(value);return f.element('#confirmCardMove').onclick();};
    f.snapshot=()=>f.evaluate('({state,current,history,future,saves,selectedCard,playing})');
    return f;
}

test('moving card forward/backward updates both endpoints in one undoable command and preserves other fields',async()=>{
    const f=await fixture(),before=f.evaluate('state');f.element('#trimStart').value='1.25';f.element('#trimEnd').value='4.5';
    f.open();f.confirm(7);
    const expected=structuredClone(before);expected.overlays[0].start=7;expected.overlays[0].end=10;
    assert.deepEqual(f.evaluate('state'),expected);assert.equal(f.evaluate('history.length'),1);assert.equal(f.evaluate('current'),2);
    assert.equal(f.element('#trimStart').value,'1.25');assert.equal(f.element('#trimEnd').value,'4.5');
    f.open();f.confirm(0);assert.deepEqual(f.evaluate('state'),before);assert.equal(f.evaluate('history.length'),2);
    vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state'),expected);
    vm.runInContext('undo(true)',f.context);assert.deepEqual(f.evaluate('state'),before);
});

test('cancel and same output start preserve playback, drafts and history, including out-of-range cards',async()=>{
    for(const setup of ['', 'state.overlays[0].start=20;state.overlays[0].end=40'])for(const cancel of [true,false]){
        const f=await fixture(setup),before=f.snapshot();f.element('#panelContent #effectControls #sceneText').value='Draft';f.open();
        if(cancel)f.element('#cancelCardMove').onclick();else f.confirm(f.evaluate('state.overlays[0].start'));
        assert.deepEqual(f.snapshot(),before);assert.equal(f.element('#panelContent #effectControls #sceneText').value,'Draft');
    }
});

test('output seconds preserve fractional duration at .25/4 speed and allow interval ending exactly at output end',async()=>{
    for(const speed of [.25,4]){
        const f=await fixture(`state.speed=${speed};state.overlays[0].start=.125;state.overlays[0].end=.375;state.overlays[1].start=0;state.overlays[1].end=1`);
        f.open();assert.equal(f.element('#cardMoveStart').value,'0.125');
        const end=12/speed;f.confirm(end-.25);
        assert.equal(f.evaluate('state.overlays[0].end'),end);assert.equal(f.evaluate('state.overlays[0].end-state.overlays[0].start'),.25);
    }
});

test('blank, overflow, invalid, cannot-fit and precision-collapse are rejected without mutation',async()=>{
    const f=await fixture();f.open();const before=f.snapshot();
    for(const value of ['',-1,10,'NaN','Infinity']){f.confirm(value);assert.deepEqual(f.snapshot(),before);assert.equal(f.element('#modal').open,true);}
    const tooLong=await fixture('state.overlays[0].end=20');tooLong.open();assert.match(tooLong.element('#modal').innerHTML,/카드 길이가 영상보다/);assert.doesNotMatch(tooLong.element('#modal').innerHTML,/max="-/);const longBefore=tooLong.snapshot();tooLong.confirm(1);assert.deepEqual(tooLong.snapshot(),longBefore);
    const tiny=await fixture('state.overlays[0].end=1e-20');tiny.open();const tinyBefore=tiny.snapshot();tiny.confirm(1);assert.deepEqual(tiny.snapshot(),tinyBefore);
});

test('stale project/card/selection/media/panel/dialog and IME handlers do not edit',async()=>{
    for(const change of ["selectedCard='other'","state.overlays[0].text='Edited'",'state=structuredClone(state)','sources.videoFile={}','sources.audioFile={}',"switchPanel('text')","modal.close()"]){
        const f=await fixture();f.element('#panelContent #effectControls').oncompositionstart();f.open();assert.notEqual(f.element('#modal').open,true);f.element('#panelContent #effectControls').oncompositionend();f.open();const old=f.element('#confirmCardMove').onclick;f.element('#cardMoveStart').value='7';vm.runInContext(change,f.context);const before=f.snapshot();old();assert.deepEqual(f.snapshot(),before);
    }
    const f=await fixture();f.element('#panelContent #effectControls').oncompositionstart();f.open();assert.notEqual(f.element('#modal').open,true);f.element('#panelContent #effectControls').oncompositionend();f.open();const old=f.element('#confirmCardMove').onclick;f.element('#cancelCardMove').onclick();f.open();f.element('#cardMoveStart').value='7';old();assert.equal(f.evaluate('history.length'),0);
    const input=f.element('#cardMoveStart');input.oncompositionstart();f.element('#confirmCardMove').onclick();assert.equal(f.evaluate('history.length'),0);input.oncompositionend();
    input.onkeydown({key:'Enter',altKey:true});assert.equal(f.evaluate('history.length'),0);input.onkeydown({key:'Enter',preventDefault(){}});assert.equal(f.evaluate('history.length'),1);
});

test('busy guards and valid failed recovery maintain existing metadata-edit/no-storage policy',async()=>{
    for(const change of ['loadingMedia=true','transcribing=true','exporting=true',"persistence.restorePhase='failed';persistence.recoveryValid=false","Object.defineProperty(audioRecording,'requesting',{get:()=>true})"]){
        const f=await fixture();f.open();vm.runInContext(change,f.context);const before=f.snapshot();f.confirm(7);assert.deepEqual(f.snapshot(),before);
    }
    const f=await fixture(),writes=[],timers=[];f.context.localStorage.setItem=(...args)=>writes.push(args);f.context.setTimeout=(...args)=>timers.push(args);vm.runInContext("persistence.restorePhase='failed';persistence.recoveryValid=true;scheduleSave=()=>persistence.scheduleSave()",f.context);
    f.open();f.confirm(7);assert.equal(f.evaluate('state.overlays[0].start'),7);await vm.runInContext('saveProject(true);undo()',f.context);assert.deepEqual(writes,[]);assert.equal(f.evaluate('persistence.saveTimer===undefined'),true);assert.equal(timers.filter(([,delay])=>delay===500).length,0);
});

test('all three locales expose the timing action and duration/end preview without converting authored text',async()=>{
    for(const [locale,label] of [['ko','표시 시간 이동…'],['en','Move in time…'],['zh-CN','移动显示时间…']]){
        const f=await fixture();setLocale(locale,{persist:false});vm.runInContext('renderPanel()',f.context);assert.ok(f.element('#panelContent #effectControls').innerHTML.includes(label));f.open();
        const input=f.element('#cardMoveStart');input.value='7';input.oninput();assert.equal(f.element('#cardMoveEnd').textContent,'10');assert.equal(f.evaluate('state.overlays[0].text'),'Keep me');
    }
    initLocale();
});


test('decimal endpoint roundoff snaps only within bounded relative ULPs; true overflow remains rejected',async()=>{
    const f=await fixture('state.clips=[{start:0,end:.3}];state.overlays[0].end=.1;state.overlays[1].start=0;state.overlays[1].end=.2');
    f.open();f.confirm(.2);assert.equal(f.evaluate('state.overlays[0].start'),.2);assert.equal(f.evaluate('state.overlays[0].end'),.3);
    vm.runInContext('undo()',f.context);f.open();const before=f.snapshot();f.confirm(.200000000000001);assert.deepEqual(f.snapshot(),before);
});
