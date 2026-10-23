import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoExport } from '../dist/video-export.mjs';

function fixture({ failClone = false, failRecorder = false } = {}) {
  const tracks = [], releases = [], recorders = [];
  const track = () => {
    const item = { stops: 0, stop() { this.stops++; } };
    tracks.push(item);
    return item;
  };
  const session = createVideoExport({
    createCanvas: () => ({
      getContext: () => ({ kind: '2d' }),
      captureStream(fps) {
        assert.equal(fps, 30);
        const owned = [track()];
        return { addTrack: item => owned.push(item), getTracks: () => owned };
      },
    }),
    createRecorder: (stream, options) => {
      if (failRecorder) throw new Error('recorder construction');
      const recorder = { stream, options, mimeType: options.mimeType };
      recorders.push(recorder);
      return recorder;
    },
    onRelease: () => releases.push(session.request),
  });
  const audio = { getAudioTracks: () => [{ clone() {
    if (failClone) throw new Error('clone');
    return track();
  } }] };
  return { session, tracks, releases, recorders, audio };
}

test('export surface geometry, capture options and completed chunks preserve their request', () => {
  for (const [ratio, quality, dimensions] of [['9:16', 1080, [1080, 1920]], ['16:9', 720, [1280, 720]], ['1:1', 720, [720, 720]]]) {
    const f = fixture(), token = f.session.begin();
    f.session.createSurface(ratio, quality);
    assert.deepEqual([f.session.canvas.width, f.session.canvas.height], dimensions);
    assert.equal(f.session.context.kind, '2d');
    const output = [];
    const recorder = f.session.capture(token, { mime: 'video/webm' }, quality, f.audio, {
      onError: () => assert.fail('unexpected error'), onStop: blob => output.push(blob),
    });
    assert.deepEqual(recorder.options, {
      mimeType: 'video/webm', videoBitsPerSecond: quality === 1080 ? 8000000 : 4500000,
      audioBitsPerSecond: 128000,
    });
    recorder.ondataavailable({ data: new Blob([]) });
    recorder.ondataavailable({ data: new Blob(['hello']) });
    recorder.ondataavailable({ data: new Blob([' world']) });
    recorder.onstop();
    assert.equal(output.length, 1);
    assert.equal(output[0].size, 11);
    assert.equal(output[0].type, 'video/webm');
    f.session.release(token);
    assert.ok(f.tracks.every(track => track.stops === 1));
    assert.equal(f.session.recorder, null);
    assert.equal(f.session.canvas, null);
    assert.equal(f.session.context, null);
  }
});

test('release invalidates before notification, clears once and isolates retained callbacks from replacement', () => {
  const f = fixture(), token = f.session.begin();
  f.session.createSurface('9:16', 720);
  let errors = 0, stops = 0;
  const callbacks = { onError: () => errors++, onStop: () => stops++ };
  const old = f.session.capture(token, { mime: 'video/webm' }, 720, f.audio, callbacks);
  const late = { data: old.ondataavailable, error: old.onerror, stop: old.onstop };
  f.session.release(token);
  f.session.release(token);
  assert.deepEqual(f.releases, [token + 1]);
  assert.equal(f.session.owns(token), false);
  assert.equal(old.onstop, null);
  const next = f.session.begin();
  f.session.createSurface('1:1', 720);
  const current = f.session.capture(next, { mime: 'video/webm' }, 720, f.audio, callbacks);
  late.data({ data: new Blob(['old']) });late.error();late.stop();
  f.session.release(token);
  assert.equal(f.session.recorder, current);
  assert.deepEqual(f.tracks.map(track => track.stops), [1, 1, 0, 0]);
  assert.equal(errors, 0);assert.equal(stops, 0);
  current.onerror();assert.equal(errors, 1);
  f.session.release(next);
  assert.ok(f.tracks.every(track => track.stops === 1));
});

test('partial native capture failures retain acquired tracks for cleanup', () => {
  for (const options of [{ failClone: true }, { failRecorder: true }]) {
    const f = fixture(options), token = f.session.begin();
    f.session.createSurface('9:16', 720);
    assert.throws(() => f.session.capture(token, { mime: 'video/webm' }, 720, f.audio, {
      onError() {}, onStop() {},
    }), /clone|recorder construction/);
    f.session.release(token);
    f.session.release(token);
    assert.ok(f.tracks.every(track => track.stops === 1));
    assert.equal(f.releases.length, 1);
  }
});
