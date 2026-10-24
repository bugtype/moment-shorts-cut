import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

async function pinchFixture(zoom = 2, scroll = 180) {
  const fixture = await createAppFixture();
  const body = fixture.element('#timelineBody');
  const area = fixture.element('#tracksArea');
  const handlers = new Map();
  body.addEventListener = (name, handler) => handlers.set(name, handler);
  // Client rectangles already include the scroll offset, as in the browser.
  area.getBoundingClientRect = () => ({ left: 73 - body.scrollLeft, width: 400 * fixture.evaluate('timelineView.getZoom()') });
  vm.runInContext(`timelineView.setZoom(${zoom}); bind();`, fixture.context);
  body.scrollLeft = scroll;
  const position = midpoint => {
    const rect = area.getBoundingClientRect();
    return (midpoint - rect.left) / rect.width;
  };
  const fire = (name, distance, midpoint = 240, count = 2) => {
    let prevented = false;
    const touches = [{ clientX: midpoint - distance / 2, clientY: 50 }, { clientX: midpoint + distance / 2, clientY: 50 }].slice(0, count);
    handlers.get(name)({ touches, preventDefault() { prevented = true; } });
    return prevented;
  };
  return { ...fixture, body, position, fire };
}

for (const playhead of [0, 0.6]) test(`pinch retains its scrolled anchor through repeated zooms (playhead ${playhead})`, async () => {
  const { evaluate, position, fire, context } = await pinchFixture();
  vm.runInContext(`current = duration() * ${playhead};`, context);
  const anchor = position(240);
  fire('touchstart', 100);
  assert.equal(fire('touchmove', 200), true);
  assert.equal(evaluate('timelineView.getZoom()'), 4);
  assert.ok(Math.abs(position(240) - anchor) < 1e-9, 'zoom in must preserve the original touched time');
  fire('touchmove', 400, 270);
  assert.equal(evaluate('timelineView.getZoom()'), 8);
  assert.ok(Math.abs(position(270) - anchor) < 1e-9, 'moving the midpoint must not change its anchored time');
  fire('touchmove', 100, 220);
  assert.equal(evaluate('timelineView.getZoom()'), 2);
  assert.ok(Math.abs(position(220) - anchor) < 1e-9, 'zooming back out must retain the anchor');
});

test('ended or cancelled pinch cannot keep changing zoom', async () => {
  for (const ending of ['touchend', 'touchcancel']) {
    const { evaluate, fire } = await pinchFixture();
    fire('touchstart', 100);
    fire(ending, 100, 240, 0);
    assert.equal(fire('touchmove', 200), false);
    assert.equal(evaluate('timelineView.getZoom()'), 2);
    fire('touchstart', 100);
    fire('touchmove', 200);
    assert.equal(evaluate('timelineView.getZoom()'), 4, 'a fresh gesture still works');
  }
});
