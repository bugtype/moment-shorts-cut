import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptionPanel } from '../dist/caption-panel.mjs';
import { createDemoProject } from '../dist/core/project.mjs';
import { initLocale, setLocale, formatError, t } from '../dist/i18n.mjs';

test('caught caption validation retains message metadata for a visible toast language switch', () => {
  initLocale();
  const project = createDemoProject(), before = JSON.stringify(project);
  const nodes = new Map(), notices = [];
  const query = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: '', dataset: {}, attributes: {},
      setAttribute(name, value) { this.attributes[name] = String(value); },
      removeAttribute(name) { delete this.attributes[name]; },
    });
    return nodes.get(selector);
  };
  const panel = createCaptionPanel({
    query, queryAll: () => [], getProject: () => project,
    getDuration: () => project.duration, sourceTime: () => 0,
    edit() { assert.fail('validation must not edit'); },
    refresh() {}, toast: notice => notices.push(notice),
  });
  try {
    panel.render({ innerHTML: '', querySelector: () => null }, {}, {});
    query('#captionShiftDelta').value = '';
    query('#captionShiftDelta').onchange();
    query('#shiftCaptionTiming').onclick();
    assert.equal(notices.length, 1);
    assert.equal(notices[0].messageKey, 'panels.enterShift');
    for (const locale of ['ko', 'en', 'zh-CN']) {
      setLocale(locale, { persist: false });
      assert.equal(formatError(notices[0]), t('panels.enterShift'));
    }
    assert.equal(JSON.stringify(project), before);
  } finally { initLocale(); }
});
