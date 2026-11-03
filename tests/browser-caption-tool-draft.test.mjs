import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { parseSubtitles } from '../dist/captions.mjs';
import { splitCaptionAtOffset } from '../dist/caption-splitting.mjs';
import { decimalTime } from '../dist/ui-format.mjs';
import { initLocale, getLocale, t } from '../dist/i18n.mjs';

// Model only panel descendant replacement and current input values, not native
// focus/change ordering, IME, media decoding or the transcription model.
async function fixture(locale = 'ko', caption = {start:0,end:1,text:'Original'}) {
  const f = await createAppFixture();
  initLocale({languages:[locale],storage:null,document:f.doc});
  assert.equal(getLocale(),locale);assert.equal(f.doc.documentElement.lang,locale);
  const panel = f.element('#panelContent');
  const originalQuery = f.doc.querySelector, originalAll = f.doc.querySelectorAll;
  let controls = new Map(), rows = [], splitButtons = [], mergeButtons = [], markup = '', generation = 0;
  const query = selector => controls.get(selector) || originalQuery(selector);
  f.doc.querySelector = query;
  f.doc.querySelectorAll = selector => {
    if (selector === '[data-split-caption]') return splitButtons;
    if (selector === '[data-merge-caption]') return mergeButtons;
    const field = selector.match(/^\[data-caption-(text|start|end|keywords|speaker)\]$/)?.[1];
    return field ? rows.map(row => row[field]) : originalAll(selector);
  };
  panel.querySelector = query;
  Object.defineProperty(panel, 'innerHTML', { configurable: true, get: () => markup, set: value => {
    markup = value; controls = new Map(); rows = []; splitButtons = []; mergeButtons = []; generation++;
    const node = key => f.element(`api-draft-${generation}-${key}`);
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
    for (const [, index, contents] of value.matchAll(/<textarea data-caption-text="(\d+)"[^>]*>([\s\S]*?)<\/textarea>/g)) {
      const row = {};
      for (const field of ['text', 'start', 'end', 'keywords', 'speaker']) {
        const el = node(`${field}-${index}`), caption = captions[index];
        el.dataset['caption' + field[0].toUpperCase() + field.slice(1)] = index;
        el.value = ['start', 'end'].includes(field) ? decimalTime(caption[field]) : String(caption[field] ?? '');
        // HTML textarea parsing drops one initial LF; API values normalize CR,
        // and RCDATA parsing replaces NUL; single-line inputs strip line breaks.
        // This models the parsing contract, not a native DOM run.
        if (field === 'text') el.value = contents.replace(/&(amp|lt|gt|quot|#39);/g,
          (_, key) => ({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[key]))
          .replace(/\r\n?/g, '\n').replace(/\0/g, '\ufffd').replace(/^\n/, '');
        if (field === 'keywords') el.value = el.value.replace(/[\r\n]/g, '');
        controls.set(`[data-caption-${field}="${index}"]`, el); row[field] = el;
      }
      rows.push(row);
    }
    for (const [, index] of value.matchAll(/data-split-caption="(\d+)"/g)) {
      const button = node(`split-${index}`); button.dataset.splitCaption = index;
      controls.set(`[data-split-caption="${index}"]`, button); splitButtons.push(button);
    }
    for (const [, index] of value.matchAll(/data-merge-caption="(\d+)"/g)) {
      const button = node(`merge-${index}`); button.dataset.mergeCaption = index;
      controls.set(`[data-merge-caption="${index}"]`, button); mergeButtons.push(button);
    }
  }});
  f.context.seedCaption = caption;
  vm.runInContext("state.captions=[seedCaption]; switchPanel('captions'); history=[]; future=[];", f.context);
  return {...f, query, panel};
}

for(const locale of ['ko','en','zh-CN']) test(`live caption shift tool draft survives API remount (${locale})`,async()=>{
 try {for(const value of ['0.5','-0.25','']) {
  const f=await fixture(locale),old=f.query('#captionShiftDelta');f.query('#captionTools').open=true;
  assert.match(f.panel.innerHTML,/id="captionShiftDelta" type="number" step="any"/);
  old.value=value;old.focus();old.oninput?.({target:old});const captions=f.evaluate('state.captions');
  const result=await f.context.window.moment.execute('effects.update',{patch:{brightness:1.1}});
  assert.equal(result.ok,true);assert.notEqual(f.query('#captionShiftDelta'),old);
  assert.equal(f.query('#captionShiftDelta').value,value);assert.deepEqual(f.evaluate('state.captions'),captions);
  assert.equal(f.evaluate('history.length'),1);
 }} finally {initLocale();}
});

test('retained shift text applies only through existing explicit action and remains undoable',async()=>{
 const f=await fixture('en'),before=f.evaluate('state.captions'),input=f.query('#captionShiftDelta');
 input.value='0.5';input.oninput?.();assert.deepEqual(f.evaluate('state.captions'),before);
 await f.context.window.moment.execute('effects.update',{patch:{brightness:1.1}});
 f.query('#captionShiftDelta').onchange();f.query('#shiftCaptionTiming').onclick();
 assert.equal(f.evaluate('state.captions[0].start'),0.5);assert.equal(f.evaluate('state.captions[0].end'),1.5);
 vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state.captions'),before);
});

test('composition still blocks commands and shift until it ends',async()=>{
 const f=await fixture('en'),before=f.evaluate('state.captions'),input=f.query('#captionShiftDelta');
 f.panel.oncompositionstart();input.value='0.5';input.oninput?.();
 const refused=await f.context.window.moment.execute('effects.update',{patch:{brightness:1.1}});
 assert.equal(refused.error.code,'CONFLICT');assert.equal(f.query('#captionShiftDelta'),input);
 f.query('#shiftCaptionTiming').onclick();assert.deepEqual(f.evaluate('state.captions'),before);
 f.panel.oncompositionend();
 assert.equal((await f.context.window.moment.execute('effects.update',{patch:{brightness:1.1}})).ok,true);
 assert.equal(f.query('#captionShiftDelta').value,'0.5');assert.deepEqual(f.evaluate('state.captions'),before);
});

test('empty numeric intermediate value survives remount but cannot apply a shift',async()=>{
 const f=await fixture('en'),before=f.evaluate('state.captions'),input=f.query('#captionShiftDelta');
 input.value='';input.oninput?.();
 assert.equal((await f.context.window.moment.execute('effects.update',{patch:{brightness:1.1}})).ok,true);
 assert.equal(f.query('#captionShiftDelta').value,'');const history=f.evaluate('history.length');
 f.query('#shiftCaptionTiming').onclick();assert.deepEqual(f.evaluate('state.captions'),before);
 assert.equal(f.evaluate('history.length'),history);
});
