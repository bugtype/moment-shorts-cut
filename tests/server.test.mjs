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
  for (const pathname of ['/package.json', '/.git/config', '/%2e%2e/package.json', '/..%2fpackage.json', '/missing.js']) {
    assert.equal((await fetch(origin + pathname)).status, 404, pathname);
  }
  assert.equal((await fetch(origin + '/%GG')).status, 400);
  const head = await fetch(origin, {method:'HEAD'});
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await fetch(origin, {method:'POST'})).status, 405);
});
