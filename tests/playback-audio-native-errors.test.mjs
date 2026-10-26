import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
// Production playback/export/UI owners; native timing, media and encoded chunks are synthetic.
async function fixture({ kind = 'demo', offset = 0, length = 12, speed = 1, current = 0 } = {}) {
  const f = await createAppFixture(), tracks = [], recorders = [], downloads = [];
  const track = () => {
    const value = { stops: 0, clone: track, stop() { this.stops++; } };
    tracks.push(value); return value;
  };
  const sourceTrack = track(), node = () => ({ connect() {}, gain: { value: 1 } });
  f.context.AudioContext = class {
    constructor() { this.destination = {}; }
    async resume() {}
    createMediaStreamDestination() { return { stream: { getAudioTracks: () => [sourceTrack] } }; }
    createMediaElementSource() { return node(); }
    createGain() { return node(); }
  };
  const video = f.element('#sourceVideo'), audio = f.element('#sourceAudio'), events = new Map();
  let audioPlays = 0;
  for (const media of [video, audio]) {
    media.paused = true; media.error = null;
    media.pause = () => { media.paused = true; };
    media.play = async () => { media.paused = false; if (media === audio) audioPlays++; };
  }
  video.addEventListener = (name, fn) => {
    if (!events.has(name)) events.set(name, new Set());
    events.get(name).add(fn);
  };
  video.removeEventListener = (name, fn) => events.get(name)?.delete(fn);
  audio.duration = length;
  const createElement = f.doc.createElement;
  f.doc.createElement = tag => {
    const element = createElement(tag);
    if (tag === 'canvas') element.captureStream = () => {
      const owned = [track()];
      return { getTracks: () => owned, addTrack: value => owned.push(value) };
    };
    return element;
  };
  f.context.MediaRecorder = class {
    constructor(stream, options) {
      Object.assign(this, { stream, mimeType: options.mimeType, state: 'inactive', stops: 0 });
      recorders.push(this);
    }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive'; this.stops++;
      this.ondataavailable?.({ data: new Blob(['synthetic recording']) });
      this.onstop?.();
    }
  };
  f.context.publish = blob => downloads.push(blob);
  vm.runInContext(`
    state = initial(); state.kind = ${JSON.stringify(kind)}; state.speed = ${speed};
    state.audioOffset = ${offset}; state.audioName = 'voice.wav';
    sources.audioFile = {name:'voice.wav'}; sources.videoFile = ${kind === 'video' ? "{name:'original.mp4'}" : 'null'};
    current = ${current}; download = publish; bindUi(app);
  `, f.context);
  const start = (exporting = true, includeAudio = true) => vm.runInContext(exporting
    ? `exportFlow.startExport({mime:'video/webm',ext:'webm'},720,{includeAudio:${includeAudio}})` : 'play()', f.context);
  const frame = milliseconds => {
    const id = f.evaluate('frameHandle'), callback = f.pendingFrames.get(id);
    assert.equal(typeof callback, 'function'); f.pendingFrames.delete(id);
    if (f.evaluate("state.kind === 'video'")) video.currentTime += milliseconds / 1000 * f.evaluate('state.speed');
    callback(f.evaluate('lastTick') + milliseconds);
  };
  return { ...f, video, audio, recorders, downloads, tracks, sourceTrack, start, frame,
    audioPlays: () => audioPlays, videoWaiters: name => events.get(name)?.size || 0,
    emitVideo: name => { for (const fn of [...events.get(name) || []]) fn(); } };
}
const snapshot = f => f.evaluate('({state,history,future})');
function assertStopped(f, recorder = f.recorders.at(-1)) {
  assert.equal(f.evaluate('playing'), false);
  assert.equal(f.evaluate('exporting'), false);
  assert.equal(f.evaluate('frameHandle'), 0);
  const paint = f.evaluate('paintHandle');
  assert.deepEqual([...f.pendingFrames.keys()], paint ? [paint] : [], 'only a queued one-off seek paint may remain');
  if (paint) {
    const draw = f.pendingFrames.get(paint); f.pendingFrames.delete(paint); draw();
    assert.equal(f.pendingFrames.size, 0);
  }
  assert.equal(f.video.paused, true);
  assert.equal(f.audio.paused, true);
  assert.equal(f.downloads.length, 0);
  assert.equal(f.sourceTrack.stops, 0);
  if (recorder) {
    assert.equal(recorder.stops, 1);
    assert.ok(recorder.stream.getTracks().every(track => track.stops === 1));
    assert.equal(f.evaluate('videoExport.recorder'), null);
    assert.equal(f.evaluate('videoExport.canvas'), null);
  }
}

