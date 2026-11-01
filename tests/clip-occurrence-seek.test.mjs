import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { installClipTrackDom } from './fixtures/timeline-clip-dom.mjs';
import { validateProject } from '../dist/core/project.mjs';

const SHORT = [{start:0,end:.1},{start:0,end:.1},{start:1.1,end:1.2},{start:0,end:.1},{start:50,end:51}];
async function setup(clips = SHORT, speed = 1) {
  const f = await createAppFixture();
  f.track = installClipTrackDom(f.element('#videoTrack'), f.doc, f.focusEvents);
  f.element('#duplicateClipRangeButton').id = 'duplicateClipRangeButton';
  f.context.ranges = clips;
  f.context.rate = speed;
  vm.runInContext(`state=initial(); state.kind='video'; state.fileName='synthetic.mp4';
    state.duration=86400; video.duration=86400; state.clips=ranges; state.speed=rate;
    selected=0; current=0; timelineCache=null; history=[]; future=[];
    globalThis.seekSaves=0; scheduleSave=()=>seekSaves++;
    globalThis.paintedSource=null; globalThis.originalPaint=composition.draw;
    composition.draw=(...args)=>{paintedSource=args[4].sourceTime;return originalPaint(...args);};
    renderTimeline(); renderInspector();`, f.context);
  validateProject(f.evaluate('state'));
  f.activate = (index, detail = 0, clientX = 100) => {
    const target = f.track.children[index];
    target.rect = {left:100,width:400};
    f.track.onclick({target,detail,clientX});
  };
  f.assertOccurrence = index => {
    const actual = f.evaluate('({selected,position:locate(current),source:video.currentTime,paintedSource,clip:state.clips[selected]})');
    assert.equal(actual.selected, index);
    assert.equal(actual.position.index, index, 'the selected occurrence owns the preview');
    assert.ok(actual.source >= actual.clip.start && actual.source < actual.clip.end);
    assert.equal(actual.source, actual.position.source);
    assert.equal(actual.paintedSource, actual.source);
  };
  return f;
}

for (const speed of [.25, 1, 4]) {
  test(`fractional clip activation shows its selected source occurrence at speed ${speed}`, async () => {
    const f = await setup(SHORT, speed), before = f.evaluate('({state,history,future})');
    for (const detail of [0, 1]) {
      f.activate(4, detail);
      f.assertOccurrence(4);
      assert.equal(f.element('#sourceVideo').currentTime, 50);
      assert.deepEqual(f.evaluate('({state,history,future})'), before);
      assert.equal(f.evaluate('seekSaves'), 0);
    }
  });
}

test('valid fractional pointer positions retain their exact existing seek target', async () => {
  const f = await setup();
  f.activate(4, 1, 250);
  const expected = SHORT.slice(0, 4).reduce((sum, clip) => sum + clip.end - clip.start, 0) + .375;
  assert.equal(f.evaluate('current'), expected);
  f.assertOccurrence(4);
});

test('trim returns to the selected occurrence and keeps one reversible edit', async () => {
  const f = await setup();
  vm.runInContext('selected=4;', f.context);
  const before = f.evaluate('state');
  vm.runInContext('trim(50.1,50.9)', f.context);
  f.assertOccurrence(4);
  assert.equal(f.evaluate('history.length'), 1);
  const after = f.evaluate('state');
  vm.runInContext('undo()', f.context);
  assert.deepEqual(f.evaluate('state'), before);
  vm.runInContext('undo(true)', f.context);
  assert.deepEqual(f.evaluate('state'), after);
});

for (const range of [false, true]) {
  test(`${range ? 'range' : 'single'} duplication previews the copied occurrence, not its predecessor`, async () => {
    const f = await setup();
    vm.runInContext('selected=3;', f.context);
    const before = f.evaluate('state');
    if (range) {
      f.element('#duplicateClipRangeButton').onclick();
      f.element('#duplicateRangeFirst').value = '4';
      f.element('#duplicateRangeLast').value = '4';
      f.element('#confirmDuplicateRange').onclick();
    } else f.element('#duplicateClipButton').onclick();
    f.assertOccurrence(4);
    assert.equal(f.evaluate('history.length'), 1);
    vm.runInContext('undo()', f.context);
    assert.deepEqual(f.evaluate('state'), before);
  });
}

test('moving a clip handles a lookup threshold beyond its cumulative offset', async () => {
  const f = await setup([{start:1,end:2},{start:0,end:.1},{start:80000,end:80000.1}]);
  const before = f.evaluate('state');
  f.element('#trimStart').value = '1.25';
  assert.equal(vm.runInContext('clipMove.move(2)', f.context), true);
  f.assertOccurrence(2);
  assert.equal(f.element('#trimStart').value, '1.25');
  assert.equal(f.evaluate('history.length'), 1);
  vm.runInContext('undo()', f.context);
  assert.deepEqual(f.evaluate('state'), before);
});

test('removing a range previews the first surviving occurrence with one undo entry', async () => {
  const f = await setup([{start:0,end:.1},{start:80000,end:80000.1},{start:4,end:5},{start:1,end:2}]);
  const before = f.evaluate('state');
  f.element('#removeClipRangeButton').onclick();
  f.element('#clipRangeFirst').value = '3';
  f.element('#clipRangeLast').value = '3';
  f.element('#confirmClipRange').onclick();
  f.assertOccurrence(2);
  assert.equal(f.evaluate('history.length'), 1);
  vm.runInContext('undo()', f.context);
  assert.deepEqual(f.evaluate('state'), before);
});
