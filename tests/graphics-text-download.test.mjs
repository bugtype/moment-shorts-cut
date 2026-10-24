import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { projectGraphicsText } from '../dist/core/graphics-text.mjs';
import { setLocale, initLocale } from '../dist/i18n.mjs';

async function fixture() {
    const f = await createAppFixture();
    const downloads = [];
    f.context.collectGraphics = (blob, name) => downloads.push({blob,name});
    vm.runInContext(`
        download=(blob,name)=>collectGraphics(blob,name);
        state.name='문구 review';
        state.design.title.enabled=false;state.design.title.start=100;
        state.design.title.lines=['  원문 🎬 <b>Title</b>  ','Second\\r\\nline'];
        state.design.credit.text='출처 & Credit';
        state.overlays=[{...newCard(12),id:'graphic',enabled:false,start:90,end:99,
            label:'라벨',text:'文本',detail:'line one\\nline two'}];
        current=2;history=[];future=[];playing=true;
    `,f.context);
    f.open = () => f.element('#projectFilesButton').onclick();
    f.exportText = event => f.element('#downloadGraphicsTextButton').onclick(event || {});
    f.downloads = downloads;
    return f;
}

test('Project files exports exact current saved graphics text without editing, seeking or storage writes', async () => {
    const f = await fixture(), writes = [];
    f.context.localStorage.setItem = (...args) => writes.push(args);
    const before = f.evaluate('({state,history,future,current,playing})');
    f.open();
    const markup = f.element('#modal').innerHTML;
    assert.match(markup,/id="downloadGraphicsTextButton"/);
    assert.ok(markup.indexOf('downloadGraphicsTextButton') < markup.indexOf('modal-foot'));
    f.exportText();
    assert.equal(f.downloads.length,1);
    const {blob,name} = f.downloads[0];
    assert.equal(name,'문구 review.graphics.txt');
    assert.equal(blob.type,'text/plain;charset=utf-8');
    assert.equal(await blob.text(),projectGraphicsText(before.state));
    assert.ok((await blob.text()).includes('  원문 🎬 <b>Title</b>  '));
    assert.ok((await blob.text()).includes('Second\r\nline'));
    assert.ok((await blob.text()).includes('line one\nline two'));
    assert.notDeepEqual([...new Uint8Array(await blob.arrayBuffer()).slice(0,3)],[239,187,191]);
    assert.deepEqual(f.evaluate('({state,history,future,current,playing})'),before);
    assert.deepEqual(writes,[]);
    assert.equal(f.element('#modal').open,true);

    vm.runInContext("state.name='latest';state.design.title.lines[0]='latest text'",f.context);
    f.exportText();
    assert.equal(f.downloads[1].name,'latest.graphics.txt');
    assert.ok((await f.downloads[1].blob.text()).includes('latest text'));
    assert.equal(f.evaluate('history.length'),0);
});

test('replaced/closed modal callbacks and busy or composing actions cannot download', async () => {
    const f = await fixture();
    f.open();
    const old = f.element('#downloadGraphicsTextButton').onclick;
    f.element('#modal').close();
    old({});
    assert.equal(f.downloads.length,0);
    f.open();
    old({});
    assert.equal(f.downloads.length,0);
    for (const event of [{isComposing:true},{keyCode:229}]) f.exportText(event);
    vm.runInContext('exporting=true',f.context);
    f.exportText();
    assert.equal(f.downloads.length,0);
    vm.runInContext('exporting=false;editorReady=false',f.context);
    f.exportText();
    assert.equal(f.downloads.length,0);
    vm.runInContext('editorReady=true',f.context);
    f.exportText();
    assert.equal(f.downloads.length,1);
    const stale = f.element('#downloadGraphicsTextButton').onclick;
    vm.runInContext("modalOpen('other','new modal')",f.context);
    stale({});
    assert.equal(f.downloads.length,1);
    f.element('#helpButton').onclick();
    assert.doesNotMatch(f.element('#modal').innerHTML,/id="downloadGraphicsTextButton"/);
});

test('failed-valid settings remain readable without media while restoring/invalid recovery refuse files', async () => {
    for (const [phase,valid,allowed] of [['failed',true,true],['failed',false,false],['restoring',true,false]]) {
        const f = await fixture(), writes = [];
        f.context.localStorage.setItem = (...args) => writes.push(args);
        vm.runInContext(`persistence.restorePhase='${phase}';persistence.recoveryValid=${valid};sources.videoFile=null;sources.audioFile=null;`,f.context);
        const before = f.evaluate('state');
        f.open();
        f.exportText();
        assert.equal(f.downloads.length,allowed?1:0);
        assert.deepEqual(f.evaluate('state'),before);
        assert.equal(f.evaluate('history.length'),0);
        assert.deepEqual(writes,[]);
    }
});

test('invalid report text and download failures produce no partial output and can retry', async () => {
    const f = await fixture();
    f.open();
    vm.runInContext("state.design.title.lines[0]='bad\\0text'",f.context);
    const before = f.evaluate('state');
    f.exportText();
    assert.equal(f.downloads.length,0);
    assert.deepEqual(f.evaluate('state'),before);
    assert.ok(f.element('#toast').textContent.length>0);
    vm.runInContext("state.design.title.lines[0]='fixed';download=()=>{throw Error('private internal failure')}",f.context);
    f.exportText();
    assert.equal(f.downloads.length,0);
    assert.equal(f.element('#toast').textContent,'그래픽 문구를 저장하지 못했습니다. 다시 시도해 주세요.');
    vm.runInContext('download=(blob,name)=>collectGraphics(blob,name)',f.context);
    f.exportText();
    assert.equal(f.downloads.length,1);
    assert.ok((await f.downloads[0].blob.text()).includes('fixed'));
    assert.equal(f.evaluate('history.length'),0);
});

test('locale metadata changes on repeated downloads but authored strings stay literal', async () => {
    try {
        const f = await fixture();
        for (const [locale,label,heading] of [
            ['ko','그래픽 문구 (.txt)','그래픽 문구 검토'],
            ['en','Graphics text (.txt)','Graphics text review'],
            ['zh-CN','图形文字 (.txt)','图形文字审阅'],
        ]) {
            setLocale(locale,{persist:false});
            f.open();
            assert.ok(f.element('#modal').innerHTML.includes(label));
            f.exportText();
            const text = await f.downloads.at(-1).blob.text();
            assert.ok(text.startsWith(heading));
            for (const literal of ['  원문 🎬 <b>Title</b>  ','출처 & Credit','라벨','文本','line one\nline two']) {
                assert.ok(text.includes(literal));
            }
        }
    } finally { initLocale(); }
});
