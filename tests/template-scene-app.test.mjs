import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { applyTemplate, TEMPLATES } from '../dist/template-catalog.mjs';
import { setLocale, initLocale } from '../dist/i18n.mjs';

async function fixture() {
    const f = await createAppFixture();
    f.context.draws = [];
    vm.runInContext('state=initial();current=2;selected=0;sample.complete=true;composition.draw=(...args)=>draws.push(args);',f.context);
    f.open = () => vm.runInContext('pause();templatePreview.open(TEMPLATES[1]);',f.context);
    f.current = () => { f.element('#templatePreviewMode').value='current'; f.element('#templatePreviewMode').onchange({}); };
    return f;
}

test('current scene compares detached styles on the same bounded raw source frame and exact output clock', async () => {
    const f = await fixture();
    vm.runInContext("state.kind='video';state.ratio='16:9';state.speed=4;state.clips=[{start:5,end:9},{start:5,end:9}];current=5;selected=1;video.videoWidth=7680;video.videoHeight=4320;",f.context);
    const before=f.evaluate('state'), history=f.evaluate('history'), clock=f.evaluate('current');
    f.open();f.current();
    const styled=f.context.draws.at(-1), expected=structuredClone(before);applyTemplate(expected,TEMPLATES[1],false);
    assert.deepEqual(JSON.parse(JSON.stringify(styled[3])),expected);
    assert.equal(styled[4].sourceTime,6);assert.equal(styled[4].time,1.25);assert.equal(styled[4].total,2);
    assert.equal(styled[4].sw,1920);assert.equal(styled[4].sh,1080);
    assert.notEqual(styled[4].source,f.element('#video'));
    f.element('#templateCurrentStyle').onclick({});const baseline=f.context.draws.at(-1);
    assert.deepEqual(JSON.parse(JSON.stringify(baseline[3])),before);assert.equal(baseline[4].source,styled[4].source);
    assert.deepEqual([styled[1],styled[2]],[432,243]);
    assert.deepEqual(f.evaluate('state'),before);assert.deepEqual(f.evaluate('history'),history);assert.equal(f.evaluate('current'),clock);
    f.element('#modal').open=false;f.element('#modal').onclose();assert.equal(styled[4].source.width,0);
});

test('sample remains available when current capture is unready; stale, busy and IME actions do not apply', async () => {
    for(const change of ["state.name='changed'","current=3","selected=1","sources.audioFile={name:'new'}","video.src='new'","loadingMedia=true"]){
        const f=await fixture();f.open();const before=f.evaluate('history');
        vm.runInContext(change,f.context);const project=f.evaluate('state');f.current();
        assert.match(f.element('#templateSceneStatus').textContent,/변경|불러올/);
        f.element('#applyTemplateStyle').onclick({});assert.deepEqual(f.evaluate('state'),project);assert.deepEqual(f.evaluate('history'),before);
    }
    const f=await fixture();vm.runInContext("state.kind='video';video.seeking=true;",f.context);f.open();
    const count=f.context.draws.length;f.current();assert.equal(f.context.draws.length,count);
    f.element('#templatePreviewMode').value='sample';f.element('#templatePreviewMode').onchange({});assert.equal(f.context.draws.length,count+1);
    f.element('#applyTemplateStyle').onclick({isComposing:true});assert.equal(f.evaluate('history.length'),0);
});

test('replacement and retained RAF callbacks cannot repaint or apply into the new template dialog', async () => {
    const f=await fixture();f.open();
    const oldApply=f.element('#applyTemplateStyle').onclick;
    f.element('#toggleTemplateDemo').onclick({});const callbacks=[...f.pendingFrames.values()];
    f.open();const count=f.context.draws.length;
    for(const callback of callbacks)callback(500);
    assert.equal(f.context.draws.length,count);oldApply({});assert.equal(f.evaluate('history.length'),0);
    f.current();f.element('#applyTemplateStyle').onclick({});assert.equal(f.evaluate('history.length'),1);
});

test('all three locales expose current comparison labels without translating authored content', async () => {
    const expected={ko:'현재 장면',en:'Current scene','zh-CN':'当前场景'};
    try { for(const locale of Object.keys(expected)){
        const f=await fixture();setLocale(locale);f.open();assert.ok(f.element('#modal').innerHTML.includes(expected[locale]));
        f.current();assert.deepEqual(f.evaluate('state.captions'),JSON.parse(JSON.stringify(f.context.draws.at(-1)[3].captions)));
    }}finally{initLocale();}
});

test('raw-frame copy failure preserves demo and closing/reopening disposes the captured frame', async()=>{
    const f=await fixture(), create=f.doc.createElement, failedFrames=[];
    f.doc.createElement=tag=>{const node=create(tag);if(tag==='canvas'){failedFrames.push(node);node.getContext=()=>({drawImage(){throw new Error('copy failed');}});}return node;};
    f.open();f.current();assert.match(f.element('#templateSceneStatus').textContent,/불러올/);
    assert.equal(failedFrames.length,1);assert.equal(failedFrames[0].width,0);assert.equal(failedFrames[0].height,0);
    f.element('#templatePreviewMode').value='sample';f.element('#templatePreviewMode').onchange({});
    f.doc.createElement=create;f.open();f.current();const snapshot=f.context.draws.at(-1)[4].source;
    const oldCompare=f.element('#templateCurrentStyle').onclick;
    vm.runInContext("modalOpen('Other','Other','');",f.context);assert.equal(snapshot.width,0);
    const count=f.context.draws.length;oldCompare({});assert.equal(f.context.draws.length,count);
    f.open();f.current();const replacement=f.context.draws.at(-1)[4].source;
    f.element('#modal').onclose();assert.ok(replacement.width>0,'queued old close does not dispose open replacement');
});

test('failed-invalid and restoring metadata never apply a template',async()=>{
    for(const phase of ['failed','restoring']){
        const f=await fixture();vm.runInContext(`persistence.restorePhase='${phase}';persistence.recoveryValid=false;`,f.context);
        f.open();const before=f.evaluate('state');f.element('#applyTemplateStyle').onclick({});
        assert.deepEqual(f.evaluate('state'),before);assert.equal(f.evaluate('history.length'),0);
    }
});
