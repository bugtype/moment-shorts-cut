import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompositionRenderer } from '../dist/composition-renderer.mjs';
import { createPlayback } from '../dist/playback.mjs';
import { newCard } from '../dist/effects.mjs';
import { createDemoProject, validateProject, projectSubtitles } from '../dist/core/project.mjs';
import { createCanvasTrace } from './fixtures/canvas-trace.mjs';

// Actual playback/composition, canvas command trace only: no native pixels or encoding.
function project(speed, captions) {
  const p = createDemoProject(); p.speed = speed; p.captions = captions;
  p.design.title.enabled = false; p.design.credit.enabled = false; p.overlays = [];
  validateProject(p); return p;
}
const cue = (start, end, text) => ({ start, end, text, basis: 'timeline' });
const seen = (trace, text) => trace.events.some(event => event.includes(text));
function assertCaption(trace, expected, absent) {
  assert.equal(seen(trace, expected), true, `${expected} must reach typography`);
  for (const text of absent) assert.equal(seen(trace, text), false, `${text} must not reach typography`);
}
function renderPlayback(p, current, options, sourceTime = current) {
  const trace = createCanvasTrace();
  const app = { state: p, current, locate: () => ({ index: 0, source: sourceTime }), duration: () => 12,
    sample: { complete: true }, sampleRaster: {}, mediaReady: () => true,
    composition: createCompositionRenderer(trace.makeCanvas) };
  createPlayback(app).paint(trace.context, 540, 960, options); return trace;
}
const directMedia = overrides => ({ source: { traceName: 'source' }, sw: 540, sh: 960, ready: true,
  sourceTime: 8, time: 1, total: 12, elapsed: 1, remaining: 11, progress: .1, ...overrides });
function renderDirect(p, media, options) {
  const trace = createCanvasTrace(); createCompositionRenderer(trace.makeCanvas).draw(trace.context, 540, 960, p, media, options); return trace;
}

for (const [speed, boundary] of [[.3, .45], [.75, .21]]) {
  test(`playback uses exact pre-speed half-open boundary ${boundary} at speed ${speed}`, () => {
    const p = project(speed, [cue(0, boundary, 'ENDED'), cue(boundary, 1, 'CURRENT')]);
    const before = structuredClone(p), subtitles = projectSubtitles(p, { format: 'vtt' });
    assert.ok(boundary / speed * speed < boundary, 'fixture exercises lossy clock roundtrip');
    assertCaption(renderPlayback(p, boundary), 'CURRENT', ['ENDED']);
    assert.deepEqual(p, before); assert.equal(projectSubtitles(p, { format: 'vtt' }), subtitles);
  });
}

test('exact start remains visible even for an adjacent representable endpoint; no epsilon skips it', () => {
  const start = .45, end = .45 + Number.EPSILON / 4;
  const p = project(.3, [cue(start, end, 'NARROW'), cue(end, 1, 'AFTER')]);
  const before = structuredClone(p);
  assertCaption(renderPlayback(p, start), 'NARROW', ['AFTER']);
  assertCaption(renderPlayback(p, end), 'AFTER', ['NARROW']);
  assert.deepEqual(p, before);
});

test('explicit timelineTime zero is authoritative rather than a falsy fallback', () => {
  const p = project(2, [cue(0, .1, 'ZERO'), cue(1, 3, 'LEGACY')]);
  assertCaption(renderDirect(p, directMedia({ time: 1, timelineTime: 0 })), 'ZERO', ['LEGACY']);
});

test('direct renderer calls without a timeline clock retain the legacy output-time conversion', () => {
  const p = project(.3, [cue(0, .45, 'LEGACY'), cue(.45, 1, 'EXACT')]);
  for (const extra of [{}, { timelineTime: undefined }, { timelineTime: null }]) {
    const media = directMedia({ time: .45 / .3, ...extra }), before = structuredClone(media);
    assertCaption(renderDirect(p, media), 'LEGACY', ['EXACT']); assert.deepEqual(media, before);
  }
});

