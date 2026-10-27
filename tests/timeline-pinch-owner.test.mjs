import test from 'node:test';
import assert from 'node:assert/strict';
import { bindTimelinePinch } from '../dist/editor-interactions.mjs';

function fixture({ width = 800 } = {}) {
  const trace = [], registrations = [], handlers = new Map();
  const zoomLevels = [1, 2, 4, 8], state = { zoom: 2, scroll: 180, onRender: null };
  const body = {
    addEventListener(name, handler, options) {
      registrations.push([name, options]);
      handlers.set(name, handler);
    },
    get scrollLeft() { trace.push('scroll'); return state.scroll; },
    set scrollLeft(value) { trace.push(['scroll', value]); state.scroll = value; },
  };
  bindTimelinePinch(body, {
    zoomLevels,
    getTracksRect() { trace.push('rect'); return { left: 73 - state.scroll, width: width * state.zoom / 2 }; },
    getZoom() { trace.push('zoom'); return state.zoom; },
    setZoom(value) { trace.push(['zoom', value]); state.zoom = value; },
    render() { trace.push('render'); state.onRender?.(); },
  });
  const fire = (name, distance = 100, count = 2, midpoint = 240) => {
    let prevented = false;
    const touches = Array.from({ length: count }, (_, index) => ({
      clientX: index === 0 ? midpoint - distance / 2 : index === 1 ? midpoint + distance / 2 : midpoint + 500,
      clientY: 50,
    }));
    handlers.get(name)({ touches, preventDefault() { trace.push('prevent'); prevented = true; } });
    return prevented;
  };
  return { trace, registrations, zoomLevels, state, fire };
}

test('pinch owns listener policy and touch admission without reading geometry before a gesture', () => {
  const f = fixture();
  assert.deepEqual(f.registrations, [
    ['touchstart', { passive: true }], ['touchmove', { passive: false }],
    ['touchend', undefined], ['touchcancel', undefined],
  ]);
  assert.deepEqual(f.trace, []);
  assert.equal(f.fire('touchmove', 200), false);
  f.fire('touchstart');
  assert.deepEqual(f.trace, ['rect', 'zoom']);
  f.trace.length = 0;
  assert.equal(f.fire('touchmove', 120), true);
  assert.deepEqual(f.trace, ['prevent', 'zoom'], 'unchanged zoom does not render or read another rectangle');
  assert.equal(f.fire('touchmove', 200, 3), false, 'a genuinely three-touch move is ignored');
  assert.equal(f.fire('touchmove', 200), true, 'ignored move did not retire the gesture');
  assert.equal(f.state.zoom, 4);
  f.fire('touchstart', 100, 3);
  assert.equal(f.fire('touchmove', 400), false, 'a three-touch start does retire it');
  for (const ending of ['touchend', 'touchcancel']) {
    f.fire('touchstart');
    f.fire(ending, 100, 2);
    assert.equal(f.fire('touchmove', 50), true, 'two remaining touches keep the gesture');
    f.fire(ending, 100, 1);
    assert.equal(f.fire('touchmove', 200), false);
    f.fire('touchstart');
    assert.equal(f.fire('touchmove', 200), true, 'a fresh gesture still works');
  }
});

test('pinch renders before measuring the new scrolled rectangle and retains captured levels and bounds', () => {
  const f = fixture();
  f.fire('touchstart'); f.trace.length = 0;
  f.fire('touchmove', 200);
  assert.equal(f.state.zoom, 4);
  assert.equal(f.state.scroll, 527);
  assert.deepEqual(f.trace, ['prevent', 'zoom', ['zoom', 4], 'render', 'rect', 'scroll', ['scroll', 527]]);

  const zero = fixture({ width: 0 });
  zero.fire('touchstart', 0); zero.fire('touchmove', 2);
  assert.equal(zero.state.zoom, 4);
  assert.equal(zero.state.scroll, 0);
  zero.fire('touchmove', 1e6);
  assert.equal(zero.state.zoom, 8);
  zero.fire('touchmove', 0);
  assert.equal(zero.state.zoom, 1);

  const levels = fixture();
  levels.zoomLevels[2] = 8;
  levels.fire('touchstart'); levels.fire('touchmove', 200);
  assert.equal(levels.state.zoom, 8, 'the original captured array is retained, not cloned again');
});

test('pinch state is per binding and remains live through synchronous render callbacks', () => {
  const first = fixture(), second = fixture();
  first.fire('touchstart'); first.fire('touchmove', 200);
  assert.equal(first.state.zoom, 4);
  assert.equal(second.fire('touchmove', 200), false);
  assert.equal(second.state.zoom, 2);

  const reentrant = fixture();
  reentrant.fire('touchstart');
  reentrant.state.onRender = () => reentrant.fire('touchstart', 100, 2, 360);
  reentrant.fire('touchmove', 200);
  assert.equal(reentrant.state.scroll, 300, 'render can replace the live pinch anchor before scroll correction');

  const failed = fixture(), failure = new Error('generated render failure');
  failed.fire('touchstart'); failed.trace.length = 0;
  failed.state.onRender = () => { throw failure; };
  assert.throws(() => failed.fire('touchmove', 200), error => error === failure);
  assert.equal(failed.state.zoom, 4);
  assert.equal(failed.state.scroll, 180);
  assert.equal(failed.trace.includes('rect'), false);
  failed.state.onRender = null;
  failed.fire('touchmove', 400);
  assert.equal(failed.state.zoom, 8, 'a callback failure does not silently retire the original gesture');
});
