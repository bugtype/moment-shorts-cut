import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createCaptionGeneration} from '../dist/caption-generation.mjs';
import {createDemoProject} from '../dist/core/project.mjs';
import {createAppFixture} from './fixtures/app.mjs';

// Actual generation owner with deterministic PCM and injected decode/model ports.
// Energy detection is not speech recognition or native WebAudio validation.
function harmonicPcm(phase = 0, harmonics = [[320, .5]]) {
  return Float32Array.from({length:16000}, (_, index) => {
    const value = harmonics.reduce((sum, [frequency, amplitude]) =>
      sum + amplitude * Math.sin(2 * Math.PI * frequency * index / 16000 + phase), 0);
    // Quantize like a generated signed 16-bit PCM WAV; zero crossings stay zero.
    return Math.round(value * 32767) / 32768;
  });
}
async function recognize(pcm) {
  const project = createDemoProject(), before = structuredClone(project);
  const file = {arrayBuffer:async () => new ArrayBuffer(0)};
  let submitted = 0, applied = 0, closed = 0, failure = null;
  const owner = createCaptionGeneration({
    getProject:() => project, getFile:() => file, getDuration:() => 12,
    transcription:{
      transcribe:async received => {
        assert.equal(received, pcm, 'the gate must not replace or alter recognition PCM');
        submitted++;
        return {chunks:[{timestamp:[0, .001], text:'Provider fixture, not recognized speech'}]};
      }, cancel() {},
    },
  }, {
    createAudioContext:() => ({decodeAudioData:async () => ({duration:pcm.length / 16000}), close:async () => { closed++; }}),
    createOfflineContext:(channels, length, rate) => {
      assert.equal(channels, 1); assert.equal(rate, 16000);
      assert.equal(length, Math.min(pcm.length, 180 * 16000));
      return {createBufferSource:() => ({connect() {}, start() {}}),
        startRendering:async () => ({getChannelData:() => pcm})};
    },
  });
  try {
    await owner.generate('audio', file, 'ko', {start() {}, status() {}, apply() { applied++; }});
  } catch (error) { failure = error; }
  assert.equal(closed, 1);
  assert.deepEqual(project, before);
  return {submitted, applied, failure};
}

for (const [name, harmonics] of [
  ['periodic signal', [[320, .5]]],
  ['voice-band harmonic signal', [[320, .25], [640, .15], [960, .1]]],
]) {
  test(`${name} is not mistaken for silence at phase-aligned zero crossings`, async () => {
    for (const phase of [0, .001, Math.PI / 4, Math.PI / 2]) {
      const pcm = harmonicPcm(phase, harmonics), original = pcm.slice();
      const result = await recognize(pcm);
      assert.equal(result.failure, null, `phase ${phase}: signal must reach the provider`);
      assert.equal(result.submitted, 1); assert.equal(result.applied, 1);
      assert.deepEqual(pcm, original);
    }
  });
}

test('above-threshold transient between sampled positions reaches recognition unchanged', async () => {
  for (const index of [1, 49, 51, 15999]) {
    const pcm = new Float32Array(16000); pcm[index] = .003;
    const result = await recognize(pcm);
    assert.equal(result.failure, null, `sample ${index}`);
    assert.equal(result.submitted, 1); assert.equal(result.applied, 1);
    assert.equal(pcm[index], Math.fround(.003));
  }
});

test('silence and uniformly sub-threshold audio still reject before model work', async () => {
  for (const pcm of [new Float32Array(16000), new Float32Array(180 * 16000),
    new Float32Array(16000).fill(.0019), new Float32Array(16000).fill(-.0019)]) {
    const result = await recognize(pcm);
    assert.equal(result.failure?.messageKey, 'errors.noSpeechSource');
    assert.equal(result.submitted, 0); assert.equal(result.applied, 0);
  }
});

test('the existing absolute sample threshold is unchanged for either polarity', async () => {
  for (const value of [.002, -.002, .0019999, -.0019999]) {
    const pcm = new Float32Array(16000); pcm[0] = value;
    const result = await recognize(pcm);
    const accepted = Math.abs(pcm[0]) >= .002;
    assert.equal(result.failure?.messageKey ?? null, accepted ? null : 'errors.noSpeechSource');
    assert.equal(result.submitted, accepted ? 1 : 0);
  }
});

test('Generate UI reaches the provider for non-silent PCM and keeps one undoable result', async () => {
  const f = await createAppFixture(), pcm = harmonicPcm();
  f.context.AudioContext = class { async decodeAudioData() { return {duration:1}; } async close() {} };
  f.context.OfflineAudioContext = class {
    createBufferSource() { return {connect() {}, start() {}}; }
    async startRendering() { return {getChannelData:() => pcm}; }
  };
  vm.runInContext(`sources.audioFile={name:'generated.wav',arrayBuffer:async()=>new ArrayBuffer(0)};
    state.audioName='generated.wav';history=[];future=[];globalThis.signalSubmissions=0;
    transcription.transcribe=async()=>{signalSubmissions++;return {chunks:[{timestamp:[0,.5],text:'Provider fixture'}]};};
    switchPanel('captions');`, f.context);
  f.element('#captionSource').value = 'audio'; f.element('#language').value = 'ko';
  const before = f.evaluate('state');
  await f.element('#generateCaptions').onclick();
  assert.equal(f.evaluate('signalSubmissions'), 1);
  assert.equal(f.evaluate('history.length'), 1);
  assert.deepEqual(f.evaluate('state.captions'), [{start:0, end:.5, text:'Provider fixture', basis:'timeline'}]);
  assert.equal(f.evaluate('transcribing'), false);
  vm.runInContext('undo()', f.context);
  assert.deepEqual(f.evaluate('state'), before);
});
