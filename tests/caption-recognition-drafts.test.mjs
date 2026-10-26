import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { decimalTime } from '../dist/ui-format.mjs';
import { setLocale, t } from '../dist/i18n.mjs';

// Model only panel descendant replacement and current input values, not native
// focus/change ordering, IME, media decoding or the transcription model.
async function fixture() {
  const f = await createAppFixture(), panel = f.element('#panelContent');
  const originalQuery = f.doc.querySelector, originalAll = f.doc.querySelectorAll;
  let controls = new Map(), rows = [], markup = '', generation = 0, submit;
  const query = selector => controls.get(selector) || originalQuery(selector);
  f.doc.querySelector = query;
  f.doc.querySelectorAll = selector => {
    const field = selector.match(/^\[data-caption-(text|start|end|keywords|speaker)\]$/)?.[1];
    return field ? rows.map(row => row[field]) : originalAll(selector);
  };
  panel.querySelector = query;
  Object.defineProperty(panel, 'innerHTML', { configurable: true, get: () => markup, set: value => {
    markup = value; controls = new Map(); rows = []; generation++;
    const node = key => f.element(`recognition-${generation}-${key}`);
    for (const [, id] of value.matchAll(/\bid="([\w-]+)"/g)) {
      const el = node(id); el.id = id; controls.set('#' + id, el);
    }
    if (!controls.has('#captionRows')) return;
    for (const [id, val] of Object.entries({ captionSource: 'video', language: 'korean', captionChunkSize: '18',
      captionShiftDelta: '0', captionShiftBasis: 'source', captionPageNumber: '1' })) query('#' + id).value = val;
    query('#captionCreate').open = /id="captionCreate" open/.test(value);
    controls.set('#captionCreate summary', node('summary'));
    query('#generateCaptions').innerHTML = value.match(/id="generateCaptions">(.*?)<\/button>/s)[1];
    const captions = f.evaluate('state.captions');
    for (const [, index] of value.matchAll(/data-caption-text="(\d+)"/g)) {
      const row = {};
      for (const field of ['text', 'start', 'end', 'keywords', 'speaker']) {
        const el = node(`${field}-${index}`), caption = captions[index];
        el.dataset['caption' + field[0].toUpperCase() + field.slice(1)] = index;
        el.value = ['start', 'end'].includes(field) ? decimalTime(caption[field]) : String(caption[field] ?? '');
        // HTML textarea parsing drops one initial LF; API values normalize CR,
        // while single-line text inputs strip line breaks. No native DOM claim.
        if (field === 'text') el.value = el.value.replace(/\r\n?/g, '\n').replace(/^\n/, '');
        if (field === 'keywords') el.value = el.value.replace(/[\r\n]/g, '');
        controls.set(`[data-caption-${field}="${index}"]`, el); row[field] = el;
      }
      rows.push(row);
    }
  }});
  f.context.Worker = class { postMessage() { submit(this); } terminate() {} };
  f.context.AudioContext = class { async decodeAudioData() { return { duration: 1 }; } async close() {} };
  f.context.OfflineAudioContext = class {
    createBufferSource() { return { connect() {}, start() {} }; }
    async startRendering() { return { getChannelData: () => new Float32Array([.1]) }; }
  };
  f.context.syntheticSource = { name: 'synthetic.mp4', arrayBuffer: async () => new ArrayBuffer(0) };
  vm.runInContext("state.captions=[{start:0,end:1,text:'Original'}]; sources.videoFile=syntheticSource; switchPanel('captions');", f.context);
  async function start() {
    const submitted = new Promise(resolve => { submit = resolve; });
    const pending = vm.runInContext('generateCaptions()', f.context);
    return { worker: await submitted, pending };
  }
  async function finish(run, ending = 'result') {
    if (ending === 'cancel') await vm.runInContext('generateCaptions()', f.context);
    else run.worker.onmessage({ data: ending === 'result'
      ? { type: 'result', result: { chunks: [{ timestamp: [0, 1], text: 'Recognized' }] } }
      : { type: 'error', message: 'Synthetic worker failure' } });
    await run.pending;
  }
  return { ...f, query, panel, start, finish };
}

for (const ending of ['result', 'error', 'cancel']) for (const [field, value] of [
  ['text', 'Human draft'], ['start', '.2'], ['end', '.8'], ['keywords', 'Human keyword'], ['speaker', '1'],
]) test(`${ending} preserves an uncommitted caption ${field} draft without applying it`, async () => {
  const f = await fixture(), run = await f.start();
  const input = f.query(`[data-caption-${field}="0"]`), before = f.evaluate('({state,history,future})');
  input.focus(); input.value = value;
  await f.finish(run, ending);
  assert.equal(f.query(`[data-caption-${field}="0"]`), input);
  assert.equal(input.value, value); assert.equal(f.doc.activeElement, input);
  assert.deepEqual(f.evaluate('({state,history,future})'), before);
  assert.equal(f.evaluate('transcribing'), false);
  assert.equal(f.query('#asrStatus').hidden, true);
  assert.match(f.query('#generateCaptions').innerHTML, /data-i18n="panels.generateCaptions"/);
  if (ending === 'result') assert.equal(f.element('#toast').textContent, t('errors.transcriptionConflict'));
  input.onchange(); // The surviving handler still owns this row.
  assert.equal(f.evaluate(`state.captions[0].${field}`), ['start', 'end'].includes(field) ? Number(value) : value);
});

