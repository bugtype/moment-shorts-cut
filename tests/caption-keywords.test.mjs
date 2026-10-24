import test from 'node:test';
import assert from 'node:assert/strict';
import { clearCaptionKeywords } from '../dist/core/caption-keywords.mjs';
import { createDemoProject, validateProject, projectSubtitles } from '../dist/core/project.mjs';
import { createTypographyRenderer } from '../dist/typography.mjs';
import { createCanvasTrace } from './fixtures/canvas-trace.mjs';

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('empty and absent keyword shapes are exact no-ops, including empty caption lists', () => {
  const project = createDemoProject();
  project.captions[1].keywords = '';
  validateProject(project);
  freeze(project);
  assert.equal(clearCaptionKeywords(project), project);
  assert.equal(Object.hasOwn(project.captions[0], 'keywords'), false);
  assert.equal(Object.hasOwn(project.captions[1], 'keywords'), true);
  const empty = freeze({ ...project, captions: [] });
  assert.equal(clearCaptionKeywords(empty), empty);
});

test('only nonempty stored fields change, preserving whitespace text and all other metadata', () => {
  const project = createDemoProject();
  project.globalKeywords = ' ,\n ';
  project.captions = [
    { start: 0, end: 1, text: '  authored\r\n<>& ', keywords: ' \n ' },
    { start: 1, end: 2, text: 'unchanged', keywords: '' },
    { start: 2, end: 3, text: 'missing' },
    { start: 3, end: 4, text: 'literal', keywords: '$&,😀,한글', speaker: '1', timing: 'estimated' },
  ];
  validateProject(project);
  const before = structuredClone(project);
  freeze(project);
  const next = clearCaptionKeywords(project);
  assert.notEqual(next, project);
  assert.notEqual(next.captions, project.captions);
  assert.deepEqual(next, {
    ...before,
    globalKeywords: '',
    captions: before.captions.map(caption => caption.keywords?.length ? { ...caption, keywords: '' } : caption),
  });
  assert.equal(next.captions[1], project.captions[1]);
  assert.equal(next.captions[2], project.captions[2]);
  assert.equal(next.design, project.design);
  assert.equal(next.effects, project.effects);
  assert.equal(next.clips, project.clips);
  assert.deepEqual(project, before);
  validateProject(next);
  assert.equal(clearCaptionKeywords(next), next);
});

test('global-only cleanup retains the original captions array and cue-only cleanup leaves global empty', () => {
  const project = createDemoProject();
  project.globalKeywords = 'keyword';
  const global = clearCaptionKeywords(freeze(project));
  assert.equal(global.captions, project.captions);
  assert.equal(global.globalKeywords, '');
  const cueOnly = { ...global, captions: [{ start: 0, end: 1, text: 'text', keywords: 'text' }] };
  const next = clearCaptionKeywords(freeze(cueOnly));
  assert.equal(next.globalKeywords, '');
  assert.equal(next.captions[0].keywords, '');
});

test('10,000 mixed-clock and trimmed-out cues retain exact timing, ownership and sidecar bytes', () => {
  const project = createDemoProject();
  project.clips = [{ start: 0, end: 1 }];
  project.speed = 2;
  project.globalKeywords = 'caption';
  project.captions = Array.from({ length: 10000 }, (_, index) => ({
    start: index % 12,
    end: index % 12 + .5,
    text: `caption ${index}`,
    ...(index % 2 ? { basis: 'timeline' } : {}),
    speaker: index % 3 ? '0' : '',
    timing: 'estimated',
    ...(index % 3 ? { keywords: index % 2 ? 'caption' : '' } : {}),
  }));
  validateProject(project);
  const before = structuredClone(project);
  freeze(project);
  const next = clearCaptionKeywords(project);
  validateProject(next);
  assert.equal(next.captions.length, 10000);
  for (let index = 0; index < project.captions.length; index++) {
    const cue = project.captions[index];
    assert.deepEqual(next.captions[index], cue.keywords?.length ? { ...cue, keywords: '' } : cue);
  }
  for (const format of ['srt', 'vtt', 'txt']) {
    assert.equal(projectSubtitles(next, { format }), projectSubtitles(project, { format }));
  }
  assert.equal(projectSubtitles(next, { format: 'txt', review: true }), projectSubtitles(project, { format: 'txt', review: true }));
  assert.deepEqual(project, before);
});

function drawnText(project) {
  const trace = createCanvasTrace();
  createTypographyRenderer(trace.makeCanvas).draw(trace.context, 540, 960, project, 1, 1, project.captions[0]);
  return trace.events.filter(event => event[1] === 'fillText').map(event => ({
    text: event[2],
    color: trace.events.slice(0, trace.events.indexOf(event))
      .filter(prior => prior[0] === event[0] && prior[1] === 'fillStyle').at(-1)?.[2],
  }));
}

test('renderer removes global and cue emphasis but preserves caption and speaker presentation', () => {
  const project = createDemoProject();
  project.design.title.enabled = false;
  project.design.credit.enabled = false;
  project.globalKeywords = 'first';
  project.captions = [{ start: 0, end: 2, text: 'first second third', keywords: 'second', speaker: '0' }];
  project.speakerLabels = ['Host', 'Guest'];
  project.speakerColors[0] = '#123456';
  const next = clearCaptionKeywords(project);
  const before = drawnText(project), after = drawnText(next);
  assert.ok(before.some(item => item.text === 'first' && item.color === project.captionAccent));
  assert.ok(before.some(item => item.text === 'second' && item.color === project.captionAccent));
  assert.ok(after.some(item => item.text === 'first second third' && item.color === '#123456'));
  assert.ok(after.some(item => item.text === 'Host' && item.color === '#123456'));
  project.style = 'highlight';
  assert.deepEqual(drawnText(clearCaptionKeywords(project)), drawnText(project));
});
