import test from 'node:test';
import assert from 'node:assert/strict';
import { createInspectorView } from '../dist/inspector-view.mjs';
import { createTimelineView } from '../dist/timeline-view.mjs';
import { createDemoProject } from '../dist/core/project.mjs';
import { createTrack } from './fixtures/timeline-dom.mjs';

function controls() {
  const elements = new Map();
  const query = key => {
    if (!elements.has(key)) elements.set(key, {
      value: '', style: {}, classList: { toggle() {} }, clientWidth: 600, attributes: {},
      setAttribute(name, value) { this.attributes[name] = String(value); },
    });
    return elements.get(key);
  };
  elements.set('#captionTrack', createTrack());
  return { query, elements };
}

test('inspector owns trim draft identity while unrelated values and controls synchronize', () => {
  const { query } = controls(), inspector = createInspectorView(query, () => []), state = createDemoProject();
  inspector.render(state, 0, false, true);
  query('#trimStart').value = '1.5';query('#trimEnd').value = '';
  state.zoom = 1.5;state.volume = .4;
  inspector.render(state, 0, true, false);
  assert.equal(query('#trimStart').value, '1.5');assert.equal(query('#trimEnd').value, '');
  assert.equal(query('#mobileZoom').value, '1.5');assert.equal(query('#panelVolume').value, '0.4');
  assert.equal(query('#undoButton').disabled, false);assert.equal(query('#redoButton').disabled, true);
  const next = structuredClone(state);
  assert.equal(inspector.hasTrimTarget(state.clips[0]), true);
  inspector.retargetTrim(next.clips[0]);inspector.render(next, 0, true, false);
  assert.equal(query('#trimStart').value, '1.5');assert.equal(query('#trimEnd').value, '');
  next.clips[0].start = 2;inspector.render(next, 0, true, false);
  assert.equal(query('#trimStart').value, '2.0');assert.equal(query('#trimEnd').value, '12.0');
  inspector.render(structuredClone(next), 0, true, false);
  inspector.open('caption');
  assert.equal(query('#captionSettings').open, true);assert.equal(query('#frameSettings').open, false);
  assert.equal(query('#clipSettings').open, false);
});

test('timeline presentation retains occurrence nodes and edits only display state', () => {
  const { query } = controls(), view = createTimelineView(query), state = createDemoProject();
  state.clips = [{ start: 0, end: 4 }, { start: 0, end: 4 }];state.fileName = '<source>';
  state.captions = [{ start: 1, end: 2, text: '<caption>' }];state.speed = 2;
  const before = structuredClone(state);
  view.render(state, 8, { selected: 1, thumbnail: '', hasAudio: false });
  const nodes = [...query('#captionTrack').children];
  assert.equal(nodes.length, 2);assert.equal(nodes[1].dataset.captionTime, '5');
  assert.match(query('#videoTrack').innerHTML, /&lt;source&gt;/);
  assert.match(query('#videoTrack').innerHTML, /class="clip active" data-clip="1"/);
  view.render(state, 8, { selected: 1, thumbnail: '', hasAudio: false });
  assert.equal(query('#captionTrack').children[1], nodes[1]);
  assert.deepEqual(state, before);
});

test('time updates keep their throttle and label cache local to each view', () => {
  const f = controls();let now = 100, reads = 0;
  const view = createTimelineView(f.query, () => now), state = createDemoProject();
  const duration = () => { reads++;return 12; };
  view.updateTime(state, 3, duration, true);
  assert.equal(f.query('#exportPercent').textContent, '25%');
  assert.equal(f.query('#playhead').style.transform, 'translateX(150px)');
  now = 150;view.updateTime(state, 4, duration, true, false);
  assert.equal(reads, 1);assert.equal(f.query('#seek').value, 3);
  now = 200;view.updateTime(state, 6, duration, true, false);
  assert.equal(reads, 2);assert.equal(f.query('#exportProgress').style.width, '50%');
  const other = controls(), second = createTimelineView(other.query, () => now);
  second.updateTime(state, 6, duration, false);
  assert.match(other.query('#timeDisplay').innerHTML, /00:06/);
});

test('ratio and fit selections synchronize visual and accessible state in both editor surfaces', () => {
  const { query } = controls();
  const groups = Object.fromEntries(['ratio', 'fit'].map(key => [key,
    Array.from({ length: 2 }, () => (key === 'ratio' ? ['9:16', '1:1', '16:9'] : ['cover', 'contain']).map(value => {
      const button = { dataset: { [key]: value }, attributes: {}, active: false };
      button.classList = { toggle: (_, active) => { button.active = active; } };
      button.setAttribute = (name, value) => { button.attributes[name] = String(value); };
      return button;
    })).flat(),
  ]));
  const inspector = createInspectorView(query, selector => groups[selector.slice(6, -1)] || []);
  const state = createDemoProject();
  for (const [ratio, fit] of [['9:16', 'cover'], ['1:1', 'contain'], ['16:9', 'cover']]) {
    Object.assign(state, { ratio, fit });
    inspector.render(state, 0, false, false);
    assert.equal(query('#ratioShortcut').attributes['aria-label'], `화면 비율 변경, 현재 ${ratio}`);
    for (const key of ['ratio', 'fit']) {
      assert.equal(groups[key].filter(button => button.active).length, 2);
      for (const button of groups[key]) {
        assert.equal(button.active, button.dataset[key] === state[key]);
        assert.equal(button.attributes['aria-pressed'], String(button.active));
      }
    }
  }
});
