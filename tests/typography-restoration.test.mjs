import test from 'node:test';
import assert from 'node:assert/strict';
import { createTypographyRenderer } from '../dist/typography.mjs';
import { createCompositionRenderer } from '../dist/composition-renderer.mjs';
import { createDemoProject, validateProject } from '../dist/core/project.mjs';

// Command/backing-content model only, not native Canvas pixels or GPU recovery.
function fixture(mode = 'events') {
  const surfaces = [], draws = [];
  let failure = null;
  function context(surface) {
    return new Proxy({}, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'measureText') return value => {
          if (failure) throw failure;
          return { width: String(value).length * 10 };
        };
        if (key === 'fillText') return value => surface.texts.push(value);
        if (key === 'drawImage') return source => draws.push({ surface: source, texts: [...source.texts] });
        return () => {};
      },
      set(target, key, value) { target[key] = value; return true; },
    });
  }
  function makeCanvas() {
    const surface = new EventTarget();
    surface.texts = []; surface.observers = 0;
    const add = surface.addEventListener.bind(surface);
    surface.addEventListener = function(type, callback) {
      assert.equal(this, surface);
      surface.observers++;
      if (mode === 'throws') throw new Error('Optional event observation');
      add(type, callback);
      if (mode === 'synchronous') callback();
    };
    if (mode === 'absent') surface.addEventListener = undefined;
    if (mode === 'getter') Object.defineProperty(surface, 'addEventListener', { get() { throw new Error('Optional event getter'); } });
    const drawing = context(surface);
    surface.getContext = () => drawing;
    for (const key of ['width', 'height']) {
      let value = 1;
      Object.defineProperty(surface, key, { get: () => value, set(next) { value = next; surface.texts = []; } });
    }
    surfaces.push(surface);
    return surface;
  }
  return { surfaces, draws, makeCanvas, output: context(null),
    failMeasurement: error => { failure = error; },
    restore(surface) { surface.texts = []; surface.dispatchEvent(new Event('contextrestored')); },
  };
}

const labelOptions = { size: 20, maxWidth: 300, maxHeight: 200, color: '#ffffff' };

test('a restored cached glyph surface rebuilds on the next composition without replacing unaffected text', () => {
  const f = fixture(), renderer = createCompositionRenderer(f.makeCanvas), project = createDemoProject();
  project.design.title.enabled = false; project.design.credit.text = '유지';
  project.captionAnimation = 'none'; project.captions = [{ start: 0, end: 2, text: '복구 확인' }];
  validateProject(project);
  const before = JSON.stringify(project);
  const media = { ready: false, sourceTime: 1, time: 1, total: 12, elapsed: 1, remaining: 11, progress: 1 / 12 };
  const draw = () => { f.draws.length = 0; renderer.draw(f.output, 540, 960, project, media); };
  draw();
  const [caption, credit] = f.surfaces;
  assert.deepEqual(f.draws.map(item => item.texts), [['복구 확인'], ['유지']]);
  draw(); assert.equal(f.surfaces.length, 2);
  f.restore(caption);
  assert.equal(f.surfaces.length, 2, 'Notification does not draw recursively');
  draw();
  assert.deepEqual(f.draws.map(item => item.texts), [['복구 확인'], ['유지']]);
  assert.notEqual(f.draws[0].surface, caption); assert.equal(f.draws[1].surface, credit);
  assert.equal(f.surfaces.length, 3);
  draw(); assert.equal(f.surfaces.length, 3, 'Rebuilt sprite is cached normally');
  assert.equal(JSON.stringify(project), before);
});

test('sprite restoration preserves cache accounting, retired-item isolation and optional canvas ports', () => {
  const f = fixture(), renderer = createTypographyRenderer(f.makeCanvas);
  const draw = (value, options = labelOptions) => { renderer.label(f.output, value, 10, 20, options); return f.draws.at(-1).surface; };
  const a = draw('A'), b = draw('B'), initial = renderer.cacheInfo();
  f.restore(a); f.restore(a);
  assert.equal(draw('B'), b);
  const rebuilt = draw('A'); assert.notEqual(rebuilt, a); assert.deepEqual(renderer.cacheInfo(), initial);
  f.restore(rebuilt);
  const failure = new Error('Measurement failure'); f.failMeasurement(failure);
  assert.throws(() => draw('A'), error => error === failure);
  assert.deepEqual(renderer.cacheInfo(), { entries: 1, pixels: b.width * b.height });
  f.failMeasurement(null); assert.deepEqual(draw('A').texts, ['A']);
  renderer.clear(); const fresh = draw('A'), cleared = renderer.cacheInfo();
  f.restore(a); f.restore(rebuilt); assert.equal(draw('A'), fresh); assert.deepEqual(renderer.cacheInfo(), cleared);
  for (let index = 0; index < 49; index++) draw(`item ${index}`);
  assert.equal(renderer.cacheInfo().entries, 48);
  const replacement = draw('A'), bounded = renderer.cacheInfo();
  f.restore(fresh); assert.equal(draw('A'), replacement); assert.deepEqual(renderer.cacheInfo(), bounded);
  assert.ok(bounded.pixels <= 8_000_000);
  const uncached = draw('large', { ...labelOptions, size: 5000, maxWidth: 1_000_000, maxHeight: 1_000_000 });
  assert.equal(uncached.observers, 0); assert.equal(renderer.cacheInfo().entries, 0);
  for (const mode of ['absent', 'throws', 'getter', 'synchronous']) {
    const optional = fixture(mode), r = createTypographyRenderer(optional.makeCanvas);
    for (let count = 0; count < 2; count++) r.label(optional.output, 'optional', 0, 0, labelOptions);
    assert.equal(optional.surfaces.length, mode === 'synchronous' ? 2 : 1);
    assert.equal(r.cacheInfo().entries, 1);
    assert.deepEqual(optional.draws.map(item => item.texts), [['optional'], ['optional']]);
  }
});
