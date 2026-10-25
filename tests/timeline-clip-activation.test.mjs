import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { installClipTrackDom } from './fixtures/timeline-clip-dom.mjs';

const CLIPS = [{ start: 8, end: 12 }, { start: 2, end: 5 }, { start: 8, end: 10 }];
const assertNodes = (track, nodes) => {
  assert.equal(track.children.length, nodes.length);
  nodes.forEach((node, index) => assert.equal(track.children[index] === node, true, `clip ${index} retains its node`));
};

async function setup(speed = 1) {
  const fixture = await createAppFixture();
  const { element, doc, context, evaluate, focusEvents } = fixture;
  const track = installClipTrackDom(element('#videoTrack'), doc, focusEvents);
  let storageWrites = 0;
  context.localStorage.setItem = () => { storageWrites++; };
  vm.runInContext(`state=initial(); state.clips=${JSON.stringify(CLIPS)}; state.speed=${speed};
    selected=0; current=1; timelineCache=null; history=[JSON.stringify(state)]; future=[JSON.stringify(state)];
    globalThis.activationSaves=0; scheduleSave=()=>activationSaves++; renderTimeline(); renderInspector();`, context);
  const unchangedState = () => evaluate('({state,history,future})');
  const activate = (index, event = {}, rect = { left: 100, width: 400 }) => {
    const target = track.children[index];
    target.rect = rect;
    track.onclick({ target, clientX: 0, ...event });
    return target;
  };
  const assertNoWrites = () => {
    assert.equal(storageWrites, 0);
    assert.equal(evaluate('activationSaves'), 0);
  };
  return { ...fixture, track, activate, unchangedState, assertNoWrites };
}

for (const speed of [.25, 1, 4]) {
  test(`non-pointing clip activation uses its edited occurrence start at speed ${speed}`, async () => {
    const f = await setup(speed), before = f.unchangedState();
    // Reordered source ranges and a repeated source range must not choose source time.
    for (const [index, start] of [[1, 4], [2, 7], [0, 0]]) {
      for (const left of [100, -150, -300]) {
        f.activate(index, { detail: 0 }, { left, width: 400 });
        assert.equal(f.evaluate('selected'), index);
        assert.equal(f.evaluate('current'), start, `clip ${index}, left ${left}`);
        assert.deepEqual(f.unchangedState(), before);
      }
    }
    // Programmatic click() shares the zero-detail path; geometry is irrelevant.
    f.activate(1, { detail: 0, clientX: 241 }, { left: 0, width: 0 });
    assert.equal(f.evaluate('current'), 4);
    f.assertNoWrites();
  });
}

test('pointer click counts and legacy coordinate-only calls keep their exact seek behavior', async () => {
  const f = await setup(2), before = f.unchangedState();
  for (const detail of [1, 2, undefined]) {
    const event = detail === undefined ? {} : { detail };
    for (const left of [100, -150, -300]) {
      f.activate(1, { ...event, clientX: left + 150 }, { left, width: 400 });
      assert.equal(f.evaluate('current'), 5.125);
      f.activate(2, { ...event, clientX: left - 5 }, { left, width: 400 });
      assert.equal(f.evaluate('current'), 7);
      f.activate(2, { ...event, clientX: left + 800 }, { left, width: 400 });
      assert.equal(f.evaluate('current'), 8.998);
    }
  }
  assert.deepEqual(f.unchangedState(), before);
  f.assertNoWrites();
});

test('selection-only changes keep clip buttons and focused activation target mounted', async () => {
  const f = await setup(), before = f.unchangedState();
  const nodes = [...f.track.children], writes = f.track.writes;
  const active = () => f.track.children.map(node => node.classList.contains('active'));
  assert.deepEqual(active(), [true, false, false]);
  nodes[1].focus();
  const focusCount = f.focusEvents.length;
  f.activate(1, { detail: 0 });
  assertNodes(f.track, nodes);
  assert.equal(nodes[1].isConnected, true);
  assert.equal(f.doc.activeElement, nodes[1]);
  assert.deepEqual(active(), [false, true, false]);
  f.activate(1, { detail: 0 });
  vm.runInContext('renderTimeline(); renderInspector(); renderTimeline();', f.context);
  assertNodes(f.track, nodes);
  assert.equal(f.doc.activeElement, nodes[1]);
  assert.equal(f.track.writes, writes);
  assert.equal(f.focusEvents.length, focusCount, 'rendering must not refocus or scroll the clip');
  assert.deepEqual(f.unchangedState(), before);
  f.assertNoWrites();
});