test('a committed row edit conflicts once, then a fresh recognition can succeed and Undo', async () => {
  const f = await fixture(), run = await f.start(), input = f.query('[data-caption-text="0"]');
  input.value = 'Committed correction'; input.onchange();
  await f.finish(run);
  assert.equal(f.evaluate('state.captions[0].text'), 'Committed correction');
  assert.equal(f.query('[data-caption-text="0"]'), input);
  await f.finish(await f.start());
  assert.equal(f.evaluate('state.captions[0].text'), 'Recognized');
  vm.runInContext('undo()', f.context);
  assert.equal(f.evaluate('state.captions[0].text'), 'Committed correction');
});

for (const locale of ['ko', 'en', 'zh-CN']) test(`IME conflict and ready controls retain ${locale} localization`, async () => {
  try {
    const f = await fixture(), run = await f.start();
    assert.equal(setLocale(locale), true);
    const input = f.query('#captionFind');
    input.focus(); f.panel.oncompositionstart();
    await f.finish(run);
    assert.equal(f.query('#captionFind'), input);
    assert.equal(f.evaluate('state.captions[0].text'), 'Original');
    assert.equal(f.element('#toast').textContent, t('errors.transcriptionConflict'));
    assert.ok(f.query('#generateCaptions').innerHTML.includes(t('panels.generateCaptions')));
    f.panel.oncompositionend();
    await f.finish(await f.start());
    assert.equal(f.evaluate('state.captions[0].text'), 'Recognized');
    for (const ending of ['error', 'cancel']) {
      await f.finish(await f.start(), ending);
      assert.ok(f.query('#generateCaptions').innerHTML.includes(t('panels.generateCaptions')));
      assert.equal(f.query('#asrStatus').hidden, true);
      if (ending === 'cancel') assert.equal(f.element('#toast').textContent, t('errors.transcriptionCancelled'));
    }
  } finally { setLocale('ko'); }
});

test('successful recognition preserves tool drafts, choices and focused search selection', async () => {
  const f = await fixture();
  vm.runInContext('sources.audioFile=syntheticSource; state.captions=Array.from({length:51},()=>({start:0,end:1,text:"Original"})); renderPanel()', f.context);
  const run = await f.start();
  const values = { captionShiftDelta: '-.25', captionPageNumber: '9', captionChunkSize: '24',
    captionSource: 'audio', language: 'japanese', captionFind: 'Original', captionReplacement: 'Replacement' };
  for (const [id, value] of Object.entries(values)) {
    const input = f.query('#' + id); input.value = value;
    if (['captionFind', 'captionReplacement'].includes(id)) input.oninput();
  }
  const find = f.query('#captionFind'); find.focus(); find.setSelectionRange(1, 4);
  await f.finish(run);
  assert.equal(f.evaluate('state.captions[0].text'), 'Recognized');
  for (const [id, value] of Object.entries(values)) assert.equal(f.query('#' + id).value, value, id);
  assert.equal(f.doc.activeElement, f.query('#captionFind'));
  assert.equal(f.doc.activeElement.selectionStart, 1); assert.equal(f.doc.activeElement.selectionEnd, 4);
});

test('a draft added after the worker result but before its continuation is protected', async () => {
  const f = await fixture(), run = await f.start(), input = f.query('[data-caption-text="0"]');
  run.worker.onmessage({data:{type:'result',result:{chunks:[{timestamp:[0,1],text:'Recognized'}]}}});
  input.value = 'Queued human draft'; input.focus();
  await run.pending;
  assert.equal(f.query('[data-caption-text="0"]'), input);
  assert.equal(input.value, 'Queued human draft');
  assert.equal(f.evaluate('state.captions[0].text'), 'Original');
});

test('untouched finite timing and absent optional row metadata do not block recognition', async () => {
  const f = await fixture();
  vm.runInContext('state.captions[0].start=1e-7; renderPanel()', f.context);
  await f.finish(await f.start());
  assert.equal(f.evaluate('state.captions[0].text'), 'Recognized');
});

for (const caption of [
  { text: 'First\r\nSecond' }, { text: 'First\rSecond' }, { text: '\nLeading line' },
  { keywords: 'first\r\nsecond' },
]) test(`untouched HTML-normalized caption ${JSON.stringify(caption)} is not a draft`, async () => {
  const f = await fixture();
  f.context.normalizedCaption = caption;
  vm.runInContext('Object.assign(state.captions[0],normalizedCaption); renderPanel()', f.context);
  await f.finish(await f.start());
  assert.equal(f.evaluate('state.captions[0].text'), 'Recognized');
});

test('a normalized row remains protected after a real edit and accepts a committed retry', async () => {
  const f = await fixture();
  vm.runInContext("state.captions[0].text='First\\r\\nSecond'; renderPanel()", f.context);
  const run = await f.start(), input = f.query('[data-caption-text="0"]');
  input.value = 'Revised\nSecond';
  await f.finish(run);
  assert.equal(f.query('[data-caption-text="0"]'), input);
  assert.equal(input.value, 'Revised\nSecond');
  input.onchange();
  await f.finish(await f.start());
  assert.equal(f.evaluate('state.captions[0].text'), 'Recognized');
});
