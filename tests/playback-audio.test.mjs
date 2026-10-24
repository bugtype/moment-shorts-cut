import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayback } from '../dist/playback.mjs';

function audioFixture(failingStage) {
  const calls = new Map(), links = new Set(), sources = new Map();
  let failed = false, gains = 0, refreshes = 0;
  const step = name => {
    calls.set(name, (calls.get(name) || 0) + 1);
    if (name === failingStage && !failed) {
      failed = true;
      throw new Error(`temporary ${name} failure`);
    }
  };
  const node = name => ({ name, gain: { value: 0 }, connect(target) { links.add(`${name}->${target.name}`); } });
  const context = {
    destination: node('speaker'),
    createMediaStreamDestination() { step('destination'); return { ...node('recording'), stream: {} }; },
    createMediaElementSource(element) {
      step(element.name);
      assert.equal(sources.has(element), false, 'media elements must not be connected to a second source node');
      const source = node(element.name);
      sources.set(element, source);
      return source;
    },
    createGain() { step(`gain${gains + 1}`); return node(`gain${++gains}`); },
    async resume() { step('resume'); },
  };
  const app = { video: { name: 'video' }, audio: { name: 'audio' }, state: { volume: .8, audioVolume: .4 }, renderInspector() { refreshes++; } };
  const playback = createPlayback(app, { createAudioContext() { step('context'); return context; } });
  return { playback, calls, links, sources, get refreshes() { return refreshes; } };
}

for (const stage of ['context', 'destination', 'video', 'audio', 'gain1', 'gain2', 'resume']) {
  test(`audio initialization retries after ${stage} failure without duplicating media sources`, async () => {
    const f = audioFixture(stage);
    await assert.rejects(f.playback.ensureAudio(), /temporary/);
    assert.doesNotThrow(() => f.playback.applyVolumes(false), 'volume controls remain safe before retry');
    await f.playback.ensureAudio();
    assert.ok(f.playback.destination?.stream, 'export must have an audio destination after retry');
    assert.equal(f.sources.size, 2);
    assert.deepEqual([...f.links].sort(), [
      'video->gain1', 'audio->gain2', 'gain1->speaker', 'gain2->speaker',
      'gain1->recording', 'gain2->recording',
    ].sort());
    f.playback.applyVolumes(false);
    const created = [...f.calls].filter(([name]) => name !== 'resume');
    await f.playback.ensureAudio();
    assert.deepEqual([...f.calls].filter(([name]) => name !== 'resume'), created, 'a ready graph must not be rebuilt');
    assert.equal(f.refreshes, 2);
  });
}
