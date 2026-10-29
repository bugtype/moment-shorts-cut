import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { initLocale, setLocale } from '../dist/i18n.mjs';

async function fixture({ mockPaint = true } = {}) {
    const f = await createAppFixture();
    const surfaces = [], paints = [], downloads = [];
    f.doc.fonts.status = 'loaded';
    f.context.paints = paints;
    f.context.downloads = downloads;
    vm.runInContext(`sample.complete=true;sampleRaster={width:540,height:960};video.paused=audio.paused=true;
        video.pause=()=>{video.paused=true;};audio.pause=()=>{audio.paused=true;};
        panel='settings'; renderPanel();

        app.download=(blob,name)=>downloads.push({blob,name});`, f.context);
    if (mockPaint) vm.runInContext('app.playback.paint=(context,width,height)=>paints.push({context,width,height,current})', f.context);
    f.doc.createElement = () => {
        const surface = { getContext: () => ({}), toBlob(callback) { surface.callback = callback; } };
        surfaces.push(surface);
        return surface;
    };
    return { ...f, surfaces, paints, downloads,
        open: () => f.element('#openScenePng').onclick(),
        save: () => f.element('#saveScenePng').onclick(),
    };
}
const png = () => new Blob(['PNG'], { type: 'image/png' });

test('explicit save captures confirmation clock, pauses once and leaves preview/project/history unchanged', async () => {
    const f = await fixture();
    vm.runInContext('playing=true;current=2', f.context);
    const before = f.evaluate('({state,history:history.length,width:canvas.width,height:canvas.height})');
    f.open();
    assert.equal(f.evaluate('playing'), true);
    vm.runInContext('current=3', f.context);
    f.save();
    assert.equal(f.evaluate('playing'), false);
    assert.equal(f.evaluate('!!modal.open'), false);
    assert.equal(f.paints[0].current, 3);
    assert.deepEqual([f.surfaces[0].width, f.surfaces[0].height], [1080, 1920]);
    f.surfaces[0].callback(png());
    assert.match(f.downloads[0].name, /\.scene-1080x1920\.png$/);
    assert.deepEqual(f.evaluate('({state,history:history.length,width:canvas.width,height:canvas.height})'), before);
    assert.equal(f.surfaces[0].width, 0);
});

test('all aspect ratios offer exact720/1080 dimensions and selector Enter remains native', async () => {
    for (const [ratio, expected] of [['9:16',[720,1280]], ['4:5',[720,900]], ['1:1',[720,720]], ['16:9',[1280,720]]]) {
        const f = await fixture();
        vm.runInContext(`state.ratio='${ratio}';renderPanel()`, f.context);
        f.open();
        const select = f.element('#scenePngQuality');
        assert.equal(select.value, '1080');
        assert.equal(typeof select.onkeydown, 'undefined');
        assert.match(f.element('#modal').innerHTML, new RegExp(`${expected[0]} × ${expected[1]}`));
        select.value = '720';
        f.save();
        assert.deepEqual([f.surfaces[0].width, f.surfaces[0].height], expected);
    }
});

test('cancel, IME and old modal callbacks do not pause or render; project changes require reopen', async () => {
    const f = await fixture();
    vm.runInContext('playing=true', f.context);
    f.element('#openScenePng').onclick({ isComposing: true });
    assert.equal(f.evaluate('!!modal.open'), false);
    f.open();
    f.element('#saveScenePng').onclick({ keyCode: 229 });
    assert.equal(f.surfaces.length, 0);
    const old = f.element('#saveScenePng').onclick;
    f.element('#cancelScenePng').onclick();
    assert.equal(f.evaluate('playing'), true);
    old();
    assert.equal(f.surfaces.length, 0);
    f.open();
    vm.runInContext("state.name='Changed'", f.context);
    f.save();
    assert.equal(f.surfaces.length, 0);
    assert.equal(f.evaluate('playing'), true);
});

test('busy and unloaded fonts keep dialog retryable; stale encoder does not download', async () => {
    const f = await fixture();
    f.open();
    vm.runInContext('loadingMedia=true', f.context);
    f.save();
    assert.equal(f.evaluate('!!modal.open'), true);
    vm.runInContext('loadingMedia=false', f.context);
    f.doc.fonts.status = 'loading';
    f.save();
    assert.equal(f.surfaces.length, 0);
    assert.equal(f.evaluate('!!modal.open'), true);
    f.doc.fonts.status = 'loaded';
    f.save();
    vm.runInContext('current+=1', f.context);
    f.surfaces[0].callback(png());
    assert.equal(f.downloads.length, 0);
    assert.equal(f.surfaces[0].height, 0);
});

test('three localized dialogs retain exact numeric choices and default quality', async () => {
    try {
        for (const [locale,label] of [['ko','일시 정지하고 PNG 저장'],['en','Pause and save PNG'],['zh-CN','暂停并保存 PNG']]) {
            const f = await fixture();
            setLocale(locale, { persist: false });
            f.open();
            assert.match(f.element('#modal').innerHTML, new RegExp(label));
            assert.equal(f.element('#scenePngQuality').value, '1080');
        }
    } finally { initLocale(); }
});