test('selection refreshes do not steal outside focus or alter uncommitted trim drafts', async () => {
  const f = await setup(), before = f.unchangedState();
  const outside = f.element('#projectName');
  outside.focus();
  const focusCount = f.focusEvents.length;
  f.activate(1, { detail: 0 });
  assert.equal(f.doc.activeElement, outside);
  assert.equal(f.track.children[1].classList.contains('active'), true);
  f.element('#trimStart').value = '2.25';
  f.element('#trimEnd').value = '4.75';
  const nodes = [...f.track.children];
  f.activate(1, { detail: 1, clientX: 250 });
  vm.runInContext('renderTimeline(); renderInspector();', f.context);
  assert.equal(f.element('#trimStart').value, '2.25');
  assert.equal(f.element('#trimEnd').value, '4.75');
  assert.equal(f.doc.activeElement, outside);
  assert.equal(f.focusEvents.length, focusCount);
  assertNodes(f.track, nodes);
  assert.deepEqual(f.unchangedState(), before);
  f.assertNoWrites();
});

test('an unrelated presentation refresh leaves the selected clip node and focus intact', async () => {
  const f = await setup();
  f.activate(1, { detail: 0 });
  const node = f.track.children[1], writes = f.track.writes;
  node.focus();
  // A changed zoom affects the preview, not the clip lane's structure.
  vm.runInContext('state.zoom=1.5;', f.context);
  const before = f.unchangedState();
  vm.runInContext('renderInspector(); renderTimeline();', f.context);
  assert.equal(f.track.children[1], node);
  assert.equal(f.doc.activeElement, node);
  assert.equal(f.track.writes, writes);
  assert.deepEqual(f.unchangedState(), before);
  f.assertNoWrites();
});

test('zoomed selection keeps existing playhead-follow scrolling without calling focus', async () => {
  const f = await setup(), before = f.unchangedState();
  const body = f.element('#timelineBody'), area = f.element('#tracksArea');
  body.clientWidth = 700; body.scrollWidth = 2873; body.scrollLeft = 0; area.clientWidth = 2800;
  vm.runInContext('timelineView.setZoom(4); renderTimeline();', f.context);
  const target = f.track.children[2];
  target.focus();
  const focusCount = f.focusEvents.length;
  f.activate(2, { detail: 0 });
  assert.equal(f.evaluate('current'), 7);
  assert.equal(body.scrollLeft, 7 / 9 * 2800 - (700 - 73) + 24);
  assert.equal(f.track.children[2] === target, true);
  assert.equal(f.doc.activeElement, target);
  assert.equal(f.focusEvents.length, focusCount);
  assert.deepEqual(f.unchangedState(), before);
  f.assertNoWrites();
});

test('real clip timing, source-name and thumbnail changes still replace stale structural markup', async () => {
  const f = await setup();
  f.activate(1, { detail: 0 });
  const old = f.track.children[1], writes = f.track.writes;
  old.focus();
  vm.runInContext('state.clips[1].end=5.5; renderTimeline();', f.context);
  assert.equal(f.track.writes, writes + 1);
  assert.equal(old.isConnected, false);
  assert.equal(f.doc.activeElement, f.doc.body, 'structural removal retains its existing native behavior');
  assert.match(f.track.innerHTML, /flex:3.5;/);
  assert.equal(f.track.children[1].classList.contains('active'), true);
  const timed = [...f.track.children];
  vm.runInContext('state.fileName="<new & source>"; renderTimeline();', f.context);
  assert.equal(f.track.writes, writes + 2);
  assert.ok(timed.every(node => !node.isConnected));
  assert.match(f.track.innerHTML, /&lt;new &amp; source&gt;/);
  vm.runInContext('sources.thumbnail="data:image/png;base64,QQ=="; renderTimeline();', f.context);
  assert.equal(f.track.writes, writes + 3);
  assert.match(f.track.innerHTML, /background-image:url\('data:image\/png;base64,QQ=='\)/);
  assert.deepEqual(f.track.children.map(node => node.classList.contains('active')), [false, true, false]);
  f.assertNoWrites();
});
