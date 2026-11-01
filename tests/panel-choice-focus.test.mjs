import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

// Fresh nodes and explicit focus calls model remount ownership, not native browser/AT behavior.
function freshChoices(f) {
  const root = f.element('#panelContent'), originalQuery = root.querySelector.bind(root);
  root.ownerDocument = f.doc; root.isConnected = true;
  let html = '', generation = 0, buttons = [], controls;
  const focusCalls = [];
  function parse(markup, owner) {
    return [...markup.matchAll(/<button\b[^>]*data-(caption-preset|scene-select)="([^"]+)"[^>]*>/g)].map(([tag, kind, value]) => {
      const attributes = new Map([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, text]) => [key, text]));
      return { dataset: { [kind === 'caption-preset' ? 'captionPreset' : 'sceneSelect']: value }, disabled: false,
        ownerDocument: f.doc,
        get isConnected() { return root.isConnected && generation === owner && buttons.includes(this); },
        getAttribute: key => attributes.get(key) ?? null,
        setAttribute: (key, value) => attributes.set(key, String(value)),
        focus() { assert.equal(this.isConnected, true); f.doc.activeElement = this; focusCalls.push(this); }
      };
    });
  }
  const matching = selector => buttons.filter(b => selector === '[data-caption-preset]' ? b.dataset.captionPreset : selector === '[data-scene-select]' ? b.dataset.sceneSelect : false);
  Object.defineProperty(root, 'innerHTML', { configurable: true, get: () => html, set(value) {
    if (buttons.includes(f.doc.activeElement)) f.doc.activeElement = f.doc.body;
    generation++; html = value; buttons = parse(value, generation);
    const owner = generation; let content = '';
    controls = { ownerDocument: f.doc, get isConnected() { return owner === generation && root.isConnected; },
      querySelector: selector => f.element(`choice-generation-${owner} ${selector}`), querySelectorAll: matching };
    Object.defineProperty(controls, 'innerHTML', { get: () => content, set(value) { content = value; buttons = parse(value, owner); } });
  } });
  root.querySelector = selector => selector === '#effectControls' ? controls : originalQuery(selector);
  root.querySelectorAll = matching;
  return { root, focusCalls, buttons: () => buttons,
    button: value => buttons.find(b => (b.dataset.captionPreset || b.dataset.sceneSelect) === value) };
}
async function fixture(kind, locale = 'ko') {
  const f = await createAppFixture(), dom = freshChoices(f);
  vm.runInContext(`setLocale('${locale}',{persist:false});state.overlays=[{...newCard(12),id:'first',start:0,end:3},{...newCard(12),id:'second',start:4,end:7}];state.speed=2;selectedCard='first';textLayer='caption';effectTab='cards';history=[];future=[];current=1;globalThis.choiceSaves=0;scheduleSave=()=>choiceSaves++;switchPanel('${kind === 'caption' ? 'text' : 'effects'}')`, f.context);
  return { ...f, ...dom, kind, value: kind === 'caption' ? 'minimal' : 'second' };
}
const snapshot = f => f.evaluate('({state,history,future,current,selectedCard,playing,playRequest,choiceSaves})');

for (const kind of ['caption', 'scene']) for (const locale of ['ko', 'en', 'zh-CN']) {
  test(`${locale}: ${kind} selection exposes pressed state and focuses its new selected control`, async () => {
    const f = await fixture(kind, locale), old = f.button(f.value);
    assert.equal(f.buttons().filter(b => b.getAttribute('aria-pressed') === 'true').length, 1);
    assert.ok(f.buttons().every(b => ['true', 'false'].includes(b.getAttribute('aria-pressed'))));
    old.focus(); old.onclick({});
    const replacement = f.button(f.value);
    assert.notEqual(replacement, old); assert.equal(old.isConnected, false);
    assert.equal(replacement.getAttribute('aria-pressed'), 'true');
    assert.equal(f.buttons().filter(b => b.getAttribute('aria-pressed') === 'true').length, 1);
    assert.equal(f.doc.activeElement, replacement);
  });
}

test('caption preset reapplication retains style reset, one edit and exact Undo/Redo', async () => {
  const f = await fixture('caption');
  vm.runInContext("state.style='minimal';state.captionItalic=true;state.captionStroke=8;renderPanel()", f.context);
  const before = f.evaluate('state'); f.button('minimal').focus(); f.button('minimal').onclick({});
  assert.equal(f.evaluate('state.style'), 'minimal'); assert.equal(f.evaluate('state.captionItalic'), false);
  assert.equal(f.evaluate('state.captionStroke'), 2); assert.equal(f.evaluate('history.length'), 1); assert.equal(f.evaluate('choiceSaves'), 1);
  const after = f.evaluate('state');
  f.element('#undoButton').onclick(); assert.deepEqual(f.evaluate('state'), before);
  f.element('#redoButton').onclick(); assert.deepEqual(f.evaluate('state'), after);
});

test('scene selection retains pause and output-clock seek without editing or saving', async () => {
  const f = await fixture('scene'); await vm.runInContext('play()', f.context);
  const before = f.evaluate('({state,history,future,choiceSaves})');
  f.button('second').focus(); f.button('second').onclick({});
  assert.equal(f.evaluate('selectedCard'), 'second'); assert.equal(f.evaluate('playing'), false);
  assert.equal(f.evaluate('current'), 8.4); assert.equal(f.pendingFrames.size, 0);
  assert.deepEqual(f.evaluate('({state,history,future,choiceSaves})'), before);
});

for (const kind of ['caption', 'scene']) {
  test(`${kind}: stale controls cannot change project, seek or focus`, async () => {
    const f = await fixture(kind), stale = f.button(f.value);
    vm.runInContext('renderPanel()', f.context);
    const before = snapshot(f), focuses = f.focusCalls.length;
    stale.onclick({}); assert.deepEqual(snapshot(f), before); assert.equal(f.focusCalls.length, focuses);
  });
  test(`${kind}: programmatic activation leaves external focus alone`, async () => {
    const f = await fixture(kind), outside = f.element('#projectName'); outside.focus();
    f.button(f.value).onclick({}); assert.equal(f.doc.activeElement, outside); assert.equal(f.focusCalls.length, 0);
  });
  test(`${kind}: modal and composition guards preserve selection and focus`, async () => {
    const f = await fixture(kind), button = f.button(f.value); button.focus();
    const before = snapshot(f);
    button.onclick({ isComposing: true }); assert.deepEqual(snapshot(f), before);
    button.onclick({ keyCode: 229 }); assert.deepEqual(snapshot(f), before);
    vm.runInContext("modalOpen('Other','Other')", f.context);
    button.onclick({}); assert.deepEqual(snapshot(f), before);
  });
}
