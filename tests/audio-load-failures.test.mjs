import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

for (const failure of ['object URL', 'audio probe']) {
  test(`audio import releases its busy lock when ${failure} setup fails`, async () => {
    const { context, evaluate, element } = await createAppFixture();
    const revoked = [];
    context.URL = {
      createObjectURL() {
        if (failure === 'object URL') throw new Error('synthetic URL failure');
        return 'blob:synthetic-audio';
      },
      revokeObjectURL: url => revoked.push(url),
    };
    context.Audio = class { constructor() { throw new Error('synthetic probe failure'); } };
    const before = evaluate('[state, history, future]');
    element('#audioInput').value = 'selected';
    await assert.doesNotReject(vm.runInContext('loadAudio({name:"voice.wav",size:1})', context));
    assert.equal(evaluate('loadingMedia'), false);
    assert.equal(element('#audioInput').value, '');
    assert.deepEqual(evaluate('[state, history, future]'), before);
    assert.deepEqual(revoked, failure === 'object URL' ? [] : ['blob:synthetic-audio']);
    assert.match(element('#toast').textContent, /synthetic.*failure/);
    await vm.runInContext('loadAudio({name:"large.wav",size:101*1024*1024})', context);
    assert.match(element('#toast').textContent, /100 MB/);
    context.URL.createObjectURL = () => 'blob:synthetic-retry';
    context.Audio = class {
      listeners = new Map();
      addEventListener(name, callback) { this.listeners.set(name, callback); }
      removeEventListener(name) { this.listeners.delete(name); }
      set src(value) { queueMicrotask(() => this.listeners.get('loadedmetadata')?.()); }
      removeAttribute() {}
      load() {}
    };
    await vm.runInContext('loadAudio({name:"retry.wav",size:1})', context);
    assert.equal(evaluate('loadingMedia'), false);
    assert.equal(evaluate('state.audioName'), 'retry.wav');
    assert.equal(evaluate('sources.audioURL'), 'blob:synthetic-retry');
  });
}
