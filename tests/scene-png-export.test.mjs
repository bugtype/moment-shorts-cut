import test from 'node:test';
import assert from 'node:assert/strict';
import { createScenePngExport } from '../dist/scene-png-export.mjs';
import { createDemoProject } from '../dist/core/project.mjs';

function fixture({ failCanvas = false, nullContext = false, noEncoder = false } = {}) {
  const canvases = [], paints = [], downloads = [], toasts = [];
  const native = () => ({ paused: true, seeking: false, readyState: 2, error: null,
    src: 'blob:source', currentSrc: 'blob:source', currentTime: 1, videoWidth: 1920, videoHeight: 1080 });
  const app = {
    state: createDemoProject(), current: 1, playRequest: 0, playing: false,
    editorReady: true, exporting: false, loadingMedia: false, transcribing: false,
    audioRecording: { requesting: false, current: null },
    sources: { videoFile: {}, audioFile: null, sourceURL: 'blob:source', audioURL: '' },
    video: native(), audio: native(), sample: { complete: true }, sampleRaster: {},
    mediaReady: () => true,
    pause() { this.playRequest++; this.playing = false; this.video.paused = this.audio.paused = true; this.pauses++; },
    pauses: 0,
    playback: { paint: (...args) => paints.push(args) },
    download: (...args) => downloads.push(args), toast: value => toasts.push(value),
  };
  let fonts = true;
  const factory = createScenePngExport(app, {
    fontsLoaded: () => fonts,
    createCanvas: () => {
      if (failCanvas) throw new Error('create canvas');
      const canvas = { width: 0, height: 0, context: {},
        getContext() { return nullContext ? null : this.context; },
        toBlob(callback, type) { this.callback = callback; this.type = type; },
      };
      if (noEncoder) canvas.toBlob = undefined;
      canvases.push(canvas);
      return canvas;
    },
  });
  return { app, factory, canvases, paints, downloads, toasts, setFonts: value => { fonts = value; } };
}
const png = () => new Blob(['png'], { type: 'image/png' });

test('pauses then repaints private export geometry, preserving project/history and native clocks', () => {
  for (const [ratio, quality, width, height] of [['9:16', 1080, 1080, 1920], ['4:5', 720, 720, 900], ['1:1', 1080, 1080, 1080], ['16:9', 720, 1280, 720]]) {
    const f = fixture();
    f.app.state.ratio = ratio;
    f.app.playing = true;
    f.app.video.paused = false;
    const before = structuredClone(f.app.state);
    assert.equal(f.factory.save(quality), true);
    const canvas = f.canvases[0];
    assert.equal(f.app.pauses, 1);
    assert.equal(f.app.playing, false);
    assert.deepEqual(f.paints, [[canvas.context, width, height]]);
    assert.equal(canvas.type, 'image/png');
    canvas.callback(png());
    assert.equal(f.downloads[0][1], `${before.name}.scene-${width}x${height}.png`);
    assert.deepEqual([canvas.width, canvas.height], [0, 0]);
    assert.deepEqual(f.app.state, before);
    assert.equal(f.app.current, 1);
    assert.equal(f.app.video.currentTime, 1);
  }
});

test('invalid quality, busy, fonts and native readiness reject before pausing or allocating', () => {
  const changes = [
    f => { f.app.editorReady = false; }, f => { f.app.exporting = true; },
    f => { f.app.loadingMedia = true; }, f => { f.app.transcribing = true; },
    f => { f.app.audioRecording.requesting = true; }, f => { f.app.audioRecording.current = {}; },
    f => { f.app.mediaReady = () => false; }, f => f.setFonts(false),
    f => { f.app.sample.complete = false; },
    f => { f.app.state.kind = 'video'; f.app.video.seeking = true; },
    f => { f.app.state.kind = 'video'; f.app.video.readyState = 1; },
    f => { f.app.sources.audioFile = {}; f.app.audio.error = {}; },
  ];
  for (const change of changes) {
    const f = fixture(); change(f);
    assert.equal(f.factory.save(1080), false);
    assert.equal(f.app.pauses, 0);
    assert.equal(f.canvases.length, 0);
  }
  for (const quality of [0, 900, '1080', null, undefined]) {
    const f = fixture();
    assert.equal(f.factory.save(quality), false);
    assert.equal(f.app.pauses, 0);
  }
});

