import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {createScenePngExport} from '../dist/scene-png-export.mjs';

// Model image availability and native drawImage failure, not a real decoder.
async function fixture() {
  const f = await createAppFixture(), app = vm.runInContext('app', f.context);
  const counts = {raw:0, raster:0, video:0, background:0};
  const invalid = Object.assign(new Error('broken image'), {name:'InvalidStateError'});
  let broken = false, rasterError;
  const guard = context => new Proxy(context, {get(target, key) {
    if (key === 'fillRect') return (...args) => { counts.background++; return target.fillRect(...args); };
    if (key === 'drawImage') return (source, ...args) => {
      if (source === app.sample) {
        counts.raw++;
        if (broken) throw invalid;
        if (rasterError) throw rasterError;
      }
      if (source === app.sampleRaster) counts.raster++;
      if (source === app.video) counts.video++;
      return target.drawImage(source, ...args);
    };
    return Reflect.get(target, key);
  }});
  const draw = app.composition.draw;
  app.composition.draw = (context, ...args) => draw(guard(context), ...args);
  const create = f.doc.createElement;
  f.doc.createElement = (...args) => {
    const canvas = create(...args), context = canvas.getContext();
    canvas.getContext = () => guard(context);
    return canvas;
  };
  return {...f, app, counts, invalid,
    image(complete, failed = false) {
      broken = failed;
      Object.assign(app.sample, {complete, naturalWidth:0, naturalHeight:0});
    },
    failRaster: error => { rasterError = error; },
  };
}
const snapshot = f => f.evaluate('({state,history,future,selected,timer:persistence.saveTimer})');

test('loading, broken and pending-load samples use fallback; a broken image cannot strand playback', async () => {
  const f = await fixture(), before = snapshot(f), focus = f.doc.activeElement;
  let allocations = 0;
  const png = createScenePngExport(f.app, {fontsLoaded:()=>true, createCanvas:()=>{ allocations++; throw Error('unexpected allocation'); }});
  for (const [complete, broken] of [[false,false], [true,true], [true,false]]) {
    f.image(complete, broken);
    assert.doesNotThrow(() => vm.runInContext('draw();templatePreview.draw(document.createElement("canvas"),TEMPLATES[0]);', f.context));
    assert.equal(f.counts.raw, 0);
    assert.ok(f.counts.background > 0);
    const scene = vm.runInContext('createTemplateScene(app)', f.context);
    assert.equal(scene.canCapture(), false); assert.equal(scene.capture(), null);
    const request = f.evaluate('playRequest');
    assert.equal(png.save(720), false); assert.equal(allocations, 0);
    assert.equal(f.evaluate('playRequest'), request, 'unavailable scene refuses before pausing');
    assert.deepEqual(snapshot(f), before); assert.equal(f.doc.activeElement, focus);
  }
  f.image(true, true);
  vm.runInContext('ensureAudio=async()=>{}', f.context);
  await vm.runInContext('play()', f.context);
  const id = f.evaluate('frameHandle'), callback = f.pendingFrames.get(id);
  assert.equal(typeof callback, 'function'); f.pendingFrames.delete(id);
  assert.doesNotThrow(() => callback(performance.now()));
  assert.equal(f.evaluate('playing'), true);
  assert.equal(f.pendingFrames.size, 1); assert.ok(f.pendingFrames.has(f.evaluate('frameHandle')));
  vm.runInContext('pause()', f.context); assert.equal(f.pendingFrames.size, 0);
  assert.deepEqual(snapshot(f), before);
});

test('successful SVG raster publication restores draw/capture; failed rasterization stays unpublished and video is independent', async () => {
  const f = await fixture(), before = snapshot(f), failure = new Error('raster draw failed');
  f.image(true); f.failRaster(failure);
  assert.throws(() => f.app.sample.onload(), error => error === failure);
  assert.equal(f.app.sampleRaster, null); assert.equal(f.pendingFrames.size, 0);
  f.failRaster(undefined);
  // A valid viewBox-only SVG need not be judged by an assumed intrinsic size.
  f.app.sample.onload();
  const raster = f.app.sampleRaster;
  assert.deepEqual([raster.width,raster.height],[540,960]); assert.equal(f.pendingFrames.size, 1);
  for (const [id, callback] of f.pendingFrames) { f.pendingFrames.delete(id); callback(performance.now()); }
  assert.ok(f.counts.raster > 0); assert.equal(f.pendingFrames.size, 0);
  const painted = f.counts.raster;
  vm.runInContext('templatePreview.draw(document.createElement("canvas"),TEMPLATES[0])', f.context);
  assert.ok(f.counts.raster > painted, 'loaded template previews use the published raster');
  f.failRaster(failure);
  assert.throws(() => f.app.sample.onload(), error => error === failure);
  assert.equal(f.app.sampleRaster, raster, 'a failed repeat cannot publish a partial replacement');
  assert.equal(f.pendingFrames.size, 0); f.failRaster(undefined);
  const scene = vm.runInContext('createTemplateScene(app)', f.context);
  assert.equal(scene.canCapture(), true); const captured = scene.capture(); assert.ok(captured); captured.release();
  f.app.video.paused = f.app.audio.paused = true;
  const downloads = []; f.app.download = (...args) => downloads.push(args);
  const png = createScenePngExport(f.app, {fontsLoaded:()=>true, createCanvas:()=>{
    const canvas = f.doc.createElement('canvas');
    canvas.toBlob = callback => callback(new Blob(['synthetic PNG'], {type:'image/png'})); return canvas;
  }});
  assert.equal(png.save(720), true); assert.equal(downloads.length, 1);
  assert.deepEqual([raster.width,raster.height],[540,960]);
  f.image(false); assert.equal(scene.canCapture(), false, 'existing incomplete-image fence remains');
  f.image(true, true); f.app.sampleRaster = null;
  vm.runInContext("state.kind='video';video.videoWidth=1920;video.videoHeight=1080;video.readyState=4;",f.context);
  assert.doesNotThrow(() => vm.runInContext('draw()', f.context)); assert.equal(f.counts.video, 1);
  vm.runInContext("state.kind='demo'",f.context); assert.deepEqual(snapshot(f), before);
});
