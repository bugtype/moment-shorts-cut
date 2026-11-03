import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createAppFixture} from './fixtures/app.mjs';

for (const mode of ['active', 'leave', 'reset', 'return']) test(`caption view releases retired owners: ${mode}`, () => {
    const result = JSON.parse(execFileSync(process.execPath, ['--expose-gc', fileURLToPath(new URL('./fixtures/caption-view-retention.mjs', import.meta.url)), mode], {encoding: 'utf8', timeout: 30000}));
    assert.equal(result.oldProjectRetained, mode === 'active' || mode === 'leave');
    assert.equal(result.detachedRowRetained, mode === 'active');
    assert.equal(result.currentCaptions, mode === 'active' || mode === 'leave' ? 10000 : 3);
    assert.equal(result.history, 0); assert.equal(result.future, 0);
    assert.ok(result.serializedBytes > 1000000, 'Retired authored payload size, not heap measurement');
});

test('leaving caption view preserves live search drafts, selection and replacement anchor', async () => {
    const f = await createAppFixture();
    vm.runInContext("state.captions=[{start:0,end:1,text:'a a a'}];switchPanel('captions');", f.context);
    f.element('#captionFind').value = 'a'; f.element('#captionFind').oninput();
    f.element('#captionReplacement').value = 'aa'; f.element('#captionReplacement').oninput();
    f.element('#nextCaptionMatch').onclick(); f.element('#nextCaptionMatch').onclick();
    const before = f.evaluate('({state,history,future})');
    vm.runInContext("switchPanel('media');switchPanel('captions');", f.context);
    assert.equal(f.element('#captionFind').value, 'a');
    assert.equal(f.element('#captionReplacement').value, 'aa');
    assert.equal(f.element('#captionSearchStatus').textContent, '일치 2 / 3');
    assert.deepEqual(f.evaluate('({state,history,future})'), before);
    // The generic app fixture does not parse textarea initial values.
    f.element('[data-caption-text="0"]').value = f.evaluate('state.captions[0].text');
    f.element('#replaceCaptionMatch').onclick();
    assert.equal(f.evaluate('state.captions[0].text'), 'a aa a');
    vm.runInContext("switchPanel('media');switchPanel('captions');", f.context);
    f.element('#nextCaptionMatch').onclick();
    assert.equal(f.element('[data-caption-text="0"]').selectionStart, 5, 'Next skips inserted query using preserved anchor');
    assert.equal(f.evaluate('history.length'), 1);
});

test('inactive caption view invalidates retired search identity without discarding search drafts', async () => {
    const f = await createAppFixture();
    vm.runInContext("state.captions=[{start:0,end:1,text:'a a'}];switchPanel('captions');", f.context);
    f.element('#captionFind').value = 'a'; f.element('#captionFind').oninput();
    f.element('#nextCaptionMatch').onclick();
    vm.runInContext("switchPanel('media');state=initial();state.captions=[{start:0,end:1,text:'new a'}];renderPanel();switchPanel('captions');", f.context);
    assert.equal(f.element('#captionFind').value, 'a');
    assert.equal(f.element('#captionSearchStatus').textContent, '일치 0 / 1');
    f.element('#nextCaptionMatch').onclick();
    assert.equal(f.element('[data-caption-text="0"]').selectionStart, 4);
});
