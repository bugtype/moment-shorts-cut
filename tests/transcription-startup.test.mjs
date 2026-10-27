import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createTranscriptionClient } from '../dist/transcription-client.mjs';
import { message } from '../dist/i18n.mjs';

const source = fs.readFileSync(new URL('../dist/transcribe-worker.js', import.meta.url), 'utf8');
const runtimeImport = "await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js')";
assert.equal(source.split(runtimeImport).length, 2);
const injected = source.replace("import { message as msg } from './i18n.mjs';", '').replace(runtimeImport, 'await loadRuntime()');
assert.ok(!injected.includes('import('));

// Execute the actual worker handler with an authored runtime, never a downloaded
// library, model, native Worker or microphone. This does not test browser loading.
function fixture(createRuntimeLoader) {
  const workers = [];
  const client = createTranscriptionClient(() => {
    const worker = {
      terminateCalls: 0, messages: [],
      terminate() { this.terminateCalls++; },
      postMessage(data) { void self.onmessage({data}); },
    };
    const self = {postMessage(data) {
      worker.messages.push(data);
      if (!worker.terminateCalls) worker.onmessage?.({data});
    }};
    const loadRuntime = createRuntimeLoader(workers.length);
    vm.runInNewContext(injected, {self, msg: message, loadRuntime});
    workers.push(worker);
    return worker;
  });
  return {client, workers, start: () => client.transcribe(new Float32Array([.1,.2]), 'ko', () => {})};
}
const runtime = pipeline => ({env:{backends:{onnx:{wasm:{}}}}, pipeline});
const outcome = promise => promise.then(value => ({ok:true,value}), error => ({ok:false,error}));

for (const phase of ['import', 'pipeline']) {
  test(`explicit retry replaces the worker after cached ${phase} initialization rejection`, async () => {
    let attempts = 0, pipelineCalls = 0;
    const f = fixture(index => {
      let loading, initialized;
      const module = runtime(async () => {
        pipelineCalls++;
        if (phase === 'pipeline' && !initialized) {
          attempts++;
          initialized = index === 0 ? Promise.reject(new Error('synthetic cached startup failure')) : Promise.resolve();
        }
        if (initialized) await initialized;
        return async () => ({text:'synthetic success',chunks:[]});
      });
      return () => {
        if (!loading) {
          if (phase === 'import') attempts++;
          loading = phase === 'import' && index === 0
            ? Promise.reject(new Error('synthetic cached import failure')) : Promise.resolve(module);
        }
        return loading;
      };
    });
    const first = await outcome(f.start());
    assert.equal(first.ok, false);
    assert.equal(first.error.messageKey, 'errors.recognitionFailed');
    assert.equal(first.error.message, message('errors.recognitionFailed').message);
    assert.equal(f.workers.length, 1, 'No automatic retry or worker creation');
    assert.equal(attempts, 1);
    const retry = await outcome(f.start());
    assert.equal(retry.ok, true, `explicit retry must leave the cached rejection: workers=${f.workers.length}, attempts=${attempts}`);
    assert.equal(retry.value.text, 'synthetic success');
    assert.equal(f.workers.length, 2);
    assert.equal(attempts, 2);
    assert.equal(f.workers[0].terminateCalls, 1);
    assert.equal(f.workers[0].messages.at(-1).fatal, true);
    assert.equal(Object.hasOwn(first.error, 'fatal'), false, 'Private lifetime metadata is not a new caller error field');
    assert.equal((await f.start()).text, 'synthetic success');
    assert.equal(f.workers.length, 2, 'Warm success still reuses the worker');
    assert.equal(pipelineCalls, phase === 'import' ? 1 : 2);
    f.client.cancel();
  });
}

test('post-ready inference errors retain the warm worker and ordinary localized envelope', async () => {
  let pipelineCalls = 0, inferenceCalls = 0;
  const requests = [];
  const f = fixture(() => async () => runtime(async () => {
    pipelineCalls++;
    return async (pcm, options) => {
      requests.push({pcm, options});
      if (++inferenceCalls === 2) throw new Error('synthetic inference failure');
      return {text:'warm success',chunks:[]};
    };
  }));
  assert.equal((await f.start()).text, 'warm success');
  const failure = await outcome(f.start());
  assert.equal(failure.ok, false);
  assert.equal(failure.error.messageKey, 'errors.recognitionFailed');
  assert.equal(JSON.stringify(f.workers[0].messages.at(-1)), JSON.stringify({type:'error',...message('errors.recognitionFailed')}));
  assert.equal((await f.start()).text, 'warm success');
  assert.equal(pipelineCalls, 1);
  assert.equal(inferenceCalls, 3);
  assert.equal(f.workers.length, 1);
  assert.equal(f.workers[0].terminateCalls, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(requests[2].options)), {
    language:'ko',task:'transcribe',return_timestamps:true,chunk_length_s:30,stride_length_s:5,
  });
  f.client.cancel();
});

test('Cancel during startup discards late failure without retiring the explicit retry', async () => {
  let rejectStartup, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const startup = new Promise((resolve, reject) => { rejectStartup = reject; });
  const f = fixture(index => async () => runtime(async () => {
    if (index === 0) { entered(); await startup; }
    return async () => ({text:'current',chunks:[]});
  }));
  const first = outcome(f.start());
  await waiting;
  f.client.cancel();
  const cancelled = await first;
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.error.messageKey, 'errors.transcriptionCancelled');
  assert.equal((await f.start()).text, 'current');
  rejectStartup(new Error('late startup failure'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.workers.length, 2);
  assert.equal(f.workers[0].terminateCalls, 1);
  assert.equal(f.workers[1].terminateCalls, 0);
  assert.equal((await f.start()).text, 'current');
  f.client.cancel();
});
