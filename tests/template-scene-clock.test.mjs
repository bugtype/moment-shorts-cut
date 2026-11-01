import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { createCanvasTrace } from './fixtures/canvas-trace.mjs';
import { createCompositionRenderer } from '../dist/composition-renderer.mjs';

// Real scene/preview/composition owners with synthetic DOM and Canvas commands;
// this checks clock selection, not native bitmap pixels or media decoding.
async function fixture() {
  const f = await createAppFixture();
  vm.runInContext(`
    state=initial(); state.speed=.3; current=.45; selected=0;
    state.design.title.enabled=false; state.design.credit.enabled=false;
    state.globalKeywords=''; state.overlays=[];
    state.captions=[
      {start:0,end:.45,text:'ENDED',basis:'timeline'},
      {start:.45,end:1,text:'CURRENT',basis:'timeline'}
    ];
    sample.complete=true; sampleRaster={width:540,height:960};
    history=[]; future=[];
  `, f.context);
  return f;
}
const plain = value => JSON.parse(JSON.stringify(value));

function paint(project, media) {
  const trace = createCanvasTrace();
  createCompositionRenderer(trace.makeCanvas).draw(trace.context, 540, 960, project, media);
  return trace.events.filter(event => event[1] === 'fillText').map(event => event[2]);
}

test('captured template scene retains exact pre-speed caption clock independently of editor replacement', async () => {
  const f = await fixture(), before = f.evaluate('({state,history,future,current,selected})');
  const scene = vm.runInContext('createTemplateScene(app)', f.context), snapshot = scene.capture();
  assert.ok(snapshot); assert.equal(scene.valid(), true); assert.equal(snapshot.valid(), true);
  assert.equal(snapshot.media.time, .45 / .3);
  assert.notEqual(snapshot.media.time * snapshot.project.speed, .45, 'fixture exercises the lossy round trip');
  assert.equal(snapshot.media.timelineTime, .45);
  assert.deepEqual(plain(snapshot.project), before.state);
  assert.notEqual(snapshot.project, vm.runInContext('state', f.context));
  assert.deepEqual(f.evaluate('({state,history,future,current,selected})'), before);
  const captured = plain(snapshot.project), clock = snapshot.media.timelineTime;
  vm.runInContext("state=initial();state.speed=2;current=7;selected=0;", f.context);
  assert.equal(scene.valid(), false, 'old comparison may not apply to a replacement project');
  assert.equal(scene.canCapture(), false);
  assert.equal(snapshot.valid(), true, 'detached captured frame remains intact until release');
  assert.deepEqual(plain(snapshot.project), captured); assert.equal(snapshot.media.timelineTime, clock);
  const text = paint(snapshot.project, snapshot.media);
  assert.ok(text.includes('CURRENT')); assert.ok(!text.includes('ENDED'));
  snapshot.release(); assert.equal(snapshot.valid(), false); assert.equal(snapshot.media.source.width, 0);
});

test('actual current/selected template comparison renders the same current cue at a fractional-speed boundary', async () => {
  const f = await fixture(), draws = [], before = f.evaluate('({state,history,future,current,selected})');
  f.context.captureComposition = (_context, _width, _height, project, media) => {
    draws.push({ project: plain(project), media, text: paint(project, media) });
  };
  vm.runInContext('composition.draw=(...args)=>captureComposition(...args);pause();templatePreview.open(TEMPLATES[1]);', f.context);
  f.element('#templatePreviewMode').value = 'current';
  f.element('#templatePreviewMode').onchange({});
  const styled = draws.at(-1);
  f.element('#templateCurrentStyle').onclick({});
  const current = draws.at(-1);
  f.element('#templateSelectedStyle').onclick({});
  const selectedAgain = draws.at(-1);
  for (const draw of [styled, current, selectedAgain]) {
    assert.ok(draw.text.includes('CURRENT'), JSON.stringify(draw.text));
    assert.ok(!draw.text.includes('ENDED'), JSON.stringify(draw.text));
    assert.equal(draw.media.timelineTime, .45);
    assert.equal(draw.media.source, styled.media.source);
    assert.deepEqual(draw.project.captions, before.state.captions);
  }
  assert.deepEqual(current.project, before.state);
  assert.deepEqual(f.evaluate('({state,history,future,current,selected})'), before);
  f.element('#modal').open = false; f.element('#modal').onclose();
  assert.equal(styled.media.source.width, 0);
});
