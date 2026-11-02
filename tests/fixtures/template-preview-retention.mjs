import assert from 'node:assert/strict';
import vm from 'node:vm';
import { File } from 'node:buffer';
import { createAppFixture } from './app.mjs';

// Run in a fresh --expose-gc subprocess. This checks JS reachability, not browser
// memory usage, File backing-store release, or when native garbage collection runs.
const mode = process.argv[2];
assert.ok(['control', 'close', 'replace', 'active'].includes(mode));
assert.equal(typeof global.gc, 'function');

async function setup() {
    const f = await createAppFixture();
    f.context.File = File;
    vm.runInContext(`
        state = initial();
        state.kind = 'video'; state.fileName = 'previous.mp4'; state.audioName = 'previous.wav';
        sources.videoFile = new File(['video'], state.fileName, {type:'video/mp4'});
        sources.audioFile = new File(['audio'], state.audioName, {type:'audio/wav'});
        validateProject(state);
        composition.draw = () => {};
    `, f.context);
    const references = vm.runInContext('[new WeakRef(state), new WeakRef(sources.videoFile), new WeakRef(sources.audioFile)]', f.context);
    const retained = [];
    if (mode !== 'control') {
        vm.runInContext('pause(); templatePreview.open(TEMPLATES[0])', f.context);
        f.element('#toggleTemplateDemo').onclick({});
        retained.push(...f.pendingFrames.values());
        retained.push(f.element('#modal').onclose, f.element('#modal').onreplace);
        for (const selector of ['#applyTemplateStyle', '#applyTemplateStructure', '#toggleTemplateDemo', '#templateCurrentStyle', '#templateSelectedStyle']) {
            retained.push(f.element(selector).onclick);
        }
        retained.push(f.element('#templatePreviewMode').onchange);
        if (mode === 'close') {
            f.element('#modal').close();
            f.element('#modal').onclose();
        }
    }
    if (mode === 'active') {
        // A still-open scene must own its original references so its exact
        // project/media invalidation contract remains unchanged.
        vm.runInContext('state = initial(); sources.reset()', f.context);
    } else if (mode === 'close') {
        // A normal video replacement after closing does not replace the modal.
        // Stub only native media loading; use the real app adoption/cleanup path.
        vm.runInContext('sources.setVideoFile = async () => {}', f.context);
        await vm.runInContext("loadVideo(new File(['new video'], 'next.mp4', {type:'video/mp4'}))", f.context);
        assert.equal(f.evaluate('state.fileName'), 'next.mp4');
        assert.equal(f.evaluate('sources.videoFile.name'), 'next.mp4');
        assert.equal(f.evaluate('sources.audioFile'), null);
        assert.equal(f.element('#modal').open, false);
        assert.deepEqual(f.evaluate('[history.length,future.length]'), [0, 0]);
    } else {
        // The real reset dialog replaces the prior modal and resets project,
        // media, history and future through their existing owners.
        vm.runInContext('confirmReset()', f.context);
        f.element('#confirmReset').onclick({});
        assert.equal(f.evaluate('state.kind'), 'demo');
        assert.equal(f.evaluate('sources.videoFile'), null);
        assert.equal(f.evaluate('sources.audioFile'), null);
        assert.deepEqual(f.evaluate('[history.length,future.length]'), [0, 0]);
    }
    return {f, references, retained};
}

const holder = await setup();
// Each collection starts in another job; dereferencing before the final sample
// would itself retain the targets until the current job finishes.
for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
    global.gc();
}
const reachable = Array.from(holder.references, reference => reference.deref() !== undefined);
const expected = mode === 'active';
assert.deepEqual(reachable, [expected, expected, expected], `${mode}: old project/video/audio reachability`);
if (mode !== 'active') {
    const before = holder.f.evaluate('({state,history,future,current,selected})');
    // Saved handlers and repeated cleanup remain harmless after scene release.
    const pendingFrames = holder.f.pendingFrames.size;
    for (const callback of holder.retained) callback({});
    assert.deepEqual(holder.f.evaluate('({state,history,future,current,selected})'), before);
    assert.equal(holder.f.pendingFrames.size, pendingFrames);
}
console.log(JSON.stringify({mode, reachable, retainedCallbacks: holder.retained.length}));
