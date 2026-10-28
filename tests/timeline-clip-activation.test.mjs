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

test('thumbnail refresh reuses full clip HTML while empty backgrounds release the memo', async () => {
  const f = await setup();
  const joins = [];
  f.context.thumbnailJoins = value => {
    if (value.startsWith('<button class="clip"') && value.includes('background-image:url(')) joins.push(value);
  };
  // The project clip array belongs to this fixture's VM, so observe that realm's
  // join rather than changing the host process's Array prototype.
  vm.runInContext(`globalThis.originalClipJoin=Array.prototype.join;
    Array.prototype.join=function(...args){
      const value=Reflect.apply(originalClipJoin,this,args);thumbnailJoins(value);return value;
    };`, f.context);
  try {
    vm.runInContext(`sources.thumbnail='data:image/jpeg;base64,'+'QUFB'.repeat(100);renderTimeline();`, f.context);
    assert.equal(joins.length, 1);
    const html = f.track.innerHTML, nodes = [...f.track.children], writes = f.track.writes;
    nodes[1].focus();
    f.activate(1, { detail: 0 });
    vm.runInContext('renderTimeline();renderTimeline()', f.context);
    assert.equal(joins.length, 1, 'unchanged refreshes do not join repeated thumbnail payloads');
    assert.equal(f.track.innerHTML, html);
    assert.equal(f.track.writes, writes);
    assertNodes(f.track, nodes);
    assert.equal(f.doc.activeElement, nodes[1]);
    vm.runInContext(`sources.thumbnail='';renderTimeline();`, f.context);
    assert.doesNotMatch(f.track.innerHTML, /background-image/);
    assert.equal(joins.length, 1);
    vm.runInContext(`sources.thumbnail='data:image/jpeg;base64,'+'QUFB'.repeat(100);renderTimeline();`, f.context);
    assert.equal(joins.length, 2, 'empty background discarded the old full-string memo');
    assert.equal(f.track.innerHTML, html);
    assert.equal(f.track.writes, writes + 2);
    assert.ok(nodes.every(node => !node.isConnected));
    f.assertNoWrites();
  } finally {
    vm.runInContext('Array.prototype.join=originalClipJoin;delete globalThis.originalClipJoin;', f.context);
  }
});

test('thumbnail markup memo includes localized labels and escaped names without hiding in-place edits', async () => {
  const f = await setup(), originalLocale = f.context.getLocale();
  try {
    vm.runInContext(`sources.thumbnail='data:image/jpeg;base64,QUFB';renderTimeline();`, f.context);
    for (const [name, code, expected] of [
      ['English', `setLocale('en',{persist:false})`, /Clip 2/],
      ['Chinese', `setLocale('zh-CN',{persist:false})`, /片段 2/],
      ['Korean', `setLocale('ko',{persist:false})`, /클립 2/],
      ['escaped name', `state.fileName='<button style="flex:3;"> & 한국어 👨‍👩‍👧‍👦'`, /&lt;button style=&quot;flex:3;&quot;&gt; &amp; 한국어/],
      ['in-place trim', 'state.clips[1].end=5.25;timelineCache=null', /flex:3.25;/],
      ['thumbnail replacement', `sources.thumbnail='data:image/jpeg;base64,QkJC'`, /QkJC/],
    ]) {
      const previous = [...f.track.children], writes = f.track.writes;
      vm.runInContext(code + ';renderTimeline()', f.context);
      assert.equal(f.track.writes, writes + 1, name);
      assert.ok(previous.every(node => !node.isConnected), name);
      assert.match(f.track.innerHTML, expected, name);
      const next = [...f.track.children];
      vm.runInContext('renderTimeline()', f.context);
      assertNodes(f.track, next);
      assert.equal(f.track.writes, writes + 1, name + ' repeated');
    }
    f.assertNoWrites();
  } finally { f.context.setLocale(originalLocale, { persist: false }); }
});

test('thumbnail string memo preserves markup-owner repair and throwing or reentrant DOM setter ordering', async () => {
  const f = await setup();
  vm.runInContext(`sources.thumbnail='data:image/jpeg;base64,QUFB';renderTimeline();`, f.context);
  vm.runInContext(`updateTimelineMarkup($('#videoTrack'),'<span>Other owner</span>');`, f.context);
  assert.equal(f.track.children.length, 0);
  vm.runInContext('renderTimeline()', f.context);
  assert.equal(f.track.children.length, 3);
  const descriptor = Object.getOwnPropertyDescriptor(f.track, 'innerHTML');
  const failure = new Error('injected DOM setter failure');
  let fail = true;
  Object.defineProperty(f.track, 'innerHTML', { ...descriptor, set(value) {
    if (fail) throw failure;
    descriptor.set.call(this, value);
  } });
  vm.runInContext(`state.fileName='Retry name'`, f.context);
  assert.throws(() => vm.runInContext('renderTimeline()', f.context), error => error === failure);
  fail = false;
  vm.runInContext('renderTimeline()', f.context);
  assert.match(f.track.innerHTML, /Retry name/);
  let reentered = false;
  Object.defineProperty(f.track, 'innerHTML', { ...descriptor, set(value) {
    descriptor.set.call(this, value);
    if (!reentered) {
      reentered = true;
      vm.runInContext(`state.fileName='Nested name';renderTimeline()`, f.context);
    }
  } });
  vm.runInContext(`state.fileName='Outer name';renderTimeline()`, f.context);
  assert.equal(reentered, true);
  assert.match(f.track.innerHTML, /Nested name/);
  vm.runInContext('renderTimeline()', f.context);
  assert.match(f.track.innerHTML, /Nested name/);
  f.assertNoWrites();
});
