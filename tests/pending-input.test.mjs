import test from 'node:test';
import assert from 'node:assert/strict';
import { createPendingInputCheck } from '../dist/pending-input.mjs';

function fixture({ type = 'text', model = 'Original', display = model, nullable } = {}) {
  const state = { model, current: true, composing: false };
  const input = {
    type, value: display, validity: { badInput: false },
    get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); },
  };
  const check = createPendingInputCheck(input, {
    read: () => state.model, current: () => state.current,
    composing: () => state.composing, nullable,
  });
  return { input, state, check };
}

test('pending input preserves initial display normalization while observing live text and composition', () => {
  for (const type of ['text', 'textarea']) {
    const { input, state, check } = fixture({ type, model: 'A\r\nB', display: 'AB' });
    assert.equal(check(), false, 'untouched browser-normalized text is not a draft');
    state.composing = true;
    assert.equal(check(), true, 'composition blocks even before the display changes');
    state.composing = false;
    input.value = 'New text';
    assert.equal(check(), true);
    state.model = 'New text';
    assert.equal(check(), false, 'a committed edit permits retry');
    input.value = 'AB';
    assert.equal(check(), true, 'the initial display does not hide a changed model');
    state.current = false;
    assert.equal(check(), false, 'an old control cannot block its replacement');
  }
});

test('pending numeric input distinguishes equivalent values, required blanks and nullable ends', () => {
  const { input, state, check } = fixture({ type: 'number', model: 1, display: '1' });
  input.value = '1e0';
  assert.equal(check(), false, 'equivalent numeric spelling is not a draft');
  input.value = '2';
  assert.equal(check(), true);
  state.model = 2;
  assert.equal(check(), false);
  input.value = '';
  assert.equal(check(), true, 'required card endpoints cannot be blank');
  input.value = 'invalid';
  assert.equal(check(), true);
  input.value = '2';
  input.validity.badInput = true;
  assert.equal(check(), true);
  input.validity.badInput = false;
  assert.equal(check(), false);
  input.type = 'text';
  assert.equal(check(), true, 'input type remains live rather than captured at binding');

  const end = fixture({ type: 'number', model: 8, display: '8', nullable: value => value == null });
  end.input.value = '';
  assert.equal(end.check(), true, 'clearing an existing end is still an uncommitted edit');
  end.state.model = null;
  assert.equal(end.check(), false, 'a committed null end permits the blank');
  end.input.validity.badInput = true;
  assert.equal(end.check(), true, 'native badInput is not an intentional nullable blank');
  end.input.validity.badInput = false;
  assert.equal(end.check(), false);
  const required = fixture({ type: 'number', model: null, display: '' });
  assert.equal(required.check(), true, 'null model alone does not make a field optional');
});

test('pending checks preserve capture order, lazy reads, nullable policy timing and original errors', () => {
  for (const nullable of [undefined, value => value == null]) {
    const trace = [], failure = new Error('generated pending-input failure');
    let current = true, composing = false, throwRead = false, numericReads = 0;
    const values = { type: 'number', value: '1', validity: { badInput: false } };
    const input = new Proxy(values, {
      get(target, key) {
        trace.push(key);
        if (key === 'valueAsNumber') return ++numericReads === 1 ? 1 : 2;
        return target[key];
      },
    });
    const check = createPendingInputCheck(input, {
      read() { trace.push('read'); if (throwRead) throw failure; return 1; },
      current() { trace.push('current'); return current; },
      composing() { trace.push('composing'); return composing; },
      nullable: nullable && (value => { trace.push('nullable'); return nullable(value); }),
    });
    assert.deepEqual(trace, ['read', 'value']);
    trace.length = 0;
    current = false;
    throwRead = true;
    assert.equal(check(), false);
    assert.deepEqual(trace, ['current']);
    trace.length = 0;
    current = true;
    assert.throws(check, error => error === failure);
    assert.deepEqual(trace, ['current', 'read']);
    trace.length = 0;
    throwRead = false;
    composing = true;
    assert.equal(check(), true);
    assert.deepEqual(trace, ['current', 'read', 'type', ...(nullable ? ['nullable'] : []), 'composing']);
    trace.length = 0;
    composing = false;
    values.value = '1e0';
    assert.equal(check(), true, 'both numeric reads remain live');
    assert.deepEqual(trace, [
      'current', 'read', 'type', ...(nullable ? ['nullable'] : []), 'composing',
      'validity', 'value', 'value', ...(nullable ? ['value'] : []), 'valueAsNumber', 'valueAsNumber',
    ]);
  }
});
