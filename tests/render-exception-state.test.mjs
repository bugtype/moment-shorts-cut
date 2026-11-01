import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompositionRenderer } from '../dist/composition-renderer.mjs';
import { createDemoProject, validateProject } from '../dist/core/project.mjs';
import { newCard } from '../dist/effects.mjs';
import { createCanvasTrace } from './fixtures/canvas-trace.mjs';

// A drawing-state model, not native pixels. Canvas saves alpha/filter/transform/
// clipping, but does NOT save its current path. Sprite drawing uses the existing
// trace fixture; only the retained output context receives an injected failure.
function outputContext(failOperation, error) {
  let state = { globalAlpha: 1, filter: 'none', transform: [1, 0, 0, 1, 0, 0], clip: [] };
  let path = [], armed = true, throws = 0;
  const stack = [], calls = [];
  const snapshot = () => structuredClone(state);
  function operation(name, args) {
    const call = { name, args, state: snapshot(), depth: stack.length };
    calls.push(call);
    if (armed && failOperation(call)) { armed = false; throws++; throw error; }
  }
  const context = {
    save() { stack.push(snapshot()); },
    restore() { assert.ok(stack.length, 'renderer must not restore its caller scope'); state = stack.pop(); },
    beginPath() { path = []; },
    rect(...args) { path.push(['rect', ...args]); },
    roundRect(...args) { path.push(['roundRect', ...args]); },
    clip() { state.clip.push(...structuredClone(path)); },
    translate(x, y) {
      const [a, b, c, d, e, f] = state.transform;
      state.transform = [a, b, c, d, e + a * x + c * y, f + b * x + d * y];
    },
    scale(x, y) {
      const [a, b, c, d, e, f] = state.transform;
      state.transform = [a * x, b * x, c * y, d * y, e, f];
    },
    fillRect(...args) { operation('fillRect', args); },
    clearRect(...args) { operation('clearRect', args); },
    drawImage(...args) { operation('drawImage', args); },
    fill(...args) { operation('fill', args); },
  };
  for (const key of ['globalAlpha', 'filter']) Object.defineProperty(context, key, {
    get: () => state[key], set: value => { state[key] = value; },
  });
  return { context, calls, snapshot, get depth() { return stack.length; }, get throws() { return throws; } };
}

const source = { traceName: 'video' };
const baseMedia = { source, sw: 320, sh: 180, ready: false,
  sourceTime: .04, time: .04, total: 12, elapsed: .04, remaining: 11.96, progress: .04 / 12 };
const cases = [
  { name: 'media clipping and filter', setup(project, media) {
    media.ready = true; project.effects.brightness = 1.2;
  }, fails: call => call.name === 'drawImage' && call.args[0] === source },
  { name: 'transition opacity', setup(project) { project.effects.transition = 'flash'; },
    fails: call => call.name === 'fillRect' && call.depth > 0 && call.state.globalAlpha < .7 },
  { name: 'caption opacity', setup(project) {
    project.captionAnimation = 'fade'; project.captions = [{ start: 0, end: 2, text: 'Retried caption' }];
  }, fails: call => call.name === 'drawImage' },
  { name: 'outer scene card transform and opacity', setup(project) {
    project.overlays = [{ ...newCard(12), animation: 'pop', text: 'Retried card' }];
  }, fails: call => call.name === 'drawImage' },
  { name: 'nested panel fill restores both scene card scopes', setup(project) {
    project.overlays = [{ ...newCard(12), presentation: 'panel', animation: 'slide', backgroundOpacity: .4 }];
  }, fails: call => call.name === 'fill' },
];

for (const scenario of cases) for (const callerScope of [false, true]) {
  test(`${scenario.name}: exception and retry preserve ${callerScope ? 'caller-owned' : 'default'} output state`, () => {
    const error = new Error(`injected ${scenario.name}`);
    const model = outputContext(scenario.fails, error), context = model.context;
    if (callerScope) {
      context.save(); context.globalAlpha = .83; context.filter = 'sepia(.1)';
      context.translate(7, 11); context.scale(.9, 1.1);
      context.beginPath(); context.rect(1, 2, 500, 900); context.clip();
    }
    const entry = model.snapshot(), entryDepth = model.depth;
    const project = createDemoProject(), media = { ...baseMedia };
    project.design.title.enabled = false; project.design.credit.enabled = false;
    project.captions = []; project.overlays = []; project.effects.progress = false;
    scenario.setup(project, media);
    validateProject(project);
    const before = structuredClone(project);
    const renderer = createCompositionRenderer(createCanvasTrace().makeCanvas);
    assert.throws(() => renderer.draw(context, 540, 960, project, media), thrown => thrown === error);
    const failedState = model.snapshot(), failedDepth = model.depth;
    const retryStart = model.calls.length;
    // Same renderer, cache, context and dimensions: no resize or reset masks leaks.
    assert.doesNotThrow(() => renderer.draw(context, 540, 960, project, media));
    assert.equal(model.throws, 1, 'exactly one injected operation failure');
    const background = model.calls[retryStart];
    assert.equal(background.name, 'fillRect');
    assert.deepEqual(background.args, [0, 0, 540, 960]);
    assert.deepEqual(background.state, entry, 'retry background must not inherit failed layer state');
    assert.equal(background.depth, entryDepth);
    assert.deepEqual(failedState, entry, 'exception must restore drawing state');
    assert.equal(failedDepth, entryDepth, 'exception must balance every renderer-owned save');
    assert.deepEqual(model.snapshot(), entry, 'successful retry also balances state');
    assert.equal(model.depth, entryDepth);
    assert.deepEqual(project, before);
  });
}
