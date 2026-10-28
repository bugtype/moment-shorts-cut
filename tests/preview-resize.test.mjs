import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createPlayback} from '../dist/playback.mjs';
import {createDemoProject} from '../dist/core/project.mjs';
import {createAppFixture} from './fixtures/app.mjs';

const dimensions = {'9:16': [540, 960], '4:5': [540, 675], '1:1': [960, 960], '16:9': [960, 540]};
const defaults = () => ({transform: [1, 0, 0, 1, 0, 0], clip: null, alpha: 1, filter: 'none', stack: [], path: []});

// Model the native dimension setter's reset, not actual raster allocation or pixels.
function resizeFixture(ratio, initial, {exporting = false, fault = ''} = {}) {
  const project = createDemoProject(); project.ratio = ratio;
  const writes = [], trace = [], error = Error(fault);
  const ctx = {state: {transform: [2, 0, 0, 2, 10, 10], clip: 'old', alpha: .2, filter: 'blur(5px)', stack: ['old'], path: ['old']},
    drawImage(...args) { trace.push(['downscale', args.slice(1)]); assert.deepEqual(this.state, defaults()); }};
  let width = initial[0], height = initial[1];
  const canvas = {};
  for (const key of ['width', 'height']) Object.defineProperty(canvas, key, {
    get: () => key === 'width' ? width : height,
    set(value) {
      writes.push([key, value]);
      if (fault === key) throw error;
      const converted = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) >>> 0 : 0;
      if (key === 'width') width = converted; else height = converted;
      ctx.state = defaults();
    },
  });
  const wrap = {style: {}}, stage = {clientWidth: 1000, clientHeight: 800};
  const exportContext = {}, exportCanvas = {width: 1080, height: 1920};
  const app = {state: project, current: 2, canvas, ctx, exporting,
    videoExport: {context: exporting ? exportContext : null, canvas: exportCanvas, renderOptions: {includeCaptions: false}},
    sample: {complete: true}, video: {}, locate: () => ({index: 0, source: 2}), duration: () => 12, mediaReady: () => true,
    query(id) { trace.push(['query', id]); if (fault === 'query') throw error; return id === '#canvasWrap' ? wrap : stage; },
    composition: {draw(target, w, h) {
      trace.push(['paint', target === exportContext ? 'export' : 'preview', w, h]);
      assert.deepEqual(ctx.state, defaults(), 'even an unchanged size must reset dirty context state');
      if (fault === 'paint') throw error;
    }},
    syncPanelSheet() { trace.push(['sheet']); if (fault === 'sheet') throw error; },
  };
  return {resize: createPlayback(app).resizePreview, canvas, ctx, writes, trace, error, wrap, exportCanvas};
}

test('preview resizing skips only redundant width resets while preserving every ratio and export paint', () => {
  for (const [from, initial] of Object.entries(dimensions)) for (const [ratio, next] of Object.entries(dimensions)) {
    for (const exporting of [false, true]) {
      const f = resizeFixture(ratio, initial, {exporting}); f.resize();
      assert.deepEqual([f.canvas.width, f.canvas.height], next, `${from} to ${ratio}`);
      assert.deepEqual(f.writes, [...(initial[0] === next[0] ? [] : [['width', next[0]]]), ['height', next[1]]]);
      assert.deepEqual(f.ctx.state, defaults());
      assert.deepEqual(f.trace, [
        ['query', '#canvasWrap'], ['query', '#stage'],
        ['paint', exporting ? 'export' : 'preview', ...(exporting ? [1080, 1920] : next)],
        ...(exporting ? [['downscale', [0, 0, ...next]]] : []), ['sheet'],
      ]);
      assert.deepEqual(f.exportCanvas, {width: 1080, height: 1920});
      assert.equal(f.wrap.style.aspectRatio, ratio.replace(':', '/'));
      assert.equal(f.wrap.style.width, 'auto');
    }
  }
});

