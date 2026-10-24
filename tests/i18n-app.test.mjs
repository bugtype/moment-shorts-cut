import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';

test('language switching preserves project/history, drafts, selection and ongoing jobs',async()=>{
    const f=await createAppFixture();
    vm.runInContext("history=['before'];future=['redo'];current=2;selected=0;globalThis.saves=0;scheduleSave=()=>saves++;loadingMedia=true;transcribing=true;exporting=true;",f.context);
    const draft=f.element('#projectName');draft.value='Uncommitted 日本語';draft.setSelectionRange(3,7);draft.focus();
    const before=f.evaluate('({state,history,future,current,selected,playing,loadingMedia,transcribing,exporting,playRequest})');
    const modal=f.element('#modal');modal.open=true;const callback=()=>{};modal.onclose=callback;
    f.element('#uiLocale').value='en';f.element('#uiLocale').onchange({target:f.element('#uiLocale')});
    assert.equal(f.doc.documentElement.lang,'en');assert.equal(draft.value,'Uncommitted 日本語');
    assert.equal(draft.selectionStart,3);assert.equal(draft.selectionEnd,7);assert.equal(f.doc.activeElement,draft);
    assert.equal(modal.open,true);assert.equal(modal.onclose,callback);
    assert.deepEqual(f.evaluate('({state,history,future,current,selected,playing,loadingMedia,transcribing,exporting,playRequest})'),before);
    assert.equal(f.evaluate('saves'),0);
    f.element('#uiLocale').value='zh-CN';f.element('#uiLocale').onchange({target:f.element('#uiLocale')});
    assert.equal(f.doc.documentElement.lang,'zh-CN');assert.deepEqual(f.evaluate('state'),before.state);
    vm.runInContext("setLocale('ko');",f.context);
});

test('dynamic time accessibility, toast and save-status descriptors change in place',async()=>{
    const f=await createAppFixture();
    vm.runInContext("current=2;updateTime();toast(message('shell.clip',{index:4}));saveStatus(message('shell.savedHere'));",f.context);
    const time=f.element('#timeDisplay'),before=time.innerHTML;
    vm.runInContext("setLocale('en');",f.context);
    assert.match(time.getAttribute('aria-label'),/Go to output time, 00:02 \/ 00:12/);
    assert.equal(time.innerHTML,before);
    assert.equal(f.element('#toast').textContent,'Clip 4');assert.equal(f.element('#saveStatusText').textContent,'Stored in this browser');
    vm.runInContext("setLocale('zh-CN');",f.context);
    assert.match(time.getAttribute('aria-label'),/跳转到输出时间/);
    assert.equal(f.element('#toast').textContent,'片段 4');
    vm.runInContext("toast('User-authored diagnostic');setLocale('ko');",f.context);
    assert.equal(f.element('#toast').textContent,'User-authored diagnostic');
});

test('open seek dialog retains control ownership when language changes; cancel stays non-mutating',async()=>{
    const f=await createAppFixture();
    f.element('#timeDisplay').onclick();
    const input=f.element('#outputSeekTime'),button=f.element('#confirmOutputSeek');
    input.value='01:02.5';input.setSelectionRange(2,4);input.focus();
    const submit=button.onclick,close=f.element('#modal').onclose,before=f.evaluate('({state,history,future,current})');
    vm.runInContext("setLocale('en');",f.context);
    assert.equal(button.onclick,submit);assert.equal(f.element('#modal').onclose,close);
    assert.equal(input.value,'01:02.5');assert.equal(input.selectionStart,2);assert.equal(f.doc.activeElement,input);
    f.element('#cancelOutputSeek').onclick();
    assert.equal(f.element('#modal').open,false);
    assert.deepEqual(f.evaluate('({state,history,future,current})'),before);
    vm.runInContext("setLocale('ko');",f.context);
});

test('shell labels are marked without changing authored defaults or recognition language',()=>{
    const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
    assert.match(html,/id="uiLocale"/);assert.match(html,/<option value="zh-CN">简体中文<\/option>/);
    assert.match(html,/data-i18n-content="shell.description"/);
    assert.match(html,/value="나의 첫 번째 쇼츠"/,'Existing sample project text remains content');
    const app=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
    assert.match(app,/try \{ preferenceStorage = localStorage; \} catch/);
    assert.doesNotMatch(app,/setUiLocale:[^\n]*(?:state\.|scheduleSave|renderPanel)/);
    const shellFiles=['seek-dialog.mjs','caption-inspection-dialog.mjs','export-flow.mjs','editing-actions.mjs','playback.mjs','timeline-view.mjs','app-bindings.mjs'];
    for(const file of shellFiles){
        const source=fs.readFileSync(new URL('../dist/'+file,import.meta.url),'utf8');
        assert.doesNotMatch(source,/[가-힣]/,file+' must use catalog copy');
    }
});
