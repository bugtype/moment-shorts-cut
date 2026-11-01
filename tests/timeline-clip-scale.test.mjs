import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { installClipTrackDom } from './fixtures/timeline-clip-dom.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≈ ${expected}`);
const total = clips => clips.reduce((sum, clip) => sum + clip.end - clip.start, 0);
const widths = track => [...track.innerHTML.matchAll(/style="flex:0 0 ([^%;]+)%;/g)].map(match => Number(match[1]));
async function setup(clips, speed = 1) {
  const f = await createAppFixture();
  const track = installClipTrackDom(f.element('#videoTrack'), f.doc, f.focusEvents);
  vm.runInContext(`state=initial(); state.duration=120; state.clips=${JSON.stringify(clips)};
    state.captions=[]; state.speed=${speed}; selected=0; current=0; timelineCache=null;
    history=[JSON.stringify(state)]; future=[]; globalThis.scaleSaves=0;
    scheduleSave=()=>scaleSaves++; renderTimeline();`, f.context);
  return { ...f, track };
}

// Actual generated markup and its declared geometry, not native CSS layout.
for (const [name, clips] of [
  ['one subsecond clip', [{ start: 0, end: .2 }]],
  ['a subsecond total', [{ start: 8, end: 8.1 }, { start: 2, end: 2.2 }, { start: 8, end: 8.15 }]],
  ['unequal repeated source ranges', [{ start: 0, end: .1 }, { start: .1, end: 100 }, { start: 0, end: .1 }]],
  ['100 short clips', Array.from({ length: 100 }, () => ({ start: 0, end: .1 }))],
  ['1000 short clips', Array.from({ length: 1000 }, () => ({ start: 0, end: .1 }))],
]) {
  test(`video clip declarations share the full timeline scale: ${name}`, async () => {
    for (const speed of [.25, 1, 4]) {
      const f = await setup(clips, speed), percentages = widths(f.track), len = total(clips);
      assert.equal(percentages.length, clips.length, 'each clip has a fixed percentage basis, not seconds as flex-grow');
      near(percentages.reduce((sum, value) => sum + value, 0), 100);
      for (const width of [180, 600, 4800]) {
        let elapsed = 0, left = 0;
        percentages.forEach((percent, index) => {
          near(left, elapsed / len * width);
          const duration = clips[index].end - clips[index].start;
          near(percent / 100 * width, duration / len * width);
          elapsed += duration;
          left += percent / 100 * width;
        });
        near(left, width);
      }
    }
  });
}

test('clip decoration cannot impose gaps, a minimum width or a border-box floor', async () => {
  const css = await fs.readFile(new URL('../dist/styles/preview-timeline.css', import.meta.url), 'utf8');
  const rule = selector => css.match(new RegExp(`\\${selector} \\{([^}]*)\\}`))[1];
  assert.match(rule('.video-track'), /gap:0(?:;|\s|$)/);
  const clip = rule('.clip');
  assert.match(clip, /min-width:0(?:;|\s|$)/);
  assert.match(clip, /border:0(?:;|\s|$)/);
  assert.match(clip, /padding:0(?:;|\s|$)/);
  assert.match(clip, /box-shadow:inset 0 0 0 2px #c8d6ba/);
  assert.match(rule('.clip.active'), /box-shadow:inset 0 0 0 2px #90a877/);
  const shell = await fs.readFile(new URL('../dist/styles/shell-library.css', import.meta.url), 'utf8');
  assert.match(shell, /button:focus-visible,a:focus-visible\s*\{[^}]*outline:2px solid var\(--focus\)/);
});

test('declared clip boundaries agree with pointer and keyboard activation without edits', async () => {
  const clips = [{ start: 8, end: 8.1 }, { start: 2, end: 12 }, { start: 8, end: 8.2 }];
  const f = await setup(clips, 4), percentages = widths(f.track), len = total(clips);
  assert.equal(percentages.length, clips.length);
  const nodes = [...f.track.children], before = f.evaluate('({state,history,future})');
  const writes = f.track.writes;
  for (const width of [180, 600, 4800]) {
    let left = -137, elapsed = 0;
    for (const [index, percent] of percentages.entries()) {
      const target = nodes[index], duration = clips[index].end - clips[index].start;
      // No layout engine: supply the rectangle from the declared percentage.
      target.rect = { left, width: width * percent / 100 };
      target.focus();
      for (const fraction of [0, .5, .99]) {
        f.track.onclick({ target, detail: 1, clientX: left + target.rect.width * fraction });
        near(f.evaluate('current'), elapsed + duration * fraction);
        near((f.evaluate('current') / len * width) - 137, left + target.rect.width * fraction);
      }
      f.track.onclick({ target, detail: 0, clientX: -999 });
      near(f.evaluate('current'), elapsed);
      assert.equal(f.evaluate('selected'), index);
      assert.equal(f.doc.activeElement, target);
      assert.ok(f.track.children.every((node, i) => node === nodes[i]));
      left += target.rect.width;
      elapsed += duration;
    }
  }
  assert.deepEqual(f.evaluate('({state,history,future})'), before);
  assert.equal(f.evaluate('scaleSaves'), 0);
  assert.equal(f.track.writes, writes);
});

test('zoom and geometry-only resize preserve clip percentages, nodes and focused selection', async () => {
  const f = await setup([{ start: 0, end: .1 }, { start: 1, end: 1.2 }]);
  const percentages = widths(f.track);
  assert.equal(percentages.length, 2);
  const nodes = [...f.track.children], html = f.track.innerHTML, writes = f.track.writes;
  nodes[1].focus();
  for (const [zoom, width] of [[1, 180], [4, 600], [16, 4800], [1, 180]]) {
    f.element('#tracksArea').clientWidth = width;
    vm.runInContext(`timelineView.setZoom(${zoom}); timelineView.resize(current,duration(),state.speed); renderTimeline()`, f.context);
    assert.equal(f.track.innerHTML, html);
    assert.deepEqual(widths(f.track), percentages);
    assert.ok(f.track.children.every((node, i) => node === nodes[i]));
    assert.equal(f.doc.activeElement, nodes[1]);
  }
  assert.equal(f.track.writes, writes);
});
