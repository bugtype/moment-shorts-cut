import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranscriptionClient } from '../dist/transcription-client.mjs';
import { message } from '../dist/i18n.mjs';

function fixture() {
  const workers = [];
  const client = createTranscriptionClient(() => {
    const worker = {
      terminateCalls: 0,
      postMessage(message, transfers) { this.message = message; this.transfers = transfers; },
      terminate() { this.terminateCalls++; },
    };
    workers.push(worker);
    return worker;
  });
  const progress = [];
  const pcm = new Float32Array([0.1, 0.2]);
  const start = () => client.transcribe(pcm, 'korean', message => progress.push(message));
  return { workers, client, pcm, start, progress };
}
const emit = (worker, data) => worker.onmessage({ data });

test('worker creation is lazy; successful jobs and recoverable errors reuse the instance', async () => {
  const f = fixture();
  assert.equal(f.workers.length, 0);
  f.client.cancel();
  assert.equal(f.workers.length, 0);
  const first = f.start(), worker = f.workers[0];
  assert.deepEqual(worker.message, { audio: f.pcm, language: 'korean' });
  assert.deepEqual(worker.transfers, [f.pcm.buffer]);
  emit(worker, { type: 'progress', message: 'loading' });
  const result = { chunks: [{ text: 'hello', timestamp: [0, 1] }] };
  emit(worker, { type: 'result', result });
  assert.equal(await first, result);
  assert.equal(worker.onmessage, null);
  assert.deepEqual(f.progress, ['loading']);
  const failure = f.start();
  emit(worker, { type: 'error', message: 'job failure' });
  await assert.rejects(failure, /job failure/);
  assert.equal(worker.terminateCalls, 0);
  const retry = f.start();
  assert.equal(f.workers.length, 1);
  emit(worker, { type: 'result', result });
  assert.equal(await retry, result);
  f.client.cancel();
  f.client.cancel();
  assert.equal(worker.terminateCalls, 1);
});

test('fatal failure retires only its instance and retained callbacks cannot affect explicit retry', async () => {
  const f = fixture(), pending = f.start(), old = f.workers[0];
  const oldMessage = old.onmessage, oldError = old.onerror;
  oldError();
  await assert.rejects(pending, /음성 인식 모듈/);
  assert.equal(old.terminateCalls, 1);
  assert.equal(old.onmessage, null);
  assert.equal(f.workers.length, 1, 'No automatic retry');
  const retry = f.start(), current = f.workers[1];
  oldMessage({ data: { type: 'progress', message: 'stale progress' } });
  oldMessage({ data: { type: 'result', result: 'stale' } });
  oldError();
  assert.deepEqual(f.progress, []);
  assert.equal(old.terminateCalls, 1);
  assert.equal(current.terminateCalls, 0);
  emit(current, { type: 'result', result: 'current' });
  assert.equal(await retry, 'current');
  current.onerror();
  assert.equal(current.terminateCalls, 1, 'Idle failures also retire the worker');
  const next = f.start();
  emit(f.workers[2], { type: 'result', result: 'after idle failure' });
  assert.equal(await next, 'after idle failure');
});

test('cancellation rejects once, detaches messages and leaves subsequent work intact', async () => {
  const f = fixture(), pending = f.start(), old = f.workers[0];
  const lateMessage = old.onmessage, lateError = old.onerror;
  let rejections = 0;
  const observed = pending.catch(error => { rejections++; throw error; });
  f.client.cancel();
  f.client.cancel();
  await assert.rejects(observed, /취소/);
  assert.equal(rejections, 1);
  assert.equal(old.terminateCalls, 1);
  assert.equal(old.onmessage, null);
  const next = f.start(), current = f.workers[1];
  lateMessage({ data: { type: 'error', message: 'late failure' } });
  lateMessage({ data: { type: 'error', fatal: true, message: 'late startup failure' } });
  lateError();
  emit(current, { type: 'result', result: 'retry' });
  assert.equal(await next, 'retry');
  assert.equal(current.terminateCalls, 0);
  assert.equal(rejections, 1);
});

test('old job callbacks on a reused worker do not retire or settle its newer job', async () => {
  const f = fixture(), first = f.start(), worker = f.workers[0];
  const oldMessage = worker.onmessage, oldError = worker.onerror;
  emit(worker, { type: 'error', message: 'recoverable' });
  await assert.rejects(first, /recoverable/);
  const second = f.start();
  oldError();
  oldMessage({ data: { type: 'result', result: 'old' } });
  oldMessage({ data: { type: 'progress', message: 'old' } });
  oldMessage({ data: { type: 'error', fatal: true, message: 'old startup failure' } });
  assert.equal(worker.terminateCalls, 0);
  assert.deepEqual(f.progress, []);
  emit(worker, { type: 'result', result: 'new' });
  assert.equal(await second, 'new');
});

test('startup error metadata retires only its owner without changing the localized rejection', async () => {
  const f = fixture(), pending = f.start(), old = f.workers[0];
  const oldMessage = old.onmessage, oldError = old.onerror;
  emit(old, {type:'error',fatal:true,...message('errors.recognitionFailed')});
  await assert.rejects(pending, error => error.messageKey === 'errors.recognitionFailed' &&
    error.message === message('errors.recognitionFailed').message && !Object.hasOwn(error, 'fatal'));
  assert.equal(old.terminateCalls, 1);
  assert.equal(old.onmessage, null);
  assert.equal(f.workers.length, 1, 'Only an explicit retry may create the next worker');
  const retry = f.start(), current = f.workers[1];
  oldMessage({data:{type:'error',fatal:true,message:'stale'}});
  oldError();
  assert.equal(old.terminateCalls, 1);
  assert.equal(current.terminateCalls, 0);
  emit(current, {type:'result',result:'current'});
  assert.equal(await retry, 'current');
  for (const fatal of [false, 1, 'true']) {
    const failure = f.start();
    emit(current, {type:'error',fatal,message:'recoverable'});
    await assert.rejects(failure, /recoverable/);
    assert.equal(current.terminateCalls, 0, 'Only the exact private fatal marker retires the worker');
  }
  f.client.cancel();
});

test('constructor and message transport failures leave explicit retry available', async () => {
  for (const phase of ['constructor', 'postMessage']) {
    const failure = new Error(phase);
    let attempts = 0, stops = 0, worker;
    const client = createTranscriptionClient(() => {
      attempts++;
      if (phase === 'constructor' && attempts === 1) throw failure;
      return worker = {
        postMessage() { if (phase === 'postMessage' && attempts === 1) throw failure; },
        terminate() { stops++; },
      };
    });
    const start = () => client.transcribe(new Float32Array(1), 'korean', () => {});
    if (phase === 'constructor') assert.throws(start, error => error === failure);
    else await assert.rejects(start(), error => error === failure);
    assert.equal(attempts, 1);
    assert.equal(stops, phase === 'postMessage' ? 1 : 0);
    const retry = start();
    emit(worker, { type: 'result', result: 'ok' });
    assert.equal(await retry, 'ok');
    assert.equal(attempts, 2);
  }
});
