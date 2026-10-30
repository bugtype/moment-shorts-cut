import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGraphicsText } from '../dist/core/graphics-text.mjs';
import { createDemoProject } from '../dist/core/project.mjs';
import { newCard } from '../dist/effects.mjs';
import { getLocale, setLocale, translateFor } from '../dist/i18n.mjs';

function fixture() {
  const project = createDemoProject();
  project.name = 'PRIVATE_PROJECT_NAME';
  project.fileName = 'PRIVATE_VIDEO_PATH\0.mp4';
  project.audioName = 'PRIVATE_AUDIO_PATH\0.wav';
  project.design.title.lines = ['  Hook <literal> & 한글\r\nnext  ', 'Second 😀\rline'];
  project.design.title.enabled = false;
  project.design.title.start = 1.23456789;
  project.design.title.end = null;
  project.design.credit.text = '  Credit\nline  ';
  project.design.credit.enabled = false;
  project.design.credit.start = 30;
  project.design.credit.end = 40;
  project.overlays = [
    { ...newCard(12), id: 'PRIVATE_CARD_ID_1', text: 'CTA first', label: 'Offer', detail: '  details\r\nunchanged  ', start: 40, end: 50, enabled: false, kind: 'countdown', role: 'free' },
    { ...newCard(12), id: 'PRIVATE_CARD_ID_2', text: 'CTA second', label: 'Label two', detail: 'Second detail', start: 0, end: 1, role: 'headline' },
  ];
  project.captions = [{ start: 0, end: 1, text: 'PRIVATE_CAPTION\0' }];
  return project;
}

test('localized graphics inventory preserves authored strings, order, disabled/off-range values and raw clocks', () => {
  const originalLocale = getLocale();
  const project = fixture();
  const before = structuredClone(project);
  try {
    for (const locale of ['ko', 'en', 'zh-CN']) {
      setLocale(locale, { persist: false });
      const text = projectGraphicsText(project);
      assert.ok(text.startsWith(translateFor(locale, 'graphics.heading')));
      assert.ok(text.includes(`${translateFor(locale, 'graphics.start')}: 1.23456789`));
      assert.ok(text.includes(`${translateFor(locale, 'graphics.end')}: null`));
      assert.ok(text.includes(`${translateFor(locale, 'graphics.enabled')}: false`));
      assert.ok(text.includes(`${translateFor(locale, 'graphics.start')}: 40`));
      assert.ok(text.includes('countdown'));
      assert.ok(text.includes('headline'));
      for (const value of [
        ...project.design.title.lines, project.design.credit.text,
        ...project.overlays.flatMap(card => [card.label, card.text, card.detail]),
      ]) assert.ok(text.includes(value), `Authored value missing in ${locale}`);
      assert.ok(text.indexOf('CTA first') < text.indexOf('CTA second'));
      assert.ok(!text.includes('CTA first ·'), 'No arbitrary countdown digits are synthesized');
      assert.ok(!text.includes('PRIVATE_'), 'No project/media names, IDs or caption content');
      assert.ok(!text.includes(project.overlays[0].color), 'No visual styling inventory');
      assert.deepEqual(project, before);
    }
  } finally {
    setLocale(originalLocale, { persist: false });
  }
});

test('all exported authored fields reject NUL with their original path and leave source intact', () => {
  const cases = [
    ['project.design.title.lines[0]', p => { p.design.title.lines[0] += '\0'; }],
    ['project.design.title.lines[1]', p => { p.design.title.lines[1] += '\0'; }],
    ['project.design.credit.text', p => { p.design.credit.text += '\0'; }],
    ['project.overlays[0].text', p => { p.overlays[0].text += '\0'; }],
    ['project.overlays[1].label', p => { p.overlays[1].label += '\0'; }],
    ['project.overlays[1].text', p => { p.overlays[1].text += '\0'; }],
    ['project.overlays[1].detail', p => { p.overlays[1].detail += '\0'; }],
  ];
  for (const [path, modify] of cases) {
    const project = fixture();
    modify(project);
    const before = structuredClone(project);
    assert.throws(() => projectGraphicsText(project), error =>
      error.code === 'INVALID_ARGUMENT' && error.messageKey === 'errors.graphicsNul' && error.path === path);
    assert.deepEqual(project, before);
  }
});

test('project validation, 12-card maximum, empty authored fields and exact fractional metadata remain bounded', () => {
  const originalLocale = getLocale();
  try {
    setLocale('en', { persist: false });
    const project = createDemoProject();
    project.speed = 4;
    project.design.title.lines = ['', ''];
    project.design.credit.text = '';
    project.overlays = Array.from({ length: 12 }, (_, index) => ({
      ...newCard(12), id: `card-${index}`, text: '한'.repeat(2000),
      detail: '中'.repeat(2000), label: '가'.repeat(2000),
      start: 1e-7, end: 1.2345678901234567,
    }));
    const text = projectGraphicsText(project);
    assert.equal((text.match(/^\[(?:Title|Credit|Card \d+)\]$/gm) || []).length, 14);
    assert.ok(text.includes('Output duration: 3'));
    assert.ok(text.includes('Start: 1e-7'));
    assert.ok(text.includes('End: 1.2345678901234567'));
    assert.ok(Buffer.byteLength(text) < 256 * 1024, 'Existing model bounds keep the text report small');
    project.overlays.push({ ...newCard(12), id: 'extra' });
    assert.throws(() => projectGraphicsText(project));
    assert.throws(() => projectGraphicsText({}));
  } finally {
    setLocale(originalLocale, { persist: false });
  }
});
