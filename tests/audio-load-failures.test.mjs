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
      duration = 1;
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

// Synthetic metadata events exercise import ownership, not native decoding.
for (const invalidDuration of [0, -1, NaN, -Infinity]) {
  test(`audio duration ${invalidDuration} preserves the connected source and permits retry`, async () => {
    const { context, evaluate, element } = await createAppFixture();
    const revoked = [], probes = [];
    let duration = invalidDuration, nextURL = 0;
    context.URL = {
      createObjectURL: () => `blob:candidate-${++nextURL}`,
      revokeObjectURL: url => revoked.push(url),
    };
    context.Audio = class {
      duration = duration;
      listeners = new Map();
      removed = 0;
      loads = 0;
      constructor() { probes.push(this); }
      addEventListener(name, callback) { this.listeners.set(name, callback); }
      removeEventListener(name) { this.listeners.delete(name); }
      set src(value) { queueMicrotask(() => this.listeners.get('loadedmetadata')?.()); }
      removeAttribute(name) { assert.equal(name, 'src'); this.removed++; }
      load() { this.loads++; }
    };
    vm.runInContext(`
      sources.audioFile = {name:'original.wav'}; sources.audioURL = 'blob:original';
      audio.src = sources.audioURL; state.audioName = 'original.wav'; state.audioOffset = 3;
      globalThis.durationWrites = 0; persistMedia = () => durationWrites++;
      scheduleSave = () => durationWrites++;
    `, context);
    const before = evaluate('({state,history,future,current,selected,src:audio.src})');
    const originalFile = vm.runInContext('sources.audioFile', context);
    element('#audioInput').value = 'selected';
    await vm.runInContext('loadAudio({name:"replacement.wav",size:1})', context);
    assert.deepEqual(evaluate('({state,history,future,current,selected,src:audio.src})'), before);
    assert.equal(vm.runInContext('sources.audioFile', context), originalFile);
    assert.equal(evaluate('sources.audioURL'), 'blob:original');
    assert.equal(evaluate('durationWrites'), 0);
    assert.equal(evaluate('loadingMedia'), false);
    assert.equal(element('#audioInput').value, '');
    assert.deepEqual(revoked, ['blob:candidate-1']);
    assert.equal(probes[0].removed, 1); assert.equal(probes[0].loads, 1);
    assert.equal(probes[0].listeners.size, 0);
    assert.match(element('#toast').textContent, /지원하지 않는 오디오 형식/);

    // Positive finite and indefinite durations retain normal restore's contract.
    for (const acceptedDuration of [8, Infinity]) {
      duration = acceptedDuration;
      await vm.runInContext('loadAudio({name:"replacement.wav",size:1})', context);
      assert.equal(evaluate('state.audioName'), 'replacement.wav');
      assert.equal(evaluate('state.audioOffset'), 0);
      assert.equal(evaluate('sources.audioURL'), `blob:candidate-${nextURL}`);
      assert.equal(evaluate('sources.audioFile.name'), 'replacement.wav');
      assert.equal(evaluate('loadingMedia'), false);
      assert.equal(probes.at(-1).removed, 1); assert.equal(probes.at(-1).loads, 1);
      assert.equal(probes.at(-1).listeners.size, 0);
    }
    assert.equal(evaluate('durationWrites'), 4);
    assert.deepEqual(revoked, ['blob:candidate-1', 'blob:original', 'blob:candidate-2']);
  });
}
