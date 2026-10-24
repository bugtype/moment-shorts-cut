import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptionGeneration } from '../dist/caption-generation.mjs';
import { createDemoProject } from '../dist/core/project.mjs';

function fixture() {
  let state = createDemoProject(), resolveResult, notifySubmitted;
  const calls = [];
  const submitted = new Promise(resolve => { notifySubmitted = resolve; });
  let file = { arrayBuffer: async () => new ArrayBuffer(0) };
  const native = {
    createAudioContext: () => ({
      decodeAudioData: async () => ({ duration: 12 }),
      close: async () => { calls.push('close'); },
    }),
    createOfflineContext: (...args) => {
      calls.push(['offline', ...args]);
      return {
        createBufferSource: () => ({ connect() {}, start() {} }),
        startRendering: async () => ({ getChannelData: () => new Float32Array([.1]) }),
      };
    },
  };
  const generator = createCaptionGeneration({
    getProject: () => state,
    getFile: () => file,
    getDuration: () => 12,
    transcription: {
      transcribe: () => {
        calls.push('submit');
        notifySubmitted();
        return new Promise(resolve => { resolveResult = resolve; });
      },
      cancel: () => calls.push('cancel'),
    },
  }, {
    createAudioContext: () => native.createAudioContext(),
    createOfflineContext: (...args) => native.createOfflineContext(...args),
  });
  return {
    calls, native, generator, submitted,
    file: () => file, replaceFile: () => { file = { arrayBuffer: async () => new ArrayBuffer(0) }; },
    project: () => state,
    replace: () => { state = structuredClone(state); },
    finish: () => resolveResult({ chunks: [{ timestamp: [1, 3], text: ' caption 🎬 ' }] }),
    run: () => generator.generate('video', file, 'ko', {
      start: () => calls.push('start'),
      status: () => calls.push('status'),
      apply: (captions, count) => { calls.push(['apply', count]); state.captions = captions; },
    }),
  };
}

test('generation applies validated captions before the next queued microtask', async () => {
  const f = fixture(), pending = f.run();
  await f.submitted;
  f.finish();
  queueMicrotask(() => {
    assert.deepEqual(f.project().captions, [{ start: 1, end: 3, text: 'caption 🎬' }]);
    f.replace();
  });
  await pending;
  assert.deepEqual(f.calls.at(-1), ['apply', 1]);
  assert.deepEqual(f.calls.find(Array.isArray), ['offline', 1, 192000, 16000]);
});

test('cancel after a resolved result rejects before apply; explicit retry succeeds', async () => {
  const f = fixture(), original = structuredClone(f.project());
  const pending = f.run();
  await f.submitted;
  f.finish();
  f.generator.cancel();
  await assert.rejects(pending, /취소/);
  assert.deepEqual(f.project(), original);
  const retry = f.run();
  // Let the synthetic decoding pipeline reach its next provider invocation.
  while (f.calls.filter(call => call === 'submit').length < 2) await Promise.resolve();
  f.finish();
  await retry;
  assert.deepEqual(f.calls.at(-1), ['apply', 1]);
});

test('decode failure closes its context without submitting or mutating the project', async () => {
  const f = fixture(), original = structuredClone(f.project()), failure = new Error('decode failure');
  f.native.createAudioContext = () => ({
    decodeAudioData: async () => { throw failure; },
    close: async () => { f.calls.push('close'); },
  });
  await assert.rejects(f.run(), error => error === failure);
  assert.equal(f.calls.filter(call => call === 'close').length, 1);
  assert.ok(!f.calls.includes('submit'));
  assert.deepEqual(f.project(), original);
});


function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

for (const stage of ['read', 'decode']) {
  for (const change of ['cancel', 'file', 'project']) {
    test(`${change} during pending ${stage} skips downstream work, closes once and permits retry`, async () => {
      const f = fixture(), waiting = deferred(), entered = deferred();
      const original = structuredClone(f.project());
      let decodeCalls = 0;
      f.native.createAudioContext = () => ({
        decodeAudioData: async () => {
          decodeCalls++;
          if (stage === 'decode') { entered.resolve(); return waiting.promise; }
          return { duration: 12 };
        },
        close: async () => { f.calls.push('close'); },
      });
      if (stage === 'read') f.file().arrayBuffer = () => { entered.resolve(); return waiting.promise; };
      const pending = f.run();
      await entered.promise;
      if (change === 'cancel') f.generator.cancel();
      if (change === 'file') f.replaceFile();
      if (change === 'project') f.replace();
      waiting.resolve(stage === 'read' ? new ArrayBuffer(0) : { duration: 180 });
      await assert.rejects(pending, change === 'cancel' ? /취소/ : /변경/);
      assert.equal(decodeCalls, stage === 'read' ? 0 : 1);
      assert.equal(f.calls.filter(call => call === 'close').length, 1);
      assert.ok(!f.calls.some(Array.isArray), 'no offline allocation or apply');
      assert.ok(!f.calls.includes('submit'));
      assert.deepEqual(f.project(), original);
      f.file().arrayBuffer = async () => new ArrayBuffer(0);
      f.native.createAudioContext = () => ({
        decodeAudioData: async () => ({ duration: 12 }),
        close: async () => { f.calls.push('close'); },
      });
      const retry = f.run(); await f.submitted; f.finish(); await retry;
      assert.equal(f.calls.filter(call => call === 'close').length, 2);
      assert.deepEqual(f.calls.at(-1), ['apply', 1]);
    });
  }
}

test('failed file read still closes its audio context exactly once', async () => {
  const f=fixture(), original=structuredClone(f.project()), failure=new Error('read failed');
  f.file().arrayBuffer=async()=>{throw failure;};
  f.native.createAudioContext=()=>({decodeAudioData:()=>{assert.fail('must not decode');},close:async()=>f.calls.push('close')});
  await assert.rejects(f.run(),error=>error===failure);
  assert.equal(f.calls.filter(call=>call==='close').length,1);
  assert.ok(!f.calls.some(Array.isArray)); assert.deepEqual(f.project(),original);
});
