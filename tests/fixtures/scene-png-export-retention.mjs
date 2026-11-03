import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createScenePngExport } from '../../dist/scene-png-export.mjs';
import { createDemoProject } from '../../dist/core/project.mjs';

// Explicit-GC JS reachability only; no browser backing-store or encoding claim.
const mode = process.argv[2];
let callback;
const native = () => ({ paused: true, seeking: false, readyState: 2, error: null,
  src: 'blob:source', currentSrc: 'blob:source', currentTime: 1, videoWidth: 1920, videoHeight: 1080 });
const app = {
  state: createDemoProject(), current: 1, playRequest: 0, playing: false,
  editorReady: true, exporting: false, loadingMedia: false, transcribing: false,
  audioRecording: {}, sources: { videoFile: new Blob(['video']), audioFile: new Blob(['audio']),
    sourceURL: 'blob:source', audioURL: 'blob:audio' },
  video: native(), audio: native(), sample: { complete: true }, sampleRaster: {},
  mediaReady: () => true, pause() { this.playRequest++; },
  playback: { paint() { if (mode === 'paint-error') throw new Error('paint'); } },
  download() {
    if (mode === 'download-error') throw new Error('download');
    if (mode === 'reentrant') assert.equal(owner.save(1080), true);
  }, toast() {},
};
const refs = Object.fromEntries(Object.entries({ project: app.state, video: app.sources.videoFile,
  audio: app.sources.audioFile, raster: app.sampleRaster }).map(([key, value]) => [key, new WeakRef(value)]));
const owner = createScenePngExport(app, {
  fontsLoaded: () => true,
  createCanvas: () => ({ getContext() { return {}; }, toBlob(fn) {
    if (mode === 'encoder-error') throw new Error('encoder');
    callback = fn;
  } }),
});
const started = owner.save(720);
assert.equal(started, !['paint-error', 'encoder-error'].includes(mode));
if (mode === 'stale') app.current++;
if (callback && mode !== 'pending') {
  callback(mode === 'null-blob' ? null : new Blob(['png'], { type: 'image/png' }));
  callback = null; // Native encoder no longer roots its completed callback.
}
app.state = createDemoProject();
app.sources.videoFile = app.sources.audioFile = null;
app.sampleRaster = {};
for (let n = 0; n < 12; n++) { await setImmediate(); global.gc(); }
const alive = Object.fromEntries(Object.entries(refs).map(([key, ref]) => [key, !!ref.deref()]));
const retained = ['pending', 'reentrant'].includes(mode);
assert.deepEqual(alive, { project: retained, video: retained,
  audio: retained, raster: retained });
// Keep the actual application owner rooted through collection and assertion.
assert.equal(typeof owner.save, 'function');
console.log(JSON.stringify({ mode, alive }));
