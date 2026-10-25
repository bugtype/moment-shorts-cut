import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicationModel } from '../qa/export-ownership.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  const timers = new Set(), published = [];
  const model = createPublicationModel(buffer => published.push(buffer), {
    setTimer: callback => { timers.add(callback); return callback; },
    clearTimer: callback => { assert.ok(timers.delete(callback)); },
  });
  return { ...model, timers, published };
}
function port(name, overrides = {}) {
  const calls = [];
  return { calls, buffer: name,
    start: async () => calls.push('start'),
    addFrames: async owns => { assert.equal(owns(), true); calls.push('add'); },
    finalize: async () => calls.push('finalize'),
    cancel: async () => calls.push('cancel'),
    dispose: async () => calls.push('dispose'), ...overrides };
}

test('successful buffer publishes once and stops the interval before disposal', async () => {
  const h = harness(), p = port('complete');
  assert.deepEqual(await h.run(p), { status: 'completed', published: true });
  assert.deepEqual(h.published, ['complete']);
  assert.deepEqual(p.calls, ['start', 'add', 'finalize', 'dispose']);
  assert.equal(h.timers.size, 0);
});

test('pre-aborted job never starts, adds, finalizes or publishes', async () => {
  const h = harness(), controller = new AbortController(), p = port('cancelled');
  controller.abort();
  assert.deepEqual(await h.run(p, { signal: controller.signal }), { status: 'cancelled', published: false });
  assert.deepEqual(p.calls, ['cancel', 'dispose']);
  assert.equal(h.published.length, 0);
  assert.equal(h.timers.size, 0);
});

for (const phase of ['start', 'addFrames', 'finalize', 'dispose']) {
  test(`cancel during ${phase}, then retry before old promise settles`, async () => {
    const h = harness(), gate = deferred(), entered = deferred();
    let disposeCount = 0;
    const p = port('stale', { [phase]: async () => {
      if (phase === 'dispose') disposeCount++;
      entered.resolve(); await gate.promise;
    } });
    const first = h.run(p);
    await entered.promise;
    h.cancel();
    assert.equal(h.timers.size, 0);
    assert.deepEqual(await h.run(port('new')), { status: 'completed', published: true });
    gate.resolve();
    assert.deepEqual(await first, { status: 'cancelled', published: false });
    assert.deepEqual(h.published, ['new']);
    assert.equal(p.calls.filter(call => call === 'cancel').length, ['finalize', 'dispose'].includes(phase) ? 0 : 1);
    assert.equal(p.calls.filter(call => call === 'dispose').length + disposeCount, 1);
    assert.equal(h.timers.size, 0);
  });
}

for (const phase of ['start', 'addFrames', 'finalize', 'dispose']) {
  test(`${phase} failure stops the interval; failed encoding never publishes`, async () => {
    const h = harness(), error = new Error(`${phase} failed`);
    const p = port('failed', { [phase]: async () => { throw error; } });
    await assert.rejects(h.run(p), failure => failure === error);
    assert.deepEqual(h.published, []);
    assert.equal(h.timers.size, 0);
    await h.run(port('retry'));
    assert.equal(h.published.at(-1), 'retry');
  });
}

test('cancel failure is observed, disposal still runs and nothing is published', async () => {
  const h = harness(), gate = deferred(), entered = deferred(), error = new Error('cancel failed');
  const p = port('failed', { start: async () => { entered.resolve(); await gate.promise; }, cancel: async () => { throw error; } });
  const running = h.run(p);
  await entered.promise;
  h.cancel();
  gate.resolve();
  await assert.rejects(running, failure => failure === error);
  assert.deepEqual(p.calls, ['dispose']);
  assert.equal(h.published.length, 0);
  assert.equal(h.timers.size, 0);
});

for (const cleanup of ['cancel', 'dispose']) {
  test(`primary encoding error survives ${cleanup} failure`, async () => {
    const h = harness(), primary = new Error('decode failed'), secondary = new Error(`${cleanup} failed`);
    const p = port('failed', { start: async () => { throw primary; }, [cleanup]: async () => { throw secondary; } });
    await assert.rejects(h.run(p), error => {
      assert.equal(error.cause, primary);
      assert.deepEqual(error.errors, [primary, secondary]);
      return true;
    });
    assert.equal(h.published.length, 0);
    assert.equal(h.timers.size, 0);
    await h.run(port('retry'));
  });
}

test('publisher exception is reported; a prior dispatch cannot be rolled back', async () => {
  const dispatched = [], error = new Error('publisher failed after dispatch');
  const model = createPublicationModel(buffer => { dispatched.push(buffer); throw error; });
  const p = port('already-dispatched');
  await assert.rejects(model.run(p), failure => failure === error);
  assert.deepEqual(dispatched, ['already-dispatched']);
  assert.equal(p.calls.filter(call => call === 'dispose').length, 1);
  await assert.rejects(model.run(port('retry')), failure => failure === error);
  assert.deepEqual(dispatched, ['already-dispatched', 'retry']);
});

test('abort followed by an independent stage rejection preserves that failure', async () => {
  const h = harness(), controller = new AbortController(), gate = deferred(), entered = deferred();
  const original = new Error('decoder failed');
  const p = port('failed', { start: () => { entered.resolve(); return gate.promise; } });
  const running = h.run(p, { signal: controller.signal });
  await entered.promise;
  controller.abort();
  gate.reject(original);
  await assert.rejects(running, error => error === original);
  assert.deepEqual(h.published, []);
  assert.equal(h.timers.size, 0);
  assert.equal(p.calls.filter(call => call === 'dispose').length, 1);
});

test('falsy primary rejection is retained with both cleanup failures', async () => {
  const h = harness(), cancelError = new Error('cancel'), disposeError = new Error('dispose');
  const p = port('failed', { start: async () => { throw null; },
    cancel: async () => { throw cancelError; }, dispose: async () => { throw disposeError; } });
  await assert.rejects(h.run(p), error => {
    assert.equal(error.cause, null);
    assert.deepEqual(error.errors, [null, cancelError, disposeError]);
    return true;
  });
  assert.equal(h.timers.size, 0);
  await h.run(port('retry'));
});

test('timer cleanup failure prevents publication and still disposes and unlocks retry', async () => {
  const error = new Error('timer cleanup failed'), published = [], timers = new Set();
  let fail = true;
  const h = createPublicationModel(value => published.push(value), {
    setTimer: callback => { timers.add(callback); return callback; },
    clearTimer: callback => { timers.delete(callback); if (fail) throw error; },
  });
  const p = port('failed');
  await assert.rejects(h.run(p), failure => failure === error);
  assert.deepEqual(p.calls, ['start', 'add', 'finalize', 'dispose']);
  assert.deepEqual(published, []);
  assert.equal(timers.size, 0);
  fail = false;
  await h.run(port('retry'));
});

for (const method of ['addEventListener', 'removeEventListener']) {
  test(`${method} failure preserves disposal and retry`, async () => {
    const h = harness(), error = new Error(method), p = port('failed');
    const signal = { addEventListener() {}, removeEventListener() {}, [method]() { throw error; } };
    await assert.rejects(h.run(p, { signal }), failure => failure === error);
    assert.equal(p.calls.filter(call => call === 'dispose').length, 1);
    assert.equal(h.timers.size, 0);
    assert.deepEqual(h.published, []);
    await h.run(port('retry'));
  });
}
