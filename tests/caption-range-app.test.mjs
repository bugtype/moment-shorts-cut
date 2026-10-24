import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {initLocale,setLocale} from '../dist/i18n.mjs';

async function fixture(count=120) {
    const f=await createAppFixture();
    vm.runInContext(`state=initial();state.captions=Array.from({length:${count}},(_,i)=>({start:0,end:1,text:'cue'+i,basis:i%2?'timeline':'source',speaker:'0',keywords:'keep',timing:'estimated'}));history=[];future=[];current=2;switchPanel('captions');`,f.context);
    f.open=()=>f.element('#removeCaptionRange').onclick({});
    f.remove=(first,last)=>{f.element('#captionRangeFirst').value=String(first);f.element('#captionRangeLast').value=String(last);return f.element('#confirmCaptionRange').onclick({});};
    return f;
}

test('cross-page authored range removes once, retains exact surviving metadata and supports undo/redo without seeking',async()=>{
    const f=await fixture(),before=f.evaluate('state');
    f.open();f.remove(49,51);
    assert.deepEqual(f.evaluate('state.captions'),before.captions.filter((_,i)=>i<48||i>50));
    assert.equal(f.evaluate('history.length'),1);assert.equal(f.evaluate('current'),2);
    assert.equal(f.doc.activeElement,f.element('[data-caption-text="48"]'));
    vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state'),before);
    vm.runInContext('undo(true)',f.context);assert.equal(f.evaluate('state.captions.length'),117);
});

test('tail and all10000 removal focus surviving page or Add while canceled dialogs preserve search drafts/page',async()=>{
    const f=await fixture();vm.runInContext('focusCaption(100)',f.context);f.open();assert.equal(f.element('#captionRangeFirst').value,'101');
    f.element('#cancelCaptionRange').onclick();
    f.element('#captionFind').value='draft';f.element('#captionFind').oninput();
    f.open();f.element('#cancelCaptionRange').onclick();assert.equal(f.element('#captionFind').value,'draft');
    f.open();f.remove(51,120);assert.equal(f.doc.activeElement,f.element('[data-caption-text="49"]'));assert.equal(f.evaluate('current'),2);
    const all=await fixture(10000);all.open();all.remove(1,10000);
    assert.equal(all.evaluate('state.captions.length'),0);assert.equal(all.evaluate('history.length'),1);assert.equal(all.doc.activeElement,all.element('#addCaption'));
    vm.runInContext('undo()',all.context);assert.equal(all.evaluate('state.captions.length'),10000);
});

test('invalid ranges, busy, composing and stale dialog/source/project controls never mutate',async()=>{
    const f=await fixture();f.open();
    for(const [a,b] of [['',1],[0,1],[2,1],[1,121],[1.2,2],['Infinity',2]])f.remove(a,b);
    assert.equal(f.evaluate('history.length'),0);assert.equal(f.evaluate('modal.open'),true);
    f.element('#captionRangeFirst').oncompositionstart();f.remove(1,2);assert.equal(f.evaluate('history.length'),0);
    f.element('#captionRangeFirst').oncompositionend();f.element('#confirmCaptionRange').onclick({isComposing:true});assert.equal(f.evaluate('history.length'),0);
    for(const change of ["state.name='changed'","state=structuredClone(state)","sources.audioFile={}","switchPanel('settings')","loadingMedia=true","transcribing=true","exporting=true","Object.defineProperty(audioRecording,'current',{get:()=>({})})"]){
        const a=await fixture();a.open();vm.runInContext(change,a.context);a.remove(1,2);assert.equal(a.evaluate('history.length'),0,change);
    }
    const a=await fixture();a.open();const old=a.element('#confirmCaptionRange').onclick;a.element('#cancelCaptionRange').onclick();a.open();old({});assert.equal(a.evaluate('history.length'),0);
});

test('survivor beyond shortened timeline stays exact, failed-valid removal/undo never repairs storage',async()=>{
    const f=await fixture(3),writes=[];f.context.localStorage.setItem=(...args)=>writes.push(args);
    vm.runInContext("state.clips=[{start:0,end:1}];state.captions[1].end=10;persistence.restorePhase='failed';persistence.recoveryValid=true;renderPanel();",f.context);
    const before=f.evaluate('state');f.open();f.remove(1,1);
    assert.deepEqual(f.evaluate('state.captions'),before.captions.slice(1));assert.equal(f.evaluate('history.length'),1);
    await vm.runInContext('saveProject(true);scheduleSave();',f.context);assert.deepEqual(writes,[]);
    vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state'),before);assert.equal(f.evaluate('persistence.restorePhase'),'failed');
    for(const phase of ['failed','restoring']){const a=await fixture();vm.runInContext(`persistence.restorePhase='${phase}';persistence.recoveryValid=false;`,a.context);a.open();assert.equal(a.evaluate('!!modal.open'),false);}
});

test('range dialog localizes labels and authored index semantics across three locales',async()=>{
    try {for(const [locale,label] of [['ko','자막 범위 삭제'],['en','Remove caption range'],['zh-CN','删除字幕范围']]){
        const f=await fixture();setLocale(locale,{persist:false});f.open();assert.ok(f.element('#modal').innerHTML.includes(label));
        f.remove(2,2);assert.equal(f.evaluate('state.captions[1].text'),'cue2');
    }}finally{initLocale();}
});


test('Enter is IME/modifier guarded and cancel leaves uncommitted row draft untouched',async()=>{
    const f=await fixture(5), row=f.element('[data-caption-text="0"]');row.value='unfinished draft';
    f.open();f.element('#cancelCaptionRange').onclick();assert.equal(row.value,'unfinished draft');assert.equal(f.evaluate('history.length'),0);
    f.open();f.element('#captionRangeFirst').value='2';f.element('#captionRangeLast').value='3';
    const input=f.element('#captionRangeLast');let prevented=0;
    for(const flag of [{isComposing:true},{keyCode:229},{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true}])input.onkeydown({key:'Enter',preventDefault(){prevented++;},...flag});
    assert.equal(prevented,0);assert.equal(f.evaluate('history.length'),0);
    input.onkeydown({key:'Enter',preventDefault(){prevented++;}});assert.equal(prevented,1);assert.equal(f.evaluate('history.length'),1);
    assert.equal(f.evaluate('state.captions.length'),3);
});


test('range entry ignores composing events and cannot replace another open modal',async()=>{
    const f=await fixture(),open=f.element('#removeCaptionRange').onclick;
    open({isComposing:true});open({keyCode:229});assert.equal(f.evaluate('!!modal.open'),false);
    vm.runInContext('renderPanel()',f.context);open({});assert.equal(f.evaluate('!!modal.open'),false,'detached opener remains inert');
    vm.runInContext("modalOpen('Other','Keep this dialog','');",f.context);const before=f.element('#modal').innerHTML;
    f.element('#removeCaptionRange').onclick({});assert.equal(f.element('#modal').innerHTML,before);assert.equal(f.evaluate('history.length'),0);
});
