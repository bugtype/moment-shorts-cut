import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {createTimelineView} from '../dist/timeline-view.mjs';

const labels = ruler => [...ruler.innerHTML.matchAll(/>([^<]+)<\/span>/g)].map(match => match[1]);
async function fixture(current = 3) {
  const f = await createAppFixture(), events = new Map();
  f.context.window.addEventListener = (name, handler) => events.set(name, handler);
  vm.runInContext(`bind();history=[];future=[];current=${current};`, f.context);
  assert.equal(typeof events.get('resize'), 'function');
  return {...f, resize: () => events.get('resize')()};
}

test('registered resize refreshes paused start, middle and end geometry without changing editor intent', async () => {
  for (const current of [0, 3, 12]) {
    const f = await fixture(current), area = f.element('#tracksArea'), ruler = f.element('#ruler');
    area.clientWidth = 600;
    vm.runInContext('renderTimeline();renderInspector()', f.context);
    assert.equal(labels(ruler).length, 7);
    const name = f.element('#projectName'), trim = f.element('#trimStart');
    name.value = 'uncommitted name';trim.value = '';name.focus();
    const nodes = [...f.element('#captionTrack').children];
    const before = f.evaluate('({state,history,future,current,selected,playing,exporting})');
    vm.runInContext(`globalThis.resizePaints=0;app.composition.draw=()=>resizePaints++;
      renderTimeline=renderPanel=renderInspector=updateTime=play=pause=snapshot=scheduleSave=persistMedia=()=>{throw Error('geometry refresh invoked editor work')}`, f.context);
    const frames = [...f.pendingFrames];
    area.clientWidth = 300;f.resize();
    assert.deepEqual(labels(ruler), ['00:00', '00:03', '00:06', '00:09', '00:12']);
    assert.equal(ruler.style['--ruler-tick'], '12.5%');
    assert.equal(f.element('#playhead').style.transform, `translateX(${current / 12 * 300}px)`);
    assert.deepEqual(f.evaluate('({state,history,future,current,selected,playing,exporting})'), before);
    assert.equal(f.element('#captionTrack').children.length, nodes.length);
    nodes.forEach((node, index) => assert.equal(f.element('#captionTrack').children[index], node));
    assert.equal(f.doc.activeElement, name);assert.equal(name.value, 'uncommitted name');assert.equal(trim.value, '');
    assert.equal(f.evaluate('inspectorView.hasPendingName(state)'), true);
    assert.deepEqual([...f.pendingFrames], frames);assert.equal(f.evaluate('resizePaints'), 1, 'only existing preview resize paints');
    const refusal = await f.context.window.moment.execute('project.update', {patch:{zoom:1.1}});
    assert.equal(refusal.error.code, 'CONFLICT', 'resize must not consume the name draft');
  }
});

test('width refresh retains zoomed scroll and does not schedule playback or export work', async () => {
  for (const flags of ['playing=false;exporting=false', 'playing=true;exporting=false', 'playing=true;exporting=true']) {
    const f = await fixture(9), area = f.element('#tracksArea'), body = f.element('#timelineBody');
    area.clientWidth = 1200;body.clientWidth = 373;
    vm.runInContext('state.speed=2;timelineView.setZoom(4);renderTimeline();'+flags, f.context);
    body.scrollLeft = 137;
    const before = f.evaluate('({state,history,future,current,selected,playing,exporting})'), frames = [...f.pendingFrames];
    vm.runInContext(`globalThis.resizePaints=0;app.composition.draw=()=>resizePaints++;
      renderTimeline=renderPanel=renderInspector=updateTime=play=pause=snapshot=scheduleSave=persistMedia=()=>{throw Error('geometry refresh invoked editor work')}`, f.context);
    for (const width of [600, 1200, 600]) {
      area.clientWidth = width;f.resize();
      assert.equal(f.element('#playhead').style.transform, `translateX(${9 / 12 * width}px)`);
      assert.equal(body.scrollLeft, 137, 'resizing must not follow the playhead over a manually scrolled view');
      assert.equal(f.evaluate('timelineView.getZoom()'), 4);
      assert.equal(labels(f.element('#ruler')).at(-1), '00:06', 'ruler remains on output seconds after speed');
    }
    assert.deepEqual(f.evaluate('({state,history,future,current,selected,playing,exporting})'), before);
    assert.deepEqual([...f.pendingFrames], frames);assert.equal(f.evaluate('resizePaints'), 3);
  }
});

test('a collapsed zero-width timeline refreshes current geometry when revealed after resize', async () => {
  const f = await fixture(3), area = f.element('#tracksArea'), ruler = f.element('#ruler');
  let width = 600;
  Object.defineProperty(area, 'clientWidth', {get: () => f.evaluate('timelineView.isCollapsed()') ? 0 : width});
  vm.runInContext('renderTimeline()', f.context);
  assert.equal(f.element('#playhead').style.transform, 'translateX(150px)');
  const before = f.evaluate('({state,history,future,current,selected})');
  f.element('#timelineToggle').onclick();assert.equal(f.evaluate('timelineView.isCollapsed()'), true);
  width = 300;f.resize();
  f.element('#timelineToggle').onclick();assert.equal(f.evaluate('timelineView.isCollapsed()'), false);
  assert.deepEqual(labels(ruler), ['00:00', '00:03', '00:06', '00:09', '00:12']);
  assert.equal(f.element('#playhead').style.transform, 'translateX(75px)');
  assert.deepEqual(f.evaluate('({state,history,future,current,selected})'), before);
});

test('view geometry refresh works before full render and leaves time throttling and controls alone', () => {
  const elements = new Map(), touched = [], query = key => {
    touched.push(key);
    if (!elements.has(key)) elements.set(key, {clientWidth:600, style:{setProperty(key,value){this[key]=value;}}, setAttribute(){}});
    return elements.get(key);
  };
  let now = 100, clockReads = 0;
  const view = createTimelineView(query, () => {clockReads++;return now;});
  view.resize(0, 0, 1);
  assert.deepEqual(labels(query('#ruler')), ['00:00']);assert.equal(query('#playhead').style.transform, 'translateX(0px)');
  assert.ok(touched.every(key => ['#tracksArea','#ruler','#playhead'].includes(key)));
  assert.equal(clockReads, 0);
  const state = {speed:2};view.updateTime(state,3,()=>12,false);
  const seek = query('#seek');assert.equal(seek.value,3);
  touched.length = 0;query('#tracksArea').clientWidth = 300;
  view.resize(6,12,2);
  assert.equal(query('#playhead').style.transform,'translateX(150px)');assert.equal(seek.value,3);
  assert.ok(touched.every(key => ['#tracksArea','#ruler','#playhead'].includes(key)));
  assert.equal(clockReads,1);
  now=150;view.updateTime(state,6,()=>12,false,false);assert.equal(seek.value,3,'original time throttle survives geometry refresh');
  now=200;view.updateTime(state,6,()=>12,false,false);assert.equal(seek.value,6);
  for (const width of [180, 600, 9600]) {
    query('#tracksArea').clientWidth = width;
    view.resize(43200000,86400000,.25);
    const ruler=query('#ruler'), marks=labels(ruler);
    const target=Math.max(4,Math.min(12,Math.round(width/90)));
    assert.ok(marks.length>=1&&marks.length<=target+1);assert.ok(ruler.innerHTML.length<2000);
    assert.equal(query('#playhead').style.transform,`translateX(${width/2}px)`);
  }
});