for (const kind of ['demo', 'video']) {
  for (const code of [2, 3]) {
    for (const offset of [0, 2]) {
      test(`${kind} error ${code} before remaining audio at ${offset} cancels before a delayed final frame`, async () => {
        const f = await fixture({ kind, offset, length: 1 }), before = snapshot(f);
        await f.start(); await settle();
        assert.equal(f.audioPlays(), offset ? 0 : 1);
        const recorder = f.recorders[0], old = { data: recorder.ondataavailable, stop: recorder.onstop, error: recorder.onerror };
        f.audio.error = { code };
        f.frame(12000);
        assertStopped(f, recorder);
        assert.deepEqual(snapshot(f), before);
        assert.match(f.element('#toast').textContent, /재생할 수 없습니다/);
        old.data({ data: new Blob(['stale output']) }); old.stop(); old.error();
        assert.equal(f.downloads.length, 0);
        f.audio.error = null;
        await f.start();
        old.data({ data: new Blob(['stale output']) }); old.stop(); old.error();
        assert.equal(f.evaluate('exporting'), true);
        assert.equal(f.recorders[1].stops, 0);
        f.frame(12000);
        assert.equal(f.downloads.length, 1);
      });
    }
  }
}

for (const [name, options, advance] of [
  ['offset equals end', {offset:12,length:1}, 0],
  ['offset exceeds end', {offset:13,length:1}, 0],
  ['at natural tail', {offset:2,length:1}, 3000],
  ['past natural tail', {offset:2,length:1}, 4000],
]) {
  test(`${name}: failed audio has no remaining overlap and does not reject a valid export`, async () => {
    const f = await fixture(options); await f.start();
    if (advance) f.frame(advance);
    f.audio.error = {code:3}; f.frame(12000 - advance);
    assert.equal(f.downloads.length, 1);
    assert.equal(f.recorders[0].stops, 1);
  });
}

for (const length of [NaN, 0, Infinity]) {
  test(`fatal audio error with duration ${length} cannot silently skip a required source`, async () => {
    const f = await fixture({offset:2,length}); await f.start();
    f.audio.error = {code:3}; f.frame(12000); assertStopped(f);
  });
}

test('unknown duration without an error is not reclassified as a fatal failure', async () => {
  const f = await fixture({length:NaN}); await f.start(); f.frame(1000);
  assert.equal(f.evaluate('playing'), true);
  assert.equal(f.evaluate('exporting'), true);
  vm.runInContext('stopExport(true)', f.context);
});

test('intentionally omitted export audio remains optional and captures no mix track', async () => {
  const f = await fixture(); f.audio.error = {code:3};
  await f.start(true, false);
  assert.equal(f.evaluate('videoExport.renderOptions.includeAudio'), false);
  assert.equal(f.recorders[0].stream.getTracks().length, 1);
  f.frame(12000); assert.equal(f.downloads.length, 1);
});

test('monitor mute does not exempt a required failing mix', async () => {
  const f = await fixture(); vm.runInContext('muted = true;', f.context); await f.start();
  f.audio.error = {code:3}; f.frame(12000); assertStopped(f);
  assert.equal(f.evaluate('muted'), true);
});

test('a leftover element error without an added source is not a dependency', async () => {
  const f = await fixture(); vm.runInContext("sources.audioFile = null; state.audioName = '';", f.context);
  f.audio.error = {code:3}; await f.start(); f.frame(12000);
  assert.equal(f.downloads.length, 1);
});

for (const speed of [.5, 1, 2]) {
  test(`live offset input at speed ${speed} activates a failed short source before the next clock step`, async () => {
    const f = await fixture({offset:12,length:1,speed});
    vm.runInContext("switchPanel('audio')", f.context); await f.start(false);
    f.audio.error = {code:3};
    const field = f.element('#audioOffset'); field.value = '0'; field.onchange({target:field});
    assert.equal(f.evaluate('state.audioOffset'), 0);
    assert.equal(f.evaluate('playing'), true, 'healthy live-edit behavior is not replaced by a forced pause');
    f.frame(1000 / speed); assertStopped(f);
    assert.equal(f.evaluate('current'), 0, 'failure is checked before skipping the entire one-second source');
  });
}