test('initial dimension normalization and failures retain the required reset and original error', () => {
  for (const width of [300, 540.5, '540', undefined, NaN]) {
    const f = resizeFixture('9:16', [width, 150]); f.resize();
    assert.deepEqual(f.writes, [['width', 540], ['height', 960]]);
    assert.deepEqual([f.canvas.width, f.canvas.height], [540, 960]);
  }
  for (const fault of ['query', 'paint', 'sheet']) {
    const f = resizeFixture('9:16', [540, 960], {fault});
    assert.throws(f.resize, error => error === f.error);
    assert.deepEqual(f.writes, [['height', 960]]);
    assert.deepEqual(f.ctx.state, defaults());
    assert.equal(f.trace.some(row => row[0] === 'sheet'), fault === 'sheet');
  }
  const changed = resizeFixture('1:1', [540, 960], {fault: 'width'});
  assert.throws(changed.resize, error => error === changed.error);
  assert.deepEqual(changed.writes, [['width', 960]]); assert.deepEqual(changed.trace, []);
});

test('actual command, Undo/Redo and window resize retain drawing cadence and current PNG dimensions', async () => {
  const f = await createAppFixture(), events = new Map();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  f.context.window.addEventListener = (name, handler) => events.set(name, handler);
  vm.runInContext("bind();state=initial();history=[];future=[];current=2;resizePreview();switchPanel('settings');", f.context);
  f.pendingFrames.clear(); vm.runInContext('paintHandle=0;', f.context);
  const canvas = f.element('#preview'), writes = [], paints = [];
  for (const key of ['width', 'height']) {
    let value = canvas[key];
    Object.defineProperty(canvas, key, {configurable: true, get: () => value, set(next) { writes.push([key, next]); value = next; }});
  }
  f.context.observePaint = (width, height) => paints.push([width, height]);
  vm.runInContext('globalThis.savedCompositionDraw=composition.draw;composition.draw=(...args)=>{observePaint(args[1],args[2]);return savedCompositionDraw(...args);};', f.context);
  const flush = () => { for (const [id, callback] of [...f.pendingFrames]) { f.pendingFrames.delete(id); callback(1000); } };
  const check = (widthChanged, next, count = 3) => {
    assert.deepEqual(writes, [...(widthChanged ? [['width', next[0]]] : []), ['height', next[1]]]);
    assert.equal(paints.length, count === 3 ? 2 : 1, 'same synchronous paint calls');
    assert.equal(f.pendingFrames.size, count === 3 ? 1 : 0, 'same deferred paint ownership');
    flush(); assert.deepEqual(paints, Array.from({length: count}, () => next));
    writes.length = 0; paints.length = 0;
  };
  const result = await f.context.window.moment.execute('title.update', {patch: {lines: ['한글 👨‍👩‍👧‍👦', 'é']}});
  assert.equal(result.ok, true); assert.equal(f.evaluate('history.length'), 1); check(false, [540, 960]);
  f.element('#undoButton').onclick(); assert.deepEqual(f.evaluate('state.design.title.lines'), createDemoProject().design.title.lines); check(false, [540, 960]);
  f.element('#redoButton').onclick(); assert.deepEqual(f.evaluate('state.design.title.lines'), ['한글 👨‍👩‍👧‍👦', 'é']); check(false, [540, 960]);
  for (const ratio of ['4:5', '1:1', '16:9', '9:16']) {
    const before = canvas.width, next = dimensions[ratio];
    assert.equal((await f.context.window.moment.execute('project.update', {patch: {ratio}})).ok, true);
    check(before !== next[0], next);
    const state = f.evaluate('({state,history,future,current,selected})');
    events.get('resize')(); check(false, next, 1);
    assert.deepEqual(f.evaluate('({state,history,future,current,selected})'), state);
    const encodes = [], downloads = [], create = f.doc.createElement;
    f.doc.createElement = tag => {
      const node = create(tag);
      if (tag === 'canvas') node.toBlob = callback => { encodes.push([node.width, node.height]); callback(new Blob(['png'], {type: 'image/png'})); };
      return node;
    };
    f.context.collectPng = (_blob, name) => downloads.push(name); vm.runInContext('download=collectPng;', f.context);
    f.element('#savePreviewPng').onclick();
    assert.deepEqual(encodes, [next]); assert.equal(downloads.length, 1);
    assert.ok(downloads[0].endsWith(`.preview-${next[0]}x${next[1]}.png`));
    for (const attribute of ['title', 'aria-label'])
      assert.match(f.element('#savePreviewPng').getAttribute(attribute), new RegExp(`${next[0]}.*${next[1]}`));
    f.doc.createElement = create;
  }
});
