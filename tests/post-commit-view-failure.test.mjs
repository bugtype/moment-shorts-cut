import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { createProjectDocument } from '../dist/core/project.mjs';
import { newCard } from '../dist/effects.mjs';
import { translateFor } from '../dist/i18n.mjs';

const args = { captionIndex: 0, caption: { start: 0, end: 1, text: 'Applied exactly once' } };
async function fixture(locale = 'ko') {
    const f = await createAppFixture();
    vm.runInContext(`state=initial(); history=[]; future=[]; current=0; selected=0;
        timelineCache=null; panel='captions'; renderPanel(); composition.clear();
        setLocale(${JSON.stringify(locale)}, {persist:false});`, f.context);
    const timers = new Map(), writes = []; let timer = 0;
    f.context.setTimeout = (callback, delay) => { timers.set(++timer, { callback, delay }); return timer; };
    f.context.clearTimeout = id => timers.delete(id);
    f.context.localStorage.setItem = (key, value) => writes.push({ key, value });
    return Object.assign(f, { timers, writes });
}
function unavailableNextCanvas(f) {
    const create = f.doc.createElement; let delivered = false;
    f.doc.createElement = tag => {
        const node = create(tag);
        if (tag === 'canvas' && !delivered) { delivered = true; node.getContext = () => null; }
        return node;
    };
    return () => delivered;
}
function storedProject(f) {
    const saved = f.writes.filter(write => write.key === 'moment-state-v1');
    assert.equal(saved.length, 1);
    return JSON.parse(saved[0].value);
}
async function flushSave(f) {
    const saves = [...f.timers.values()].filter(timer => timer.delay === 500);
    assert.equal(saves.length, 1, 'the guarded autosave remains scheduled');
    await saves[0].callback();
}

for (const locale of ['ko', 'en', 'zh-CN']) {
    test(`${locale}: actual Canvas failure after commit still acknowledges one inserted cue`, async () => {
        const f = await fixture(locale), before = f.evaluate('state'), delivered = unavailableNextCanvas(f);
        const result = await f.context.window.moment.execute('captions.insert', args);
        assert.equal(delivered(), true, 'actual typography allocation reached the unavailable context');
        assert.equal(result.ok, true);
        assert.equal(result.data.totalCaptions, before.captions.length + 1);
        assert.equal(f.evaluate('history.length'), 1);
        const applied = f.evaluate('state');
        assert.deepEqual(applied.captions[0], args.caption);
        assert.deepEqual(applied.captions.slice(1), before.captions);
        assert.equal(f.evaluate('playing'), false);
        const toast = f.element('#toast');
        assert.equal(toast.getAttribute('data-i18n'), 'shell.changeAppliedViewFailed');
        assert.equal(toast.textContent, translateFor(locale, 'shell.changeAppliedViewFailed'));
        const nextLocale = locale === 'ko' ? 'en' : 'ko';
        vm.runInContext(`setLocale(${JSON.stringify(nextLocale)}, {persist:false});`, f.context);
        assert.equal(toast.textContent, translateFor(nextLocale, 'shell.changeAppliedViewFailed'));
        await flushSave(f);
        assert.deepEqual(storedProject(f), applied);
        vm.runInContext('undo()', f.context);
        assert.deepEqual(f.evaluate('state'), before);
        vm.runInContext('undo(true)', f.context);
        assert.deepEqual(f.evaluate('state'), applied);
        const next = await f.context.window.moment.execute('project.update', { patch: { name: 'Next edit' } });
        assert.equal(next.ok, true);
        assert.equal(f.evaluate('state.captions.length'), before.captions.length + 1);
    });
}

test('the direct UI command caller also returns success after an applied edit loses its preview', async () => {
    const f = await fixture(), count = f.evaluate('state.captions.length'), delivered = unavailableNextCanvas(f);
    f.context.insertArgs = args;
    assert.equal(vm.runInContext("runEditorCommand('captions.insert', insertArgs)", f.context), true);
    assert.equal(delivered(), true);
    assert.equal(f.evaluate('state.captions.length'), count + 1);
    assert.equal(f.evaluate('history.length'), 1);
});