test('healthy live offset edits keep playing', async () => {
  const f = await fixture({offset:12,length:1});
  vm.runInContext("switchPanel('audio')", f.context); await f.start(false);
  const field = f.element('#audioOffset'); field.value = '0'; field.onchange({target:field});
  f.frame(500); assert.equal(f.evaluate('playing'), true); assert.equal(f.audioPlays(), 1);
  vm.runInContext('pause()', f.context);
});

for (const [speed, end, required] of [[.5, 4, false], [2, 1, false], [2, 1.05, true]]) {
  test(`short preview deadline ${end} at speed ${speed} ${required ? 'includes' : 'excludes'} failed audio`, async () => {
    const f = await fixture({offset:2,length:1,speed});
    // cardPlaybackEnd is the existing output-seconds transport deadline, not media duration.
    vm.runInContext(`cardPlaybackEnd = ${end}`, f.context); f.audio.error = {code:3};
    await f.start(false);
    if (required) assertStopped(f);
    else {
      assert.equal(f.evaluate('playing'), true);
      f.frame(end * 1000 + 1); assert.equal(f.evaluate('playing'), false);
    }
  });
}

test('a revised native tail becomes required on the next tick', async () => {
  const f = await fixture({offset:0,length:1,current:2}); await f.start(false);
  f.audio.error = {code:3}; f.audio.duration = 5;
  f.frame(4000); assertStopped(f);
});

test('loop rewind rechecks a failed source that was already past its natural tail', async () => {
  const f = await fixture({length:1,current:2});
  vm.runInContext('playback.setLoopPreview(true)', f.context); await f.start(false);
  f.audio.error = {code:3}; f.frame(10000); await settle();
  assertStopped(f); assert.equal(f.evaluate('current'), 0);
});

test('known failure before startup cancels without requesting added-audio playback', async () => {
  const f = await fixture(); f.audio.error = {code:3}; await f.start();
  assertStopped(f); assert.equal(f.audioPlays(), 0);
});

for (const stage of ['resume', 'seek', 'native-play']) {
  test(`error latched during ${stage} is checked after owned startup settles`, async () => {
    const f = await fixture({kind:'video'}); let release, resumes = 0;
    const gate = new Promise(resolve => { release = resolve; });
    if (stage === 'resume') f.context.AudioContext.prototype.resume = () => ++resumes === 2 ? gate : Promise.resolve();
    if (stage === 'seek') {
      vm.runInContext('state.clips = [{start:6,end:12}]; timelineCache = null;', f.context);
      f.context.AudioContext.prototype.resume = () => {
        if (++resumes === 2) f.video.currentTime = 0;
        return Promise.resolve();
      };
      release = () => f.emitVideo('seeked');
    }
    if (stage === 'native-play') f.video.play = () => { f.video.paused = false; return gate; };
    const pending = f.start(); await settle();
    assert.equal(f.recorders[0].state, 'recording');
    if (stage === 'resume') assert.equal(resumes, 2);
    if (stage === 'seek') assert.equal(f.videoWaiters('seeked'), 2, 'startup seek plus the existing one-off paint listener');
    if (stage === 'native-play') assert.equal(f.video.paused, false);
    f.audio.error = {code:3};
    assert.equal(f.evaluate('exporting'), true, 'no immediate cancellation claim during a pending native await');
    release(); await pending; assertStopped(f);
  });
}

test('cancelled startup settling late cannot apply its error check to a newer pending export', async () => {
  const f = await fixture({kind:'video'}), releases = [];
  f.video.play = () => new Promise(resolve => { releases.push(resolve); });
  const old = f.start(); await settle(); vm.runInContext('stopExport(true)', f.context);
  const replacement = f.start(); await settle(); f.audio.error = {code:3};
  releases[0](); await old;
  assert.equal(f.evaluate('exporting'), true); assert.equal(f.recorders[1].stops, 0);
  releases[1](); await replacement; assertStopped(f, f.recorders[1]);
});
