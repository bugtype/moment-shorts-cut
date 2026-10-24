import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, applyTemplate, templateDisplay, templateSearchText } from '../dist/template-catalog.mjs';
import { createDemoProject, createProjectDocument, readProjectDocument, validateProject, outputDuration } from '../dist/core/project.mjs';
import { prepareCommand } from '../dist/core/commands.mjs';
import { activeSceneLayers, clipEffects, drawSceneCards, newCard, sceneBounds } from '../dist/effects.mjs';
import { createCompositionRenderer } from '../dist/composition-renderer.mjs';
import { mountTemplateGallery } from '../dist/template-gallery.mjs';
import { createCanvasTrace } from './fixtures/canvas-trace.mjs';

const ids = ['hook-result', 'hook-mistake', 'hook-compare', 'hook-experiment', 'hook-quiz', 'hook-myth'];
const hooks = () => ids.map(id => {
  const template = TEMPLATES.find(item => item.id === id);
  assert.ok(template, `Missing ${id}`);
  return template;
});
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('six hook templates deliver an opaque first frame inside the shared safe area', () => {
  for (const template of hooks()) {
    assert.equal(template.hook, true);
    assert.equal(template.category, '초반 훅');
    const project = createDemoProject();
    applyTemplate(project, template, true);
    validateProject(project);
    assert.equal(project.effects.transition, 'none');
    assert.equal(clipEffects(project.effects, 0, 12, 0).opacity, 0);
    assert.equal(activeSceneLayers(project, 0).length, 1);
    const first = activeSceneLayers(project, 0)[0];
    assert.ok(first.text.trim());
    assert.equal(first.role, 'headline');
    assert.equal(first.animation, 'none');
    for (const [width, height] of [[216, 384], [1080, 1920]]) {
      const trace = createCanvasTrace(), labels = [];
      drawSceneCards(trace.context, width, height, project, 0, 12, {
        label(context, value) { labels.push({ value, alpha: context.globalAlpha }); },
      });
      assert.ok(labels.some(item => item.value === first.text && item.alpha === 1), template.id);
      for (const card of project.overlays) {
        assert.equal(card.animation, 'none');
        const bounds = sceneBounds(card, width, height);
        assert.ok(bounds.x - bounds.width / 2 >= width * .05 - 1e-8);
        assert.ok(bounds.x + bounds.width / 2 <= width * .89 + 1e-8);
        assert.ok(bounds.y - bounds.height / 2 >= height * .08 - 1e-8);
        assert.ok(bounds.y + bounds.height / 2 < height * project.captionY);
      }
      const render = createCanvasTrace();
      createCompositionRenderer(render.makeCanvas).draw(render.context, width, height, project, {
        source: { traceName: 'video' }, sw: 540, sh: 960, ready: true,
        sourceTime: 0, time: 0, total: 12, elapsed: 0, remaining: 12, progress: 0,
      });
      assert.ok(render.events.some(event => event[0] === 'output' && event[1] === 'drawImage' && event[2] === 'video'));
      assert.ok(render.events.some(event => event[0] === 'output' && event[1] === 'drawImage' && String(event[2]).startsWith('text-')));
    }
  }
});

test('long outputs keep hook and proof beats within eight seconds without blank boundaries', () => {
  for (const template of hooks()) for (const total of [12, 30, 60]) {
    const project = createDemoProject();
    project.duration = total; project.clips = [{ start: 0, end: total }];
    applyTemplate(project, template, true);
    const expected = [0, template.id === 'hook-quiz' ? 3 : 2, 5, 8, total];
    assert.equal(project.overlays.length, 4);
    for (let index = 0; index < 4; index++) {
      const card = project.overlays[index];
      assert.equal(card.start, expected[index]); assert.equal(card.end, expected[index + 1]);
      assert.deepEqual(activeSceneLayers(project, card.start), [card], `${template.id} at ${card.start}s`);
      assert.deepEqual(activeSceneLayers(project, card.end - 1e-6), [card]);
    }
    assert.deepEqual(activeSceneLayers(project, total), []);
  }
});

test('short outputs compress every beat while reordered source clips and speed use output seconds', () => {
  for (const template of hooks()) for (const total of [.05, 3, 6, 11.9, 15]) {
    const project = createDemoProject();
    project.duration = 100; project.speed = 2;
    project.clips = [{ start: 50, end: 50 + total }, { start: 10, end: 10 + total }];
    const clips = structuredClone(project.clips), captions = structuredClone(project.captions);
    applyTemplate(project, template, true);
    validateProject(project);
    near(outputDuration(project), total);
    const scale = Math.min(1, outputDuration(project) / 12);
    const expected = [0, (template.id === 'hook-quiz' ? 3 : 2) * scale, 5 * scale, 8 * scale, outputDuration(project)];
    for (let index = 0; index < 4; index++) {
      const card = project.overlays[index];
      near(card.start, expected[index]); near(card.end, expected[index + 1]);
      assert.ok(card.end > card.start && card.end <= outputDuration(project));
    }
    assert.deepEqual(project.clips, clips); assert.deepEqual(project.captions, captions);
  }
});

test('hook style-only application preserves authored content and commands round-trip all examples', () => {
  const listed = prepareCommand(createDemoProject(), 'templates.list', {}).data;
  for (const template of hooks()) {
    assert.ok(listed.some(item => item.id === template.id));
    const project = createDemoProject();
    project.kind = 'video'; project.fileName = 'source.mp4'; project.audioName = 'voice.wav';
    project.design.title.lines = ['My title', 'Keep this']; project.design.credit.text = 'My channel';
    project.overlays = [{ ...newCard(12), id: 'authored', text: 'My card' }];
    const original = structuredClone(project);
    const styled = prepareCommand(project, 'template.apply', { templateId: template.id }).project;
    assert.deepEqual(styled.design.title.lines, original.design.title.lines);
    assert.equal(styled.design.credit.text, original.design.credit.text);
    assert.deepEqual(styled.overlays, original.overlays);
    for (const key of ['clips', 'captions', 'fileName', 'audioName', 'audioOffset', 'audioVolume', 'volume', 'speed', 'ratio']) {
      assert.deepEqual(styled[key], original[key]);
    }
    const example = prepareCommand(project, 'template.apply', { templateId: template.id, withContent: true }).project;
    assert.equal(example.templateId, template.id); assert.equal(example.overlays.length, 4);
    assert.deepEqual(example.clips, original.clips); assert.deepEqual(example.captions, original.captions);
    assert.deepEqual(readProjectDocument(JSON.parse(JSON.stringify(createProjectDocument(example)))), example);
    assert.deepEqual(project, original);
  }
});

test('hook category filters all six examples and multilingual category names remain searchable', () => {
  const nodes = new Map();
  const query = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', setAttribute() {}, removeAttribute() {} });
    return nodes.get(selector);
  };
  const root = { innerHTML: '', querySelector: query, querySelectorAll: () => [] };
  mountTemplateGallery(root, { ui: { query: '', category: '초반 훅' }, custom: [], favorites: [] });
  assert.match(root.innerHTML, /data-category="초반 훅" class="active"/);
  const shown = [...query('#templateGrid').innerHTML.matchAll(/data-template-canvas="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(shown, ids);
  for (const template of hooks()) for (const locale of ['ko', 'en', 'zh-CN']) {
    const view = templateDisplay(template, locale), search = templateSearchText(template).toLowerCase();
    assert.ok(view.category && !view.category.startsWith('templates.'));
    assert.ok(search.includes(view.category.toLowerCase()), `${locale} category search`);
    assert.ok(search.includes(view.name.toLowerCase()), `${locale} name search`);
  }
});