test('early view failure keeps canonical selection and reaches the existing autosave owner', async () => {
    const f = await fixture();
    f.context.seedCard = newCard(12);
    vm.runInContext(`state.overlays=[seedCard];selectedCard=seedCard.id;
        renderTimeline=()=>{throw new Error('view unavailable before save scheduling');};`, f.context);
    const id = f.evaluate('selectedCard');
    const result = await f.context.window.moment.execute('overlays.remove', { id });
    assert.equal(result.ok, true);
    assert.equal(f.evaluate('state.overlays.some(card=>card.id===selectedCard) || selectedCard===null'), true);
    assert.equal(f.evaluate('history.length'), 1);
    await flushSave(f);
    assert.deepEqual(storedProject(f), f.evaluate('state'));
});

test('save-status and warning failures cannot turn an already applied command into rejection', async () => {
    const f = await fixture(), before = f.evaluate('state.captions.length');
    vm.runInContext(`renderTimeline=()=>{throw new Error('view unavailable');};
        scheduleSave=()=>{throw new Error('save status unavailable');};
        toast=()=>{throw new Error('warning unavailable');};`, f.context);
    const result = await f.context.window.moment.execute('captions.insert', args);
    assert.equal(result.ok, true);
    assert.equal(f.evaluate('state.captions.length'), before + 1);
    assert.equal(f.evaluate('history.length'), 1);
    assert.equal(f.writes.length, 0, 'success describes the in-memory commit, not durable saving');
});

test('failed-valid recovery keeps post-commit feedback on the existing zero-write path', async () => {
    const f = await fixture();
    vm.runInContext("persistence.restorePhase='failed';persistence.recoveryValid=true;", f.context);
    const delivered = unavailableNextCanvas(f);
    let mediaWrites = 0;
    f.context.mediaWrite = () => { mediaWrites++; return Promise.resolve(); };
    vm.runInContext('projectStore.setMedia=mediaWrite;', f.context);
    const result = await f.context.window.moment.execute('captions.insert', args);
    assert.equal(result.ok, true);
    assert.equal(delivered(), true);
    assert.equal(f.evaluate('history.length'), 1);
    await vm.runInContext('saveProject(true);persistMedia();', f.context);
    assert.deepEqual(f.writes, []);
    assert.equal(mediaWrites, 0);
    assert.equal([...f.timers.values()].filter(timer => timer.delay === 500).length, 0);
    assert.equal(f.evaluate('persistence.restorePhase'), 'failed');
});

for (const rejection of ['invalid', 'busy', 'relink', 'native-bound']) {
    test(`${rejection} rejects before state/history/autosave and cannot use post-commit recovery`, async () => {
        const f = await fixture();
        let command = 'captions.insert', input = args, code = 'INVALID_ARGUMENT';
        if (rejection === 'invalid') input = { ...args, caption: { ...args.caption, end: 0 } };
        if (rejection === 'busy') { vm.runInContext('exporting=true;', f.context); code = 'BUSY'; }
        if (rejection === 'relink') {
            const document = createProjectDocument({ ...f.evaluate('state'), kind: 'video', fileName: 'other.mp4' });
            command = 'project.import'; input = { document }; code = 'MEDIA_RELINK_REQUIRED';
        }
        if (rejection === 'native-bound') {
            vm.runInContext(`state.kind='video';state.fileName='original.mp4';video.duration=2;
                sources.videoFile={name:'original.mp4'};sessionMedia.mediaReady=()=>true;`, f.context);
            command = 'timeline.replace'; input = { clips: [{ start: 0, end: 3 }] };
        }
        const before = f.evaluate('({state,history,future,current,selected,playing})'), delivered = unavailableNextCanvas(f);
        const result = await f.context.window.moment.execute(command, input);
        assert.equal(result.ok, false);
        assert.equal(result.error.code, code);
        assert.equal(delivered(), false);
        assert.deepEqual(f.evaluate('({state,history,future,current,selected,playing})'), before);
        assert.deepEqual(f.writes, []);
        assert.equal([...f.timers.values()].filter(timer => timer.delay === 500).length, 0);
    });
}