test('async completion rejects all changed owners including play then pause at the same clock', () => {
  const changes = [
    f => { f.app.state = structuredClone(f.app.state); },
    f => { f.app.state.name = 'changed'; }, f => { f.app.current++; },
    f => { f.app.sources.videoFile = {}; }, f => { f.app.sources.audioFile = {}; },
    f => { f.app.sources.sourceURL = 'new'; }, f => { f.app.video.currentSrc = 'new'; },
    f => { f.app.video.src = 'new'; }, f => { f.app.video.currentTime++; },
    f => { f.app.video.videoWidth++; }, f => { f.app.sampleRaster = {}; },
    f => { f.app.playRequest++; f.app.pause(); }, f => { f.app.exporting = true; },
    f => { f.app.mediaReady = () => false; }, f => f.setFonts(false),
  ];
  for (const change of changes) {
    const f = fixture(); assert.equal(f.factory.save(1080), true);
    const canvas = f.canvases[0]; change(f); canvas.callback(png());
    assert.equal(f.downloads.length, 0);
    assert.equal(f.toasts.length, 0);
    assert.deepEqual([canvas.width, canvas.height], [0, 0]);
  }
});

test('new requests release older surfaces and ignore old success/failure callbacks', () => {
  const f = fixture();
  f.factory.save(720);
  const old = f.canvases[0];
  f.factory.save(1080);
  assert.deepEqual([old.width, old.height], [0, 0]);
  old.callback(null);
  old.callback(png());
  assert.equal(f.toasts.length, 0);
  f.canvases[1].callback(png());
  assert.equal(f.downloads.length, 1);
});

test('null, empty, wrong MIME, synchronous paint/encoder and download errors release private surfaces', () => {
  for (const blob of [null, new Blob([], { type: 'image/png' }), new Blob(['x'], { type: 'text/plain' })]) {
    const f = fixture(); f.factory.save(720); f.canvases[0].callback(blob);
    assert.equal(f.downloads.length, 0);
    assert.equal(f.toasts.length, 1);
    assert.deepEqual([f.canvases[0].width, f.canvases[0].height], [0, 0]);
  }
  for (const failure of ['paint', 'encoder', 'context', 'download']) {
    const f = fixture();
    if (failure === 'paint') f.app.playback.paint = () => { throw new Error('SecurityError'); };
    if (failure === 'download') f.app.download = () => { throw new Error('download'); };
    const originalPaint = f.app.playback.paint;
    f.app.playback.paint = (...args) => {
      originalPaint(...args);
      if (failure === 'encoder') f.canvases[0].toBlob = () => { throw new Error('SecurityError'); };
    };
    if (failure === 'context') {
      f.app.pause = () => { f.app.playRequest++; f.app.video.paused = false; };
      assert.equal(f.factory.save(720), false);
      assert.equal(f.canvases.length, 0);
      continue;
    }
    const started = f.factory.save(720);
    if (failure === 'download') { assert.equal(started, true); f.canvases[0].callback(png()); }
    else assert.equal(started, false);
    assert.equal(f.toasts.length, 1);
    assert.deepEqual([f.canvases[0].width, f.canvases[0].height], [0, 0]);
  }
});


test('canvas construction, missing context/encoder, and unavailable native video fail without leaking surfaces', () => {
  for (const options of [{ failCanvas: true }, { nullContext: true }, { noEncoder: true }]) {
    const f = fixture(options);
    assert.equal(f.factory.save(1080), false);
    assert.equal(f.toasts.length, 1);
    for (const canvas of f.canvases) assert.deepEqual([canvas.width, canvas.height], [0, 0]);
  }
  for (const field of ['error', 'videoWidth', 'videoHeight']) {
    const f = fixture();
    f.app.state.kind = 'video';
    f.app.video[field] = field === 'error' ? {} : 0;
    assert.equal(f.factory.save(720), false);
    assert.equal(f.app.pauses, 0);
  }
});

test('native time is captured after pause and session media permission never mutates persistence', () => {
  const f = fixture();
  f.app.state.kind = 'video';
  f.app.persistence = Object.freeze({ restorePhase: 'failed', recoveryValid: true });
  f.app.sources.audioFile = {};
  f.app.playing = true;
  f.app.video.paused = f.app.audio.paused = false;
  const pause = f.app.pause.bind(f.app);
  f.app.pause = () => { pause(); f.app.video.currentTime = 1.01; };
  assert.equal(f.factory.save(1080), true);
  f.canvases[0].callback(png());
  assert.equal(f.downloads.length, 1);
  assert.deepEqual(f.app.persistence, { restorePhase: 'failed', recoveryValid: true });
});
