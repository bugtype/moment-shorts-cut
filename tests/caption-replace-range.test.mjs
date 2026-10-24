import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {setLocale, initLocale, localize} from '../dist/i18n.mjs';

async function fixture(find = 'North', replacement = 'South') {
    const f = await createAppFixture();
    vm.runInContext("state.captions=Array.from({length:101},(_,i)=>({start:0,end:1,text:i<100?'North North':'North unrelated',speaker:'0',keywords:'North',timing:'estimated'}));history=[];current=2;switchPanel('captions')", f.context);
    for (const [id,value] of [['captionFind',find],['captionReplacement',replacement]]) {
        f.element('#'+id).value = value;
        f.element('#'+id).oninput();
    }
    f.open = () => f.element('#replaceCaptionRange').onclick();
    f.range = (first,last) => {
        f.element('#replaceRangeFirst').value = String(first);
        f.element('#replaceRangeLast').value = String(last);
        f.element('#replaceRangeLast').oninput();
    };
    f.confirm = () => f.element('#confirmReplaceRange').onclick();
    return f;
}

test('200 matches in authored rows1–100 change in one Undo without editing row101 or metadata', async () => {
    const f = await fixture(), before = f.evaluate('state');
    f.open(); f.range(1,100);
    assert.match(f.element('#replaceRangeSummary').textContent, /200.*100/);
    assert.equal(f.evaluate('history.length'), 0);
    f.confirm();
    const after = f.evaluate('state');
    assert.equal(after.captions[100].text, 'North unrelated');
    for (let i=0;i<100;i++) { assert.equal(after.captions[i].text, 'South South'); after.captions[i].text=before.captions[i].text; }
    assert.deepEqual(after,before);
    assert.equal(f.evaluate('history.length'),1);
    assert.equal(f.evaluate('current'),2);
    assert.equal(f.doc.activeElement,f.element('#replaceCaptionRange'));
    vm.runInContext('undo()',f.context); assert.deepEqual(f.evaluate('state'),before);
    vm.runInContext('undo(true)',f.context); assert.equal(f.evaluate('state.captions[0].text'),'South South');
});

test('default interval is current page first or selected match; search navigation stays global', async () => {
    const f = await fixture();
    f.element('#nextCaptionPage').onclick(); f.open();
    assert.equal(f.element('#replaceRangeFirst').value,'51');
    assert.equal(f.element('#replaceRangeLast').value,'51');
    f.element('#cancelReplaceRange').onclick();
    f.element('#nextCaptionMatch').onclick(); f.open();
    assert.equal(f.element('#replaceRangeFirst').value,'1');
});

test('literal multiline and dollar replacement apply only inside range; outside blank-result error does not block', async () => {
    const f = await fixture('\n',' $& ');
    vm.runInContext("state.captions=[{start:0,end:1,text:'A\\nB',basis:'timeline'},{start:1,end:2,text:'C\\nD'}];renderPanel()",f.context);
    f.open(); assert.equal(f.element('#rangeFind').value,'\n'); f.range(1,1); f.confirm();
    assert.equal(f.evaluate('state.captions[0].text'),'A $& B');
    assert.equal(f.evaluate('state.captions[1].text'),'C\nD');
    const g = await fixture('North','');
    vm.runInContext("state.captions[0].text='North kept';state.captions[1].text='North';renderPanel()",g.context);
    g.open(); g.confirm();
    assert.equal(g.evaluate('state.captions[0].text'),' kept');
    assert.equal(g.evaluate('state.captions[1].text'),'North');
});

test('same replacement, no matches, cancel and invalid interval never pause or create history', async () => {
    for (const mode of ['same','none','cancel','invalid']) {
        const f = await fixture(mode==='none'?'Missing':'North',mode==='same'?'North':'South');
        vm.runInContext('playing=true',f.context); f.open();
        if(mode==='invalid') f.range('',200);
        if(mode==='cancel') f.element('#cancelReplaceRange').onclick(); else f.confirm();
        assert.equal(f.evaluate('history.length'),0,mode);
        assert.equal(f.evaluate('playing'),true,mode);
    }
});

