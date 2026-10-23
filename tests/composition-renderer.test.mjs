import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompositionRenderer } from '../dist/composition-renderer.mjs';
import { createDemoProject } from '../dist/core/project.mjs';
import { createCanvasTrace } from './fixtures/canvas-trace.mjs';

const media = { source: { traceName: 'video' }, sw: 100, sh: 200, ready: true,
  sourceTime: 1, time: 1, total: 12, elapsed: 1, remaining: 11, progress: 1 / 12 };

test('composition keeps source geometry and layer order without changing project or media', () => {
  const project = createDemoProject();
  project.design.layout = 'full';
  project.fit = 'contain'; project.zoom = 1; project.panX = .1; project.panY = -.1;
  project.effects.motion = 'none'; project.effects.vignette = .3; project.effects.transition = 'flash';
  const input = { ...media, elapsed: 0, progress: 0 }, before = structuredClone({ project, input });
  const trace = createCanvasTrace(), renderer = createCompositionRenderer(trace.makeCanvas);
  renderer.draw(trace.context, 200, 200, project, input);
  assert.deepEqual(trace.events.find(event => event[1] === 'drawImage' && event[2] === 'video'),
    ['output', 'drawImage', 'video', 70, -20, 100, 200]);
  const output = trace.events.filter(event => event[0] === 'output');
  assert.deepEqual(output.slice(0, 2), [['output', 'fillStyle', project.design.background], ['output', 'fillRect', 0, 0, 200, 200]]);
  const image = output.findIndex(event => event[1] === 'drawImage' && event[2] === 'video');
  const vignette = output.findIndex(event => event[1] === 'createRadialGradient');
  const text = output.findIndex(event => event[1] === 'drawImage' && String(event[2]).startsWith('text-'));
  assert.ok(image < vignette && vignette < text);
  assert.deepEqual(output.slice(-4), [['output', 'globalAlpha', .75], ['output', 'fillStyle', '#ffffff'], ['output', 'fillRect', 0, 0, 200, 200], ['output', 'restore']]);
  assert.deepEqual({ project, input }, before);
});

test('unavailable source omits media/vignette while text cache is reused and explicitly cleared', () => {
  const project = createDemoProject(), trace = createCanvasTrace();
  project.effects.vignette = .5;
  const renderer = createCompositionRenderer(trace.makeCanvas);
  for (const missing of [{ ready: false }, { sw: 0 }, { sh: 0 }]) {
    renderer.draw(trace.context, 540, 960, project, { ...media, ...missing });
  }
  assert.ok(!trace.events.some(event => event[1] === 'drawImage' && event[2] === 'video'));
  assert.ok(!trace.events.some(event => event[1] === 'createRadialGradient'));
  const cached = trace.canvasCount;
  assert.ok(cached > 0);
  renderer.draw(trace.context, 540, 960, project, { ...media, ready: false });
  assert.equal(trace.canvasCount, cached);
  renderer.clear();
  renderer.draw(trace.context, 540, 960, project, { ...media, ready: false });
  assert.equal(trace.canvasCount, cached * 2);
});
