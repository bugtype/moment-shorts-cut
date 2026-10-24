import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { projectSubtitles } from '../dist/core/project.mjs';
import { setLocale, t } from '../dist/i18n.mjs';
import { messages } from '../dist/i18n/catalogs/review.mjs';

async function fixture() {
    const f = await createAppFixture(), downloads = [];
    f.context.collectReview = (blob, name) => downloads.push({blob,name});
    vm.runInContext(`download=(blob,name)=>collectReview(blob,name);
        state.name='review project';state.speed=2;
        state.clips=[{start:2,end:4},{start:0,end:2},{start:2,end:4}];
        state.speakerLabels=['  원문 Alice  ',''];
        state.captions=[{start:2,end:3,text:'  原文 <b>A</b>\\r\\nsecond  ',speaker:'0',basis:'source'},
            {start:0,end:1,text:'timeline 文本',speaker:'1',basis:'timeline'}];
        current=1;history=[];future=[];switchPanel('captions');playing=true;`,f.context);
    f.choose = value => {
        f.element('#captionExportFormat').value=value;
        f.element('#captionExportFormat').onchange();
    };
    f.download = () => f.element('#downloadCaptions').onclick();
    f.downloads=downloads;
    return f;
}

test('Review TXT downloads output-clock occurrences and authored speakers without editing or storage', async () => {
    const f=await fixture(),writes=[];
    f.context.localStorage.setItem=(...args)=>writes.push(args);
    const before=f.evaluate('({state,history,future,current,playing})');
    f.choose('review-txt');
    f.download();
    assert.equal(f.downloads.length,1);
    const {blob,name}=f.downloads[0],body=await blob.text();
    assert.equal(name,'review project.review.txt');
    assert.equal(blob.type,'text/plain;charset=utf-8');
    assert.notEqual(new Uint8Array(await blob.arrayBuffer())[0],0xef);
    assert.ok(body.includes(t('review.heading')));
    assert.ok(body.includes(t('review.time',{start:'0',end:'0.5'})));
    assert.ok(body.includes(t('review.time',{start:'2',end:'2.5'})));
    assert.equal(body.split('  原文 <b>A</b>\nsecond  ').length-1,2);
    assert.equal(body.split(t('review.speaker',{name:'  원문 Alice  '})).length-1,2);
    assert.ok(body.includes('timeline 文本'));
    assert.ok(!body.includes('\r'));
    assert.ok(!body.includes('review project'));
    assert.deepEqual(f.evaluate('({state,history,future,current,playing})'),before);
    assert.deepEqual(writes,[]);
    f.choose('txt');
    f.download();
    assert.equal(await f.downloads[1].blob.text(),projectSubtitles(before.state,{format:'txt'}));
    assert.equal(f.downloads[1].name,'review project.txt');
});

test('review dropdown is localized and selection survives panel refresh without changing default TXT', async () => {
    const f=await fixture();
    try {
        f.choose('review-txt');
        for(const locale of ['ko','en','zh-CN']) {
            setLocale(locale,{persist:false});
            vm.runInContext('renderPanel()',f.context);
            assert.equal(f.element('#captionExportFormat').value,'review-txt');
            assert.ok(f.element('#panelContent').innerHTML.includes(messages[locale]['review.option']));
            f.download();
            const body=await f.downloads.at(-1).blob.text();
            assert.ok(body.includes(messages[locale]['review.heading']));
            assert.ok(body.includes('  원문 Alice  '));
        }
    } finally {setLocale('ko',{persist:false});}
});

test('review skips no-occurrence output and rejects used NUL text or labels without downloading', async () => {
    const f=await fixture();
    f.choose('review-txt');
    vm.runInContext("state.speakerLabels[1]='unused\\0name';state.captions[1].speaker='';",f.context);
    f.download();
    assert.equal(f.downloads.length,1,'unused NUL label is not exported');
    vm.runInContext("state.speakerLabels[0]='used\\0name';",f.context);
    f.download();
    assert.equal(f.downloads.length,1);
    assert.equal(f.element('#toast').getAttribute('data-i18n'),'review.nul');
    vm.runInContext("state.speakerLabels[0]='fixed';state.captions[0].text='bad\\0text';",f.context);
    f.download();
    assert.equal(f.downloads.length,1);
    vm.runInContext("state.captions[0].text='fixed';",f.context);
    f.download();
    assert.equal(f.downloads.length,2);
    vm.runInContext('state.captions=[];',f.context);
    f.download();
    assert.equal(f.downloads.length,2);
    assert.equal(f.element('#toast').getAttribute('data-i18n'),'errors.noCaptionsSave');
});

test('review download failure can retry and failed-valid read-only export never unlocks persistence', async () => {
    const f=await fixture(),writes=[];
    f.context.localStorage.setItem=(...args)=>writes.push(args);
    f.choose('review-txt');
    vm.runInContext("persistence.restorePhase='failed';persistence.recoveryValid=true;",f.context);
    const before=f.evaluate('({state,history,current,playing})');
    const collect=f.context.collectReview;
    f.context.collectReview=()=>{throw new Error();};
    f.download();
    assert.equal(f.downloads.length,0);
    assert.equal(f.element('#toast').getAttribute('data-i18n'),'errors.captionSave');
    f.context.collectReview=collect;
    f.download();
    assert.equal(f.downloads.length,1);
    vm.runInContext('persistence.recoveryValid=false;',f.context);
    f.download();
    assert.equal(f.downloads.length,1);
    assert.deepEqual(f.evaluate('({state,history,current,playing})'),before);
    assert.deepEqual(writes,[]);
});

test('review catalog has identical keys and named parameters in all languages', () => {
    const keys=Object.keys(messages.ko).sort();
    for(const locale of ['en','zh-CN']) {
        assert.deepEqual(Object.keys(messages[locale]).sort(),keys);
        for(const key of keys) assert.deepEqual(messages[locale][key].match(/\{\w+\}/g)||[],messages.ko[key].match(/\{\w+\}/g)||[]);
    }
});