test('mixed source/timeline cues preserve authored first-match priority and independent source clocks', () => {
  const source = { start: 7, end: 9, text: 'SOURCE' }, timeline = cue(.45, 1, 'TIMELINE');
  for (const captions of [[source, timeline], [timeline, source]]) {
    const p = project(.3, captions), before = structuredClone(p);
    assertCaption(renderPlayback(p, .45, undefined, 8), captions[0].text, [captions[1].text]);
    assert.deepEqual(p, before);
  }
});

test('includeCaptions false still suppresses exact-clock cues without changing authored or export times', () => {
  const p = project(.3, [cue(.45, 1, 'HIDDEN')]), before = structuredClone(p);
  const subtitles = projectSubtitles(p, { format: 'vtt' });
  assert.equal(seen(renderPlayback(p, .45, { includeCaptions: false }), 'HIDDEN'), false);
  assert.equal(seen(renderDirect(p, directMedia({ time: .45 / .3, timelineTime: .45 }), { includeCaptions: false }), 'HIDDEN'), false);
  assert.deepEqual(p, before); assert.equal(projectSubtitles(p, { format: 'vtt' }), subtitles);
});


test('raw caption clock does not replace output time for title/card visibility or card animation', () => {
  const p = project(.3, [cue(.45, .46, 'RAWCAPTION')]);
  p.design.title.enabled = true; p.design.title.lines = ['OUTPUTTITLE', ''];
  p.design.title.start = 1; p.design.title.end = 2;
  p.overlays = [{ ...newCard(12), id: 'output-card', role: 'free', text: 'OUTPUTCARD', start: 1, end: 2, animation: 'pop' }];
  validateProject(p); const before = structuredClone(p);
  const media = directMedia({ time: 1.08, timelineTime: .45 });
  const exact = renderDirect(p, media);
  assertCaption(exact, 'RAWCAPTION', []);
  assert.equal(seen(exact, 'OUTPUTTITLE'), true); assert.equal(seen(exact, 'OUTPUTCARD'), true);
  assert.ok(exact.events.some(event => event[1] === 'globalAlpha' && Math.abs(event[2] - .5) < 1e-12), 'card entrance uses (output time - start) / .16');
  const legacy = renderDirect(p, directMedia({ time: 1.08 }), { includeCaptions: false });
  const explicit = renderDirect(p, media, { includeCaptions: false });
  assert.deepEqual(explicit.events, legacy.events, 'all non-caption drawing/animation commands retain output-clock behavior');
  const outside = renderDirect(p, directMedia({ time: .45, timelineTime: 1.08 }));
  assert.equal(seen(outside, 'OUTPUTTITLE'), false); assert.equal(seen(outside, 'OUTPUTCARD'), false);
  assert.deepEqual(p, before);
});

test('recorded-output draw passes exact timeline caption time to export surface before preview copy', () => {
  const p = project(.3, [cue(0, .45, 'ENDED'), cue(.45, 1, 'CURRENT')]);
  const before = structuredClone(p), output = createCanvasTrace(), preview = createCanvasTrace();
  const exportCanvas = { width: 720, height: 1280, traceName: 'recorded-output' };
  const app = { state: p, current: .45, exporting: true,
    locate: () => ({ index: 0, source: .45 }), duration: () => 12,
    sample: { complete: true }, sampleRaster: {}, mediaReady: () => true,
    composition: createCompositionRenderer(output.makeCanvas),
    videoExport: { context: output.context, canvas: exportCanvas, renderOptions: { includeCaptions: true } },
    ctx: preview.context, canvas: { width: 540, height: 960 } };
  createPlayback(app).draw();
  assertCaption(output, 'CURRENT', ['ENDED']);
  assert.deepEqual(preview.events.find(event => event[1] === 'drawImage'), ['output', 'drawImage', 'recorded-output', 0, 0, 540, 960]);
  assert.deepEqual(p, before);
});