test('replaced dialogs and detached panel openers cannot take ownership; failed encode permits a fresh request', async () => {
    const f = await fixture();
    const opener = f.element('#openScenePng').onclick;
    vm.runInContext('renderPanel()', f.context);
    opener();
    assert.equal(f.evaluate('!!modal.open'), false);
    f.open();
    const oldSave = f.element('#saveScenePng').onclick;
    const oldCancel = f.element('#cancelScenePng').onclick;
    vm.runInContext("modalOpen('Other','Body','')", f.context);
    oldSave(); oldCancel();
    assert.equal(f.evaluate('!!modal.open'), true);
    assert.match(f.element('#modal').innerHTML, /Other/);
    assert.equal(f.surfaces.length, 0);
    vm.runInContext('modal.close()', f.context);
    f.open(); f.save();
    f.surfaces[0].callback(null);
    assert.equal(f.downloads.length, 0);
    f.open(); f.save();
    f.surfaces[1].callback(png());
    assert.equal(f.downloads.length, 1);
});

test('successful PNG creates no project storage writes and preserves explicit preview capture path', async () => {
    const f = await fixture(), writes = [];
    f.context.writes = writes;
    vm.runInContext('localStorage.setItem=(...args)=>writes.push(args)', f.context);
    const before = f.evaluate('({state,current,history:history.length})');
    f.open(); f.save(); f.surfaces[0].callback(png());
    assert.deepEqual(writes, []);
    assert.deepEqual(f.evaluate('({state,current,history:history.length})'), before);
    const preview = f.element('#preview');
    let copied;
    f.doc.createElement = () => ({ getContext: () => ({ drawImage: source => { copied = source; } }), toBlob() {} });
    f.element('#savePreviewPng').onclick();
    assert.equal(copied, preview);
    assert.equal(f.paints.length, 1);
});

test('real playback paint and compositor draw raw video at output dimensions without resizing preview', async () => {
    const f = await fixture({ mockPaint: false }), draws = [], fills = [];
    const context = new Proxy({}, { get(target, key) {
        if (key in target) return target[key];
        if (key === 'drawImage') return (...args) => draws.push(args);
        if (key === 'fillRect') return (...args) => fills.push(args);
        if (key === 'measureText') return text => ({ width: text.length * 10 });
        if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => ({ addColorStop() {} });
        return () => {};
    }});
    f.doc.createElement = () => {
        const surface = { getContext: () => context, toBlob(callback) { surface.callback = callback; } };
        f.surfaces.push(surface);
        return surface;
    };
    vm.runInContext("state.kind='video';state.fileName='original.mp4';state.ratio='4:5';renderPanel()", f.context);
    const dimensions = f.evaluate('[canvas.width,canvas.height]');
    f.open(); f.save();
    assert.ok(draws.some(args => args[0] === f.element('#sourceVideo')));
    assert.ok(fills.some(args => args[2] === 1080 && args[3] === 1350));
    assert.deepEqual(f.evaluate('[canvas.width,canvas.height]'), dimensions);
    f.surfaces[0].callback(png());
    assert.equal(f.downloads.length, 1);
});

test('verified session-only demo recovery permits output PNG without unlocking storage', async () => {
    const f = await fixture(), writes = [];
    f.context.writes = writes;
    vm.runInContext(`persistence.restorePhase='failed';persistence.recoveryValid=true;
        localStorage.setItem=(...args)=>writes.push(args);
        projectStore.setMedia=(...args)=>writes.push(args);`, f.context);
    const result = await vm.runInContext('sessionMedia.connect({}, {confirmed:true})', f.context);
    assert.equal(result.ok, true);
    f.open(); f.save(); f.surfaces[0].callback(png());
    assert.equal(f.downloads.length, 1);
    assert.equal(f.evaluate('persistence.restorePhase'), 'failed');
    assert.deepEqual(writes, []);
});

test('explicit PNG pause cancels pending Play ownership before delayed audio preparation resolves', async () => {
    const f = await fixture();
    let resolveAudio;
    f.context.audioReady = new Promise(resolve => { resolveAudio = resolve; });
    vm.runInContext('app.ensureAudio=()=>audioReady', f.context);
    const pendingPlay = vm.runInContext('play()', f.context);
    assert.equal(f.evaluate('playing'), false);
    f.open(); f.save();
    const pausedOwner = f.evaluate('playRequest');
    resolveAudio();
    await pendingPlay;
    assert.equal(f.evaluate('playing'), false);
    assert.equal(f.evaluate('playRequest'), pausedOwner);
    f.surfaces[0].callback(png());
    assert.equal(f.downloads.length, 1);
    assert.equal(f.evaluate('frameHandle'), 0);
});
