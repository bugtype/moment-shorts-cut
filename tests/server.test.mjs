import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createPreviewServer} from '../scripts/serve.mjs';

test('preview serves modules with correct MIME types and never serves repository files', async t => {
  const server = createPreviewServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /모먼트/);
  const module = await fetch(`${origin}/core/project.mjs`);
  assert.equal(module.status, 200);
  assert.match(module.headers.get('content-type'), /text\/javascript/);
  assert.equal(module.headers.get('x-content-type-options'), 'nosniff');
  // Fetch the complete static module graph through the same entry URL as the page.
  const modules = new Map();
  async function checkModule(path, ancestors = []) {
    assert.ok(!ancestors.includes(path), `Circular module dependency: ${[...ancestors, path].join(' → ')}`);
    if (modules.has(path)) return;
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/javascript/, path);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const source = await response.text();
    modules.set(path, source);
    for (const match of source.matchAll(/^(?:import|export)\b[^;\n]*\bfrom\s*['"](\.[^'"]+)['"]/gm)) {
      const importedPath = new URL(match[1], origin + path).pathname;
      await checkModule(importedPath, [...ancestors, path]);
    }
  }
  await checkModule('/app.js');
  assert.ok(modules.has('/panel-markup.mjs'));
  assert.ok(modules.has('/ui-format.mjs'));
  assert.ok(modules.has('/transcription-client.mjs'));
  assert.ok(modules.has('/audio-recording.mjs'));
  assert.ok(modules.has('/video-export.mjs'));
  assert.ok(modules.has('/template-preview.mjs'));
  assert.ok(modules.has('/editor-interactions.mjs'));
  assert.ok(modules.has('/inspector-view.mjs'));
  assert.ok(modules.has('/timeline-view.mjs'));
  await checkModule('/transcribe-worker.js');
  const stylesheet = await fetch(`${origin}/style.css`);
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get('content-type'), /text\/css/);
  const css = await stylesheet.text();
  const imports = [...css.matchAll(/@import url\("(\.\/styles\/[^"\n]+)"\);/g)].map(match => match[1]);
  assert.deepEqual(imports, ['shell-library', 'preview-timeline', 'inspector-dialogs', 'responsive', 'design', 'templates', 'workspace-state', 'mobile-shell'].map(name => `./styles/${name}.css`), 'Keep the existing cascade order');
  for (const path of imports) {
    const response = await fetch(new URL(path, `${origin}/style.css`));
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/css/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.ok((await response.text()).trim().length > 0);
  }
  for (const pathname of ['/package.json', '/.git/config', '/%2e%2e/package.json', '/..%2fpackage.json', '/missing.js']) {
    assert.equal((await fetch(origin + pathname)).status, 404, pathname);
  }
  assert.equal((await fetch(origin + '/%GG')).status, 400);
  const head = await fetch(origin, {method:'HEAD'});
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await fetch(origin, {method:'POST'})).status, 405);
});
