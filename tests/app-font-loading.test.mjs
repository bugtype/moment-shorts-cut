import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

// Real app/composition owners, controlled font promises and raster API records.
// These are not downloaded fonts, native pixels or browser rendering timings.
async function fixture() {
  let epoch = 0, resolveReady;
  const fonts = { status: 'loaded', ready: Promise.resolve() };
  const f = await createAppFixture({ fontSet: fonts }), frames = [], canvases = [], downloads = [];
  const run = code => vm.runInContext(code, f.context);
  const originalCreate = f.doc.createElement;
  f.doc.createElement = tag => {
    if (tag !== 'canvas') return originalCreate(tag);
    const canvas = { epoch, writes: [] };
    const context = new Proxy({
      measureText: text => ({ width: String(text).length * (epoch ? 13 : 10) }),
      fillText: text => canvas.writes.push(text),
      drawImage(source) {
        if (source === f.element('#preview')) canvas.snapshot = frames.at(-1).uses.map(item => ({ ...item }));
      },
    }, { get: (target, key) => key in target ? target[key] : () => {} });
    canvas.getContext = () => context;
    canvas.toBlob = callback => { canvas.callback = callback; canvas.dimensions = [canvas.width, canvas.height]; };
    canvas.captureStream = () => ({ addTrack() {}, getTracks: () => [{ stop() {} }] });
    canvases.push(canvas); return canvas;
  };
  const composition = run('composition'), draw = composition.draw;
  composition.draw = (context, width, height, ...args) => {
    const uses = []; frames.push({ width, height, uses });
    const wrapped = new Proxy(context, {
      get(target, key) {
        if (key === 'drawImage') return (source, ...coordinates) => {
          if (source.writes) uses.push({ epoch: source.epoch, text: source.writes.join('|') });
          return target.drawImage(source, ...coordinates);
        };
        return target[key];
      },
      set(target, key, value) { target[key] = value; return true; },
    });
    return draw(wrapped, width, height, ...args);
  };
  run('composition.clear(); draw()');
  const start = () => { fonts.status = 'loading'; fonts.ready = new Promise(resolve => { resolveReady = resolve; }); return fonts.ready; };
  const finish = () => { ++epoch; fonts.status = 'loaded'; resolveReady(); };
  const flush = () => {
    for (const [id, callback] of [...f.pendingFrames]) { f.pendingFrames.delete(id); callback(performance.now()); }
  };
  f.context.captureDownload = (blob, name) => downloads.push({ blob, name }); run('download = captureDownload');
  return { ...f, fonts, frames, canvases, downloads, start, finish, flush, run };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const snapshot = f => f.evaluate('({state,current,history,future,playing})');

test('later font completion refreshes actual edited caption cache without touching the project or drafts', async () => {
  const f = await fixture(); f.start();
  const result = await f.context.window.moment.execute('captions.update', { captionIndex: 0, patch: { text: '쀍 늦게 불러온 글꼴' } });
  assert.equal(result.ok, true); f.flush();
  assert.ok(f.frames.at(-1).uses.some(item => item.text.includes('쀍') && item.epoch === 0));
  const before = snapshot(f), search = f.element('#templateSearch');
  search.value = '입력 중'; search.focus(); search.setSelectionRange(2, 3);
  const markup = f.element('#panelContent').innerHTML;
  f.finish(); await settle(); assert.equal(f.pendingFrames.size, 1); f.flush();
  assert.ok(f.frames.at(-1).uses.some(item => item.text.includes('쀍') && item.epoch === 1));
  assert.equal(f.pendingFrames.size, 0); assert.deepEqual(snapshot(f), before);
  assert.equal(f.doc.activeElement, search); assert.equal(search.value, '입력 중');
  assert.deepEqual([search.selectionStart, search.selectionEnd], [2, 3]);
  assert.equal(f.element('#panelContent').innerHTML, markup);
  const allocations = f.canvases.length; f.run('draw(); draw()');
  assert.equal(f.canvases.length, allocations); assert.equal(f.pendingFrames.size, 0);
});

test('actual export paints a fresh matching raster after fonts-ready and cancellation drains its owned repaint', async () => {
  const f = await fixture(), recorders = [];
  const track = () => ({ stop() {}, clone: track }), node = () => ({ gain: { value: 1 }, connect() {} });
  f.context.AudioContext = class {
    constructor() { this.destination = node(); }
    createMediaStreamDestination() { return { stream: { getAudioTracks: () => [track()] } }; }
    createMediaElementSource() { return node(); }
    createGain() { return node(); }
    async resume() {}
  };
  f.context.MediaRecorder = class {
    constructor() { this.state = 'inactive'; recorders.push(this); }
    start() { this.state = 'recording'; this.rasters = f.frames.at(-1); }
    stop() { this.state = 'inactive'; }
  };
  f.run('playback.paint(ctx,720,1280)');
  assert.ok(f.frames.at(-1).uses.length > 0); assert.ok(f.frames.at(-1).uses.every(item => item.epoch === 0));
  const before = f.evaluate('({state,history,future})'); f.start();
  const pending = f.run("startExport({mime:'video/webm',ext:'webm'},720)");
  await settle(); assert.equal(f.evaluate('exporting'), true); assert.equal(recorders.length, 0);
  f.finish(); await pending;
  assert.equal(recorders.length, 1); assert.equal(recorders[0].state, 'recording');
  assert.deepEqual([recorders[0].rasters.width, recorders[0].rasters.height], [720, 1280]);
  assert.ok(recorders[0].rasters.uses.length > 0); assert.ok(recorders[0].rasters.uses.every(item => item.epoch === 1));
  f.run('stopExport(true)'); f.flush(); assert.equal(f.evaluate('exporting'), false);
  assert.equal(f.pendingFrames.size, 0); assert.equal(recorders.length, 1);
  assert.deepEqual(f.evaluate('({state,history,future})'), before);
});

test('offscreen template paint before the observer continuation still requests exactly one main repaint', async () => {
  const f = await fixture(), before = snapshot(f), ready = f.start();
  let queued;
  const waiter = ready.then(() => {
    f.run("templatePreview.draw(document.createElement('canvas'), TEMPLATES[0])");
    queued = f.pendingFrames.size;
  });
  f.run('draw()'); f.finish(); await waiter; await settle();
  assert.equal(queued, 1); assert.equal(f.pendingFrames.size, 1);
  f.flush(); assert.equal(f.pendingFrames.size, 0);
  assert.ok(f.frames.at(-1).uses.length > 0); assert.ok(f.frames.at(-1).uses.every(item => item.epoch === 1));
  assert.deepEqual(snapshot(f), before);
});

test('pending Frame PNG keeps its displayed snapshot when a later font cycle repaints the main canvas', async () => {
  const f = await fixture(), before = snapshot(f);
  f.start(); f.run('draw(); savePreview()');
  const copy = f.canvases.find(canvas => canvas.callback);
  assert.ok(copy); assert.ok(copy.snapshot.length > 0); assert.ok(copy.snapshot.every(item => item.epoch === 0));
  f.finish(); await settle(); f.flush();
  assert.ok(f.frames.at(-1).uses.every(item => item.epoch === 1));
  copy.callback(new Blob(['display snapshot'], { type: 'image/png' }));
  assert.equal(f.downloads.length, 1); assert.deepEqual(copy.dimensions, [540, 960]);
  assert.ok(copy.snapshot.every(item => item.epoch === 0)); assert.deepEqual([copy.width, copy.height], [0, 0]);
  assert.deepEqual(snapshot(f), before); assert.equal(f.pendingFrames.size, 0);
});
