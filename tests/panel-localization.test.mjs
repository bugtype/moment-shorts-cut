import test from 'node:test';
import assert from 'node:assert/strict';
import { messages } from '../dist/i18n/catalogs/panels.mjs';
import { setLocale, initLocale, t, message } from '../dist/i18n.mjs';
import { captionsPanelMarkup, mediaPanelMarkup, audioPanelMarkup, settingsPanelMarkup } from '../dist/panel-markup.mjs';
import { mountEffectsPanel } from '../dist/effects-panel.mjs';

const locales = ['ko', 'en', 'zh-CN'];
const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
const options = { toolsOpen: true, transcribing: true, hasAudio: true };

test('panel catalogs have matching semantic keys and interpolation parameters', () => {
  const keys = Object.keys(messages.ko).sort();
  assert.ok(keys.length > 200);
  for (const locale of locales) {
    assert.deepEqual(Object.keys(messages[locale]).sort(), keys);
    for (const key of keys) {
      assert.ok(messages[locale][key].trim(), key);
      assert.deepEqual(placeholders(messages[locale][key]), placeholders(messages.ko[key]), key);
    }
  }
});

test('localized caption panels preserve content, values, paging and descriptor status', () => {
  initLocale();
  try {
    const project = {
      captions: Array.from({ length: 51 }, (_, index) => ({
        start: index, end: index + 1, text: '<保留 & 원문>', speaker: '0', keywords: '<tag>',
      })),
      speakerLabels: ['<speaker>'],
    };
    const before = JSON.stringify(project);
    for (const locale of locales) {
      setLocale(locale, { persist: false });
      const html = captionsPanelMarkup(project, {
        ...options, transcriptionStatus: message('panels.shifted', { count: 3 }),
      });
      assert.ok(html.includes(t('panels.captionsCount', { count: 51 })));
      assert.ok(html.includes(t('panels.shifted', { count: 3 })));
      assert.ok(html.includes('&lt;保留 &amp; 원문&gt;'));
      assert.ok(html.includes('&lt;speaker&gt;'));
      assert.ok(html.includes('value="korean"'));
      assert.ok(html.includes('data-caption-text="49"'));
      assert.ok(!html.includes('data-caption-text="50"'));
      assert.ok(!html.includes('[object Object]'));
      assert.doesNotMatch(html, /<option[^>]*>\s*<span/);
      assert.equal((html.match(/class="caption-row"/g) || []).length, 50);
      assert.ok(html.length < 180_000, 'bounded page including locale markers');
      const page2 = captionsPanelMarkup(project, { ...options, transcriptionStatus: '', page: 1 });
      assert.ok(page2.includes('data-caption-text="50"'));
      assert.equal((page2.match(/class="caption-row"/g) || []).length, 1);
    }
    assert.equal(JSON.stringify(project), before);
  } finally { initLocale(); }
});

test('asset and settings panels localize UI without translating asset names or enums', () => {
  initLocale();
  try {
    for (const locale of locales) {
      setLocale(locale, { persist: false });
      const media = mediaPanelMarkup({ kind: 'demo', duration: 12, fileName: '<我的영상>' }, '');
      assert.ok(media.includes('&lt;我的영상&gt;'));
      assert.ok(media.includes(t('panels.chooseVideo')));
      assert.ok(media.includes('500 MiB'));
      const audio = audioPanelMarkup({ audioName: '<我的음성>', audioOffset: 2, audioVolume: .5, speed: 2 }, true, 12);
      assert.ok(audio.includes('&lt;我的음성&gt;'));
      assert.ok(audio.includes(t('panels.replaceAudio')));
      assert.ok(audio.includes('value="1"'));
      const settings = settingsPanelMarkup({ ratio: '9:16', fit: 'cover', zoom: 1, captionSize: 30, captionY: .8, volume: 1 }, { start: 0, end: 12 });
      assert.ok(settings.includes(t('panels.frameComposition')));
      assert.ok(settings.includes('data-fit="cover"'));
      assert.ok(settings.includes('data-ratio="9:16"'));
    }
  } finally { initLocale(); }
});

function fixture() {
  const nodes = new Map();
  const node = () => ({
    innerHTML: '',
    querySelectorAll: () => [],
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, node());
      return nodes.get(selector);
    },
  });
  return node();
}

test('effects controls translate empty and populated cards without changing authored content', () => {
  initLocale();
  try {
    for (const locale of locales) {
      setLocale(locale, { persist: false });
      for (const tab of ['cards', 'motion']) {
        for (const overlays of [[], [{ id: 'card-1', text: '<作者 & 원문>', label: '', start: 0, end: 2 }]]) {
          const state = { effects: {}, overlays };
          const before = JSON.stringify(state);
          const root = fixture();
          mountEffectsPanel(root, { state, tab, total: 10, selected: 'card-1' });
          const html = root.innerHTML + root.querySelector('#effectControls').innerHTML;
          assert.ok(html.includes(t('panels.effects')));
          assert.ok(html.includes(t('panels.timedCards')));
          assert.doesNotMatch(html, /<option[^>]*>\s*<span/);
          if (tab === 'cards' && overlays.length) assert.ok(html.includes('&lt;作者 &amp; 원문&gt;'));
          if (tab === 'cards' && !overlays.length) assert.ok(html.includes(t('panels.cardEmpty')));
          assert.equal(JSON.stringify(state), before);
        }
      }
    }
  } finally { initLocale(); }
});
