import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { setLocale } from '../dist/i18n.mjs';

async function fixture() {
    const f=await createAppFixture();
    vm.runInContext(`state.style='highlight';state.globalKeywords='global, 강조';
        state.captions=[
            {start:0,end:1,text:'Keep text',basis:'source',speaker:'1',keywords:'word',timing:'estimated'},
            {start:1,end:2,text:'Absent',basis:'timeline'},
            {start:2,end:3,text:'Empty',keywords:''},
            {start:3,end:4,text:'Whitespace',keywords:' ,  '}
        ];textLayer='caption';current=2;history=[];switchPanel('text');renderInspector();`,f.context);
    f.open=event=>f.element('#panelContent').querySelector('#clearKeywordEmphasis').onclick(event||{});
    f.apply=event=>f.element('#confirmClearKeywords').onclick(event||{});
    return f;
}

test('confirmed reset clears only keyword fields in one undo and preserves highlight styling and trim drafts', async () => {
    const f=await fixture(),before=f.evaluate('state');
    vm.runInContext('playing=true',f.context);
    f.element('#trimStart').value='1.234';
    f.element('#trimEnd').value='11.5';
    f.open();
    f.apply();
    const expected=structuredClone(before);
    expected.globalKeywords='';expected.captions[0].keywords='';expected.captions[3].keywords='';
    assert.deepEqual(f.evaluate('state'),expected);
    assert.equal(f.evaluate('history.length'),1);
    assert.equal(f.evaluate('current'),2);
    assert.equal(f.evaluate('playing'),true);
    assert.equal(f.element('#trimStart').value,'1.234');
    assert.equal(f.element('#trimEnd').value,'11.5');
    assert.equal(f.doc.activeElement,f.element('#panelContent').querySelector('#clearKeywordEmphasis'));
    vm.runInContext('undo()',f.context);
    assert.deepEqual(f.evaluate('state'),before);
    vm.runInContext('undo(true)',f.context);
    assert.deepEqual(f.evaluate('state'),expected);
});

test('cancel and already-clear confirmation preserve playback, absent fields and uncommitted input drafts', async () => {
    const f=await fixture();
    vm.runInContext("state.globalKeywords='';state.captions.forEach(c=>{if(c.keywords)c.keywords='';});playing=true;",f.context);
    const input=f.element('#panelContent').querySelector('#globalKeywords');input.value='draft not entered';
    const before=f.evaluate('({state,history,current,playing})');
    f.open();f.element('#cancelClearKeywords').onclick();
    assert.deepEqual(f.evaluate('({state,history,current,playing})'),before);
    f.open();f.apply();
    assert.deepEqual(f.evaluate('({state,history,current,playing})'),before);
    assert.equal(input.value,'draft not entered');
    assert.equal(f.element('#toast').getAttribute('data-i18n'),'keywords.unchanged');
});

test('confirmation rejects changed project, contents, media or panel/layer', async () => {
    for(const change of ["state.name='changed'",'state=structuredClone(state)',"sources.audioFile={name:'new'}","panel='settings'","textLayer='title'"]) {
        const f=await fixture();f.open();vm.runInContext(change,f.context);
        const before=f.evaluate('state');f.apply();
        assert.deepEqual(f.evaluate('state'),before);
        assert.equal(f.evaluate('history.length'),0);
    }
});

test('stale/closed/replaced callbacks and composition are inert, while busy refusal permits owned retry', async () => {
    const f=await fixture(),oldOpen=f.element('#panelContent').querySelector('#clearKeywordEmphasis').onclick;
    vm.runInContext('renderPanel()',f.context);oldOpen();
    assert.equal(f.evaluate('!!modal.open'),false);
    f.open({isComposing:true});assert.equal(f.evaluate('!!modal.open'),false);
    f.open();const oldConfirm=f.element('#confirmClearKeywords').onclick;
    f.element('#cancelClearKeywords').onclick();f.open();oldConfirm();
    f.apply({keyCode:229});assert.equal(f.evaluate('history.length'),0);
    vm.runInContext('loadingMedia=true',f.context);f.apply();
    assert.equal(f.evaluate('history.length'),0);
    vm.runInContext('loadingMedia=false',f.context);f.apply();
    assert.equal(f.evaluate('history.length'),1);
    f.open();const replaced=f.element('#confirmClearKeywords').onclick;
    vm.runInContext("modalOpen('Other tool','content')",f.context);const focus=f.doc.activeElement;
    replaced();assert.equal(f.doc.activeElement,focus);
    assert.equal(f.evaluate('history.length'),1);
});

test('failed-valid reset and undo remain memory-only; all locale messages describe keywords, not all styling', async () => {
    try {
        for(const locale of ['ko','en','zh-CN']) {
            const f=await fixture(),writes=[];f.context.localStorage.setItem=(...args)=>writes.push(args);
            setLocale(locale,{persist:false});
            vm.runInContext("persistence.restorePhase='failed';persistence.recoveryValid=true",f.context);
            f.open();
            assert.ok(f.element('#modal').innerHTML.includes('data-i18n="keywords.confirm"'));
            f.apply();
            assert.equal(f.evaluate('state.style'),'highlight');
            assert.equal(f.evaluate('history.length'),1);
            await vm.runInContext('saveProject(true);scheduleSave();undo()',f.context);
            await new Promise(resolve=>setTimeout(resolve,300));
            assert.deepEqual(writes,[]);
        }
    } finally {setLocale('ko',{persist:false});}
});

test('successful reset restores focus to newly mounted control instead of detached opener', async () => {
    const f=await fixture(),root=f.element('#panelContent'),query=root.querySelector.bind(root);
    let current=query('#clearKeywordEmphasis'),markup=root.innerHTML;
    const original=current;
    root.querySelector=selector=>selector==='#clearKeywordEmphasis'?current:query(selector);
    Object.defineProperty(root,'innerHTML',{
        configurable:true,get:()=>markup,set:value=>{markup=value;current={focus(){f.doc.activeElement=this;}};}
    });
    f.open();f.apply();
    assert.notEqual(current,original);
    assert.equal(f.doc.activeElement,current);
});


test('metadata reset guards refuse both opening and confirmation during unavailable editor operations', async () => {
    const conditions = [
        'editorReady=false', 'exporting=true', 'transcribing=true',
        "Object.defineProperty(audioRecording,'requesting',{value:true})",
        "Object.defineProperty(audioRecording,'current',{value:{}})",
        "persistence.restorePhase='restoring'",
        "persistence.restorePhase='failed';persistence.recoveryValid=false"
    ];
    for (const condition of conditions) {
        const opening = await fixture();
        vm.runInContext(condition, opening.context);
        opening.open();
        assert.equal(opening.evaluate('!!modal.open'), false, condition);
        const confirming = await fixture();
        confirming.open();
        vm.runInContext(condition, confirming.context);
        const before = confirming.evaluate('({state,history,current,playing})');
        confirming.apply();
        assert.deepEqual(confirming.evaluate('({state,history,current,playing})'), before, condition);
        assert.equal(confirming.evaluate('!!modal.open'), true);
    }
});