test('changed drafts/project/media, detached dialogs, IME and busy states cannot commit', async () => {
    for (const mutation of ["state.name='new'","sources.audioFile={}","panel='media'","loadingMedia=true","document.querySelector('#captionFind').value='new'"]) {
        const f = await fixture(); f.open(); vm.runInContext(mutation,f.context); f.confirm();
        assert.equal(f.evaluate('history.length'),0,mutation);
    }
    const f = await fixture(); f.open();
    f.element('#confirmReplaceRange').onclick({isComposing:true});
    assert.equal(f.evaluate('history.length'),0);
    const old=f.element('#confirmReplaceRange').onclick;
    vm.runInContext("modalOpen('Other','Other')",f.context); old();
    assert.equal(f.evaluate('history.length'),0);
    assert.match(f.element('#modal').innerHTML,/Other/);
});

test('three locales preserve literal drafts and failed-valid commits/undo make no storage writes', async () => {
    try {
        for(const [locale,label] of [['ko','범위 내 바꾸기'],['en','Replace in range'],['zh-CN','替换指定范围']]) {
            const f=await fixture(),writes=[];
            f.context.localStorage.setItem=(...args)=>writes.push(args);
            setLocale(locale,{persist:false});
            vm.runInContext("persistence.restorePhase='failed';persistence.recoveryValid=true",f.context);
            f.open(); assert.ok(f.element('#modal').innerHTML.includes(label)); f.confirm();
            assert.equal(f.evaluate('history.length'),1);
            await vm.runInContext('saveProject(true);scheduleSave();undo()',f.context);
            assert.deepEqual(writes,[]);
        }
    } finally {initLocale();}
});

test('detached opener is inert and successful commit focuses the newly mounted range action', async () => {
    const f = await fixture(), query = f.doc.querySelector.bind(f.doc);
    const root = f.element('#panelContent');
    let markup = root.innerHTML, current = f.element('#replaceCaptionRange'), serial = 0;
    const old = current.onclick;
    f.doc.querySelector = selector => selector === '#replaceCaptionRange' ? current : query(selector);
    Object.defineProperty(root, 'innerHTML', {
        configurable:true, get:()=>markup,
        set(value) { markup=value; current=f.element('#newRangeAction'+(++serial)); }
    });
    vm.runInContext('renderPanel()',f.context);
    old(); assert.equal(f.evaluate('!!modal.open'),false);
    current.onclick();
    const opener=current;
    f.confirm();
    assert.notEqual(current,opener);
    assert.equal(f.doc.activeElement,current);
    assert.equal(f.evaluate('history.length'),1);
});

test('range replacement preserves existing trim drafts', async () => {
    const f=await fixture();
    f.element('#trimStart').value='0.25';f.element('#trimEnd').value='10.75';
    f.open();f.confirm();
    assert.equal(f.element('#trimStart').value,'0.25');
    assert.equal(f.element('#trimEnd').value,'10.75');
});


test('unexpected preview failures remove old count translation markers before a locale switch', async () => {
    const f=await fixture();
    f.open();
    const summary=f.element('#replaceRangeSummary');
    assert.equal(summary.getAttribute('data-i18n'),'replaceRange.summary');
    // Deliberately invalid fixture data exercises the defensive generic-error path.
    vm.runInContext('state.captions[0].text=null',f.context);
    f.element('#replaceRangeLast').oninput();
    const error=summary.textContent;
    assert.ok(error.length>0);
    assert.equal(summary.getAttribute('data-i18n'),null);
    assert.equal(summary.getAttribute('data-i18n-params'),null);
    try {
        setLocale('en',{persist:false});
        localize({querySelectorAll:()=>[summary]});
        assert.equal(summary.textContent,error);
        assert.equal(f.evaluate('history.length'),0);
    } finally {initLocale();}
});
