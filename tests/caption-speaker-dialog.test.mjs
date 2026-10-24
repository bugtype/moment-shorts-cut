import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { setLocale } from '../dist/i18n.mjs';

async function fixture() {
    const f = await createAppFixture();
    vm.runInContext(`state.duration=300;state.clips=[{start:0,end:300}];
        state.captions=Array.from({length:101},(_,i)=>({start:i,end:i+1,text:'cue '+i,
            basis:i%2?'timeline':'source',speaker:'1',keywords:'keep',timing:'estimated'}));
        state.audioOffset=3;current=2;history=[];future=[];switchPanel('captions');`, f.context);
    f.open = event => f.element('#assignSpeakerRange').onclick(event || {});
    f.apply = ({first,last,speaker} = {}) => {
        for (const [id,value] of [['First',first],['Last',last],['Value',speaker]]) {
            if (value !== undefined) f.element('#speakerRange'+id).value=String(value);
        }
        f.element('#confirmSpeakerRange').onclick({});
    };
    return f;
}

test('speaker range uses authored rows across pages with one undo and preserves all other fields', async () => {
    const f=await fixture(), before=f.evaluate('state');
    f.element('#nextCaptionPage').onclick();
    vm.runInContext('renderInspector()',f.context);
    f.element('#trimStart').value='1.2345';
    f.element('#trimEnd').value='299';
    f.open();
    assert.equal(f.element('#speakerRangeFirst').value,'51');
    assert.equal(f.element('#speakerRangeLast').value,'51');
    assert.equal(f.element('#speakerRangeValue').value,'1');
    f.apply({first:49,last:52,speaker:'0'});
    const expected=structuredClone(before);
    expected.captions.slice(48,52).forEach(caption=>caption.speaker='0');
    assert.deepEqual(f.evaluate('state'),expected);
    assert.equal(f.evaluate('history.length'),1);
    assert.equal(f.evaluate('current'),2);
    assert.equal(f.element('#trimStart').value,'1.2345');
    assert.equal(f.element('#trimEnd').value,'299');
    assert.equal(f.doc.activeElement,f.element('#assignSpeakerRange'));
    vm.runInContext('undo()',f.context);
    assert.deepEqual(f.evaluate('state'),before);
    vm.runInContext('undo(true)',f.context);
    assert.deepEqual(f.evaluate('state'),expected);
});

test('maximum authored range remains one edit without changing caption count or clocks', async () => {
    const f=await fixture();
    vm.runInContext("state.captions=Array.from({length:10000},(_,i)=>({start:i,end:i+1,text:'cue '+i}));renderPanel();",f.context);
    f.open();
    f.apply({first:1,last:10000,speaker:'1'});
    assert.equal(f.evaluate('state.captions.length'),10000);
    assert.equal(f.evaluate("state.captions.every((c,i)=>c.speaker==='1'&&c.start===i&&c.end===i+1)"),true);
    assert.equal(f.evaluate('history.length'),1);
});

test('cancel and matching None preserve missing fields, playback, drafts and history', async () => {
    const f=await fixture();
    vm.runInContext("delete state.captions[0].speaker;state.captions[1].speaker='';playing=true;",f.context);
    f.element('#captionFind').value='draft';
    const before=f.evaluate('({state,history,current,playing})');
    f.open();
    assert.equal(f.element('#speakerRangeValue').value,'');
    f.element('#cancelSpeakerRange').onclick();
    assert.deepEqual(f.evaluate('({state,history,current,playing})'),before);
    f.open();
    f.apply({first:1,last:2,speaker:''});
    assert.deepEqual(f.evaluate('({state,history,current,playing})'),before);
    assert.equal(f.element('#captionFind').value,'draft');
    assert.equal(f.evaluate('!!modal.open'),false);
    assert.equal(f.element('#toast').getAttribute('data-i18n'),'panels.speakerRangeUnchanged');
});

test('invalid bounds and speaker reject atomically; busy same-context confirmation can retry', async () => {
    const f=await fixture(), before=f.evaluate('state');
    f.open();
    for(const range of [{first:'',last:1},{first:0,last:1},{first:1.5,last:2},{first:3,last:2},{first:1,last:102}]) {
        f.apply({...range,speaker:'0'});
        assert.deepEqual(f.evaluate('state'),before);
        assert.equal(f.evaluate('!!modal.open'),true);
    }
    f.apply({first:1,last:2,speaker:'bad'});
    assert.equal(f.evaluate('history.length'),0);
    vm.runInContext('loadingMedia=true',f.context);
    f.apply({speaker:'0'});
    assert.equal(f.evaluate('history.length'),0);
    vm.runInContext('loadingMedia=false',f.context);
    f.apply();
    assert.equal(f.evaluate('history.length'),1);
});

