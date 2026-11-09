import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoProject, timelineDuration, validateProject } from '../dist/core/project.mjs';
import { drawSceneCards } from '../dist/effects.mjs';
import { createCompositionRenderer } from '../dist/composition-renderer.mjs';
import { createPlayback } from '../dist/playback.mjs';
import { createCanvasTrace } from './fixtures/canvas-trace.mjs';

function progressProject() {
  const project = createDemoProject();
  project.design.title.enabled = false;
  project.design.credit.enabled = false;
  project.captions = [];
  project.overlays = [];
  project.effects.progress = true;
  return project;
}

test('short edited outputs fill progress proportionally through the playback/composition owners', () => {
  for (const [length, speed] of [[.02, .25], [.05, 1], [.2, 4], [2, 1]]) {
    const project = progressProject();
    project.clips = [{ start: 5, end: 5 + length }];
    project.speed = speed;
    validateProject(project);
    const before = structuredClone(project), duration = timelineDuration(project);
    const trace = createCanvasTrace();
    const app = {
      state: project, current: 0, duration: () => duration,
      locate: time => ({ index: 0, source: project.clips[0].start + time }),
      sample: { complete: false }, sampleRaster: null,
      composition: createCompositionRenderer(trace.makeCanvas),
    };
    const playback = createPlayback(app);
    for (const position of ['top', 'bottom']) {
      project.effects.progressPosition = position;
      for (const fraction of [0, .25, .5, 1]) {
        app.current = duration * fraction;
        trace.events.length = 0;
        playback.paint(trace.context, 540, 960);
        const [track, fill] = trace.events.filter(event => event[1] === 'fillRect').slice(-2);
        assert.ok(Math.abs(fill[4] - track[4] * fraction) < 1e-9,
          `${length}s at ${speed}x, ${position}, ${fraction}: ${fill[4]} / ${track[4]}`);
        assert.equal(fill[3], track[3]);
      }
    }
    project.effects.progressPosition = before.effects.progressPosition;
    assert.deepEqual(project, before);
  }
});

test('progress retains bounded drawing before start, after end and for an empty duration', () => {
  const project = progressProject(), trace = createCanvasTrace();
  for (const [time, total, fraction] of [[-1, .05, 0], [.1, .05, 1], [0, 0, 0], [0, 12, 0], [12, 12, 1]]) {
    trace.events.length = 0;
    drawSceneCards(trace.context, 540, 960, project, time, total);
    const [track, fill] = trace.events.filter(event => event[1] === 'fillRect');
    assert.equal(fill[4], track[4] * fraction);
    assert.ok(Number.isFinite(fill[4]));
  }
});
