import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptionPanel } from '../dist/caption-panel.mjs';
import { createDemoProject } from '../dist/core/project.mjs';

function fixture() {
  let project = createDemoProject();
  const nodes = new Map(), log = [];
  function query(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: '', dataset: {},
      focus: options => log.push(['focus', selector, options]),
      scrollIntoView: options => log.push(['scroll', selector, options]),
      click: () => log.push(['click', selector]),
    });
    return nodes.get(selector);
  }
  const fields = ['text', 'keywords', 'speaker', 'start', 'end'];
  function queryAll(selector) {
    const field = fields.find(name => selector === `[data-caption-${name}]`);
    if (field) {
      const control = query(selector);
      control.dataset['caption' + field[0].toUpperCase() + field.slice(1)] = '0';
      return [control];
    }
    if (selector === '[data-delete-caption]') {
      const control = query(selector);
      control.dataset.deleteCaption = '0';
      return [control];
    }
    return [];
  }
  const panel = createCaptionPanel({
    query, queryAll, getProject: () => project, getDuration: () => 6, sourceTime: () => 2,
    edit: (change, refresh) => { log.push(['edit', refresh]); change(); },
    refresh: () => log.push('refresh'), toast: message => log.push(['toast', message]),
  });
  const target = { querySelector: () => ({ open: true }), innerHTML: '' };
  panel.render(target, { transcribing: false, hasAudio: false, transcriptionStatus: '' }, {
    design: () => log.push('design'), generate: () => log.push('generate'),
    download: format => log.push(['download', format]),
  });
  return { panel, query, target, log, project: () => project, replace: value => { project = value; } };
}

test('caption row handlers read the current project and preserve field metadata', () => {
  const f = fixture(), old = f.project(), replacement = createDemoProject();
  replacement.captions = [{ start: 1, end: 4, text: 'current', basis: 'timeline', timing: 'estimated' }];
  f.replace(replacement);
  const text = f.query('[data-caption-text]');
  text.value = 'edited 🎬'; text.onchange();
  assert.equal(f.project().captions[0].text, 'edited 🎬');
  assert.notEqual(old.captions[0].text, 'edited 🎬');
  assert.equal(f.project().captions[0].timing, 'estimated');
  const end = f.query('[data-caption-end]');
  end.value = '7'; end.onchange();
  assert.equal(f.project().captions[0].end, 4);
  assert.equal(f.log.at(-1), 'refresh');
  end.value = '5'; end.onchange();
  assert.equal(f.project().captions[0].end, 5);
});

test('caption delete/add retain focus scrolling and route existing actions', () => {
  const f = fixture();
  f.project().captions = [{ start: 0, end: 1, text: 'only' }];
  f.query('[data-delete-caption]').onclick();
  assert.equal(f.project().captions.length, 0);
  assert.deepEqual(f.log.slice(-2).map(event => event.slice(0, 2)), [
    ['focus', '#addCaption'], ['scroll', '#addCaption'],
  ]);
  f.query('#addCaption').onclick();
  assert.deepEqual(f.project().captions[0], { start: 2, end: 5, text: '새로운 자막을 입력하세요' });
  assert.deepEqual(f.log.at(-2), ['focus', '[data-caption-text="0"]', { preventScroll: true }]);
  for (const id of ['captionDesignShortcut', 'generateCaptions', 'downloadSrt', 'importSrt']) f.query('#' + id).onclick();
  assert.deepEqual(f.log.slice(-4), ['design', 'generate', ['download', 'srt'], ['click', '#srtInput']]);
});

test('caption split preserves a no-op and sends real grapheme splits through edit once', () => {
  const f = fixture();
  f.project().captions = [{ start: 0, end: 2, text: 'short', basis: 'timeline' }];
  f.query('#captionChunkSize').value = '12';
  const original = f.project().captions;
  f.query('#splitLongCaptions').onclick();
  assert.equal(f.project().captions, original);
  assert.ok(!f.log.some(event => event[0] === 'edit'));
  f.project().captions = [{ start: 0, end: 4, text: 'e\u0301'.repeat(24), basis: 'timeline', speaker: '1' }];
  f.query('#splitLongCaptions').onclick();
  assert.equal(f.project().captions.length, 2);
  assert.ok(f.project().captions.every(caption => caption.text === 'e\u0301'.repeat(12) && caption.speaker === '1'));
  assert.equal(f.log.filter(event => event[0] === 'edit').length, 1);
});


test('caption export buttons pass formats rather than click events', () => {
  const f = fixture();
  const event = { type: 'click' };
  f.query('#downloadSrt').onclick(event);
  f.query('#downloadVtt').onclick(event);
  assert.deepEqual(f.log, [['download', 'srt'], ['download', 'vtt']]);
  assert.match(f.target.innerHTML, /id="downloadSrt">SRT 저장<\/button><button class="button" id="downloadVtt">VTT 저장/);
});
