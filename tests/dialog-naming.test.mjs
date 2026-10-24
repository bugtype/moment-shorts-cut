import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createShellPresentation} from '../dist/shell-presentation.mjs';
import {createExportFlow} from '../dist/export-flow.mjs';
import {initLocale, setLocale, message, translateFor} from '../dist/i18n.mjs';

// Code/markup contracts only, not native accessibility-tree or screen-reader QA.
const heading = (modal, key, locale) => {
  assert.equal((modal.innerHTML.match(/id="modalTitle"/g) || []).length, 1);
  assert.match(modal.innerHTML, /<h2 id="modalTitle">/);
  assert.ok(modal.innerHTML.includes(`data-i18n="${key}"`));
  assert.ok(modal.innerHTML.includes(translateFor(locale, key)));
};
function controls() {
  const nodes = new Map();
  return id => {
    if (!nodes.has(id)) nodes.set(id, {focus() {}});
    return nodes.get(id);
  };
}

test('native dialog names its existing visible localized heading without extra copy', () => {
  const html = fs.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.match(html, /<dialog id="modal" aria-labelledby="modalTitle"><\/dialog>/);
  const query = controls(), modal = {showModal() {this.open = true;}, close() {this.open = false;}};
  const shell = createShellPresentation({query, modal});
  try {
    for (const locale of ['ko', 'en', 'zh-CN']) {
      setLocale(locale, {persist: false});
      shell.modalOpen(message('shell.projectFiles'), '<input id="draft">');
      heading(modal, 'shell.projectFiles', locale);
      query('#closeModal').onclick();
      assert.equal(modal.open, false);
      shell.modalOpen(message('shell.help'), '<p>Unchanged authored text</p>');
      heading(modal, 'shell.help', locale);
      assert.ok(modal.innerHTML.includes('Unchanged authored text'));
    }
  } finally { initLocale(); }
});

test('export preparation, recording and completion retain the same heading reference', async () => {
  try {
    for (const locale of ['ko', 'en', 'zh-CN']) {
      setLocale(locale, {persist: false});
      let ready, callbacks, downloads = 0;
      const prepared = new Promise(resolve => {ready = resolve;});
      const modal = {innerHTML: ''};
      const videoExport = {
        begin() {this.request = 1; return 1;}, createSurface() {}, release() {},
        capture(request, type, quality, stream, handlers) {callbacks = handlers; return {start() {}};},
      };
      const app = {query: controls(), modal, videoExport, toast() {},
        mediaBlocked: () => false, audioRecording: {}, pause() {}, ensureAudio: () => prepared,
        state: {kind: 'demo', ratio: '9:16', speed: 1, name: 'Authored project'},
        seekTo() {}, draw() {}, play() {}, duration: () => 12,
        playback: {destination: {stream: {}}}, download() {downloads++;},
      };
      const flow = createExportFlow(app, {body: () => ({classList: {add() {}}}), fontsReady: async () => {}});
      const running = flow.startExport({ext: 'webm'}, 720);
      heading(modal, 'shell.exportPreparing', locale);
      ready(); await running;
      heading(modal, 'shell.exportRunning', locale);
      callbacks.onStop(new Blob(['synthetic bytes, not encoded media']));
      heading(modal, 'shell.exportDone', locale);
      assert.equal(downloads, 1);
      assert.equal(app.state.name, 'Authored project');
    }
  } finally { initLocale(); }
});