test('project, media and panel changes reject confirmation without editing', async () => {
    for(const change of ["state.name='new'",'state=structuredClone(state)',"sources.audioFile={name:'new'}","panel='text'"]) {
        const f=await fixture();
        f.open();
        vm.runInContext(change,f.context);
        const before=f.evaluate('state');
        f.apply({speaker:'0'});
        assert.deepEqual(f.evaluate('state'),before);
        assert.equal(f.evaluate('history.length'),0);
    }
});

test('detached openers and modal controls, IME and modified Enter are inert', async () => {
    const f=await fixture(), oldOpen=f.element('#assignSpeakerRange').onclick;
    vm.runInContext('renderPanel()',f.context);
    oldOpen();
    f.open({isComposing:true});
    assert.equal(f.evaluate('!!modal.open'),false);
    f.open();
    const oldConfirm=f.element('#confirmSpeakerRange').onclick;
    f.element('#cancelSpeakerRange').onclick();
    f.open();
    oldConfirm({});
    const input=f.element('#speakerRangeFirst');
    f.element('#speakerRangeValue').value='0';
    input.oncompositionstart();
    f.apply();
    input.oncompositionend();
    let prevented=0;
    for(const flags of [{isComposing:true},{keyCode:229},{ctrlKey:true},{altKey:true},{metaKey:true},{shiftKey:true}])
        input.onkeydown({key:'Enter',preventDefault(){prevented++;},...flags});
    assert.equal(prevented,0);
    assert.equal(typeof f.element('#speakerRangeValue').onkeydown,'undefined');
    assert.equal(f.evaluate('history.length'),0);
    input.onkeydown({key:'Enter',preventDefault(){prevented++;}});
    assert.equal(prevented,1);
    assert.equal(f.evaluate('history.length'),1);
    f.open();
    const stale=f.element('#confirmSpeakerRange').onclick;
    vm.runInContext("modalOpen('Other','content')",f.context);
    const focus=f.doc.activeElement;
    stale({});
    assert.equal(f.doc.activeElement,focus);
    assert.equal(f.evaluate('history.length'),1);
});

test('localized controls retain literal escaped labels and failed-valid edits remain memory-only', async () => {
    try {
        for(const locale of ['ko','en','zh-CN']) {
            const f=await fixture(), writes=[];
            f.context.localStorage.setItem=(...args)=>writes.push(args);
            setLocale(locale,{persist:false});
            vm.runInContext("state.speakerLabels=['<A>&原文',''];persistence.restorePhase='failed';persistence.recoveryValid=true",f.context);
            f.open();
            assert.match(f.element('#modal').innerHTML,/<option value="0">1 · &lt;A&gt;&amp;原文<\/option>/);
            assert.match(f.element('#modal').innerHTML,/<option value="1">2 · <\/option>/);
            const input=f.element('#speakerRangeFirst'),handler=input.onkeydown;
            input.value='2';
            setLocale(locale==='ko'?'en':'ko',{persist:false});
            assert.equal(input.onkeydown,handler);
            assert.equal(input.value,'2');
            f.apply({first:1,last:2,speaker:'0'});
            assert.equal(f.evaluate('history.length'),1);
            await vm.runInContext('saveProject(true);scheduleSave();undo()',f.context);
            await new Promise(resolve=>setTimeout(resolve,300));
            assert.equal(writes.length,0);
        }
    } finally {setLocale('ko',{persist:false});}
});

test('accepted assignment focuses the remounted action; empty and invalid-recovery editors cannot open', async () => {
    const f=await fixture(),root=f.element('#panelContent'),query=f.doc.querySelector;
    let markup=root.innerHTML,current=f.element('#assignSpeakerRange');
    const original=current;
    f.doc.querySelector=selector=>selector==='#assignSpeakerRange'?current:query(selector);
    Object.defineProperty(root,'innerHTML',{
        configurable:true,get:()=>markup,
        set:value=>{markup=value;current={focus(){f.doc.activeElement=this;}};}
    });
    f.open();
    f.apply({speaker:'0'});
    assert.notEqual(current,original);
    assert.equal(f.doc.activeElement,current);
    vm.runInContext("persistence.restorePhase='failed';persistence.recoveryValid=false",f.context);
    current.onclick();
    assert.equal(f.evaluate('!!modal.open'),false);
    vm.runInContext("persistence.restorePhase='ready';state.captions=[];renderPanel();",f.context);
    current.onclick();
    assert.equal(f.evaluate('!!modal.open'),false);
});

test('equal authored speaker names remain distinguishable by stable slot numbers', async () => {
    const f=await fixture();
    vm.runInContext("state.speakerLabels=['Same','Same']",f.context);
    f.open();
    assert.match(f.element('#modal').innerHTML,/<option value="0">1 · Same<\/option>/);
    assert.match(f.element('#modal').innerHTML,/<option value="1">2 · Same<\/option>/);
});
