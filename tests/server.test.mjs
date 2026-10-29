import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {createPreviewServer} from '../scripts/serve.mjs';

test('active form-label colors retain contrast on authored white panel surfaces', async () => {
  const [shell, dialogs, responsive] = await Promise.all(['shell-library', 'inspector-dialogs', 'responsive']
    .map(name => readFile(new URL(`../dist/styles/${name}.css`, import.meta.url), 'utf8')));
  assert.match(shell, /:root\s*\{[^}]*\bbackground:#fff\s*;/);
  assert.match(dialogs, /\.inspector\s*\{[^}]*\bbackground:#fff\s*\}/);
  // These are the audited declarations, not a CSS cascade engine. Time labels
  // have higher specificity than the later grouped labels; both need coverage.
  const colors = [
    responsive.match(/\.panel-label,\.field-label,\.slider-label\s*\{[^}]*\bcolor:(#[\da-f]{6})\s*\}/i)?.[1],
    dialogs.match(/\.time-fields label\s*\{[^}]*\bcolor:(#[\da-f]{6})\s*;/i)?.[1],
  ];
  const ratios = colors.map(color => {
    assert.match(color ?? '', /^#[\da-f]{6}$/i);
    const [r, g, b] = color.slice(1).match(/../g).map(hex => {
      const channel = Number.parseInt(hex, 16) / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return 1.05 / (.2126 * r + .7152 * g + .0722 * b + .05);
  });
  // WCAG 2.2 SC 1.4.3 normal-text threshold; do not round before comparing.
  assert.deepEqual(ratios.map(ratio => ratio >= 4.5), [true, true], `Label contrast on white: ${ratios}`);
});

test('preview serves modules with correct MIME types and never serves repository files', async t => {
  const server = createPreviewServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  const pageHtml = await page.text();
  assert.match(pageHtml, /모먼트/);
  // The preview owns the full center column: ratio and safe-area controls share
  // its bottom row instead of consuming a separate toolbar above the canvas.
  assert.doesNotMatch(pageHtml, /class="stage-toolbar"/);
  assert.match(pageHtml, /<div class="stage-bottom">[\s\S]*?id="ratioShortcut"[\s\S]*?id="safeButton"/);
  // The timeline corner owns the zoom level so long projects stay readable.
  assert.match(pageHtml, /id="timelineZoom"[^>]*aria-label="타임라인 확대, 현재 1배"/);
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
  assert.deepEqual(imports, ['shell-library', 'preview-timeline', 'inspector-dialogs', 'responsive', 'design', 'templates', 'workspace-state', 'mobile-shell', 'shell-fit'].map(name => `./styles/${name}.css`), 'Keep the existing cascade order');
  const sampleSvg = await readFile(new URL('../dist/sample.svg', import.meta.url), 'utf8');
  const stylesheetAssets = [];
  for (const path of imports) {
    const stylesheetUrl = new URL(path, `${origin}/style.css`);
    const response = await fetch(stylesheetUrl);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/css/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const source = await response.text();
    assert.ok(source.trim().length > 0);
    // Current local assets use quoted relative URLs. Resolve from the CSS file,
    // not the HTML document; moving a stylesheet must not silently break them.
    for (const match of source.matchAll(/url\(\s*(['"])(\.[^'"]+)\1\s*\)/g)) {
      const assetUrl = new URL(match[2], stylesheetUrl);
      assert.equal(assetUrl.origin, origin);
      const asset = await fetch(assetUrl);
      assert.equal(asset.status, 200, `${stylesheetUrl.pathname}: ${match[2]}`);
      assert.match(asset.headers.get('content-type'), /image\/svg\+xml/);
      assert.equal(await asset.text(), sampleSvg);
      stylesheetAssets.push([stylesheetUrl.pathname, assetUrl.pathname]);
      // The same relative binding must survive hosting the editor in a subdirectory.
      const nested = new URL(match[2], `${origin}/editor${stylesheetUrl.pathname}`);
      assert.equal(nested.pathname, `/editor${assetUrl.pathname}`);
    }
  }
  assert.deepEqual(stylesheetAssets, [
    ['/styles/preview-timeline.css', '/sample.svg'],
    ['/styles/design.css', '/sample.svg'],
    ['/styles/design.css', '/sample.svg'],
  ]);
  const responsive = await (await fetch(`${origin}/styles/responsive.css`)).text();
  // Phones trade the wordmark for the project name so it stays editable.
  assert.match(responsive, /\.brand>span:last-child \{\s*display:none\s*\}/);
  assert.match(responsive, /\.project-title \{\s*display:flex;\s*flex:1 1 auto;\s*min-width:0\s*\}/);
  const dialogs = await (await fetch(`${origin}/styles/inspector-dialogs.css`)).text();
  // Keep the normal busy indicator, but suppress only its rotation for reduced motion.
  assert.match(dialogs, /\.spinner\s*\{[^}]*animation:spin 1s linear infinite/);
  assert.match(responsive, /@media\(prefers-reduced-motion:reduce\)\s*\{\s*\*\s*\{[^}]*\}\s*\.spinner\s*\{\s*animation:none\s*\}\s*\}/);
  // Short landscape screens compact the modal after the base rhythm so its
  // primary action never hides below the fold.
  const compactDialog = dialogs.indexOf('@media(max-height:560px)');
  assert.ok(compactDialog > dialogs.indexOf('.modal-foot {'), 'compact modal rules must win the cascade');
  assert.match(dialogs.slice(compactDialog), /\.modal-foot \{\s*margin-top:14px/);
  assert.match(dialogs, /@media\(max-height:400px\)/);
  const compactShell = await (await fetch(`${origin}/styles/mobile-shell.css`)).text();
  // Expanding the timeline on a short landscape screen focuses the tracks and
  // hands them the height above the fixed rail instead of scrolling the page.
  assert.match(compactShell, /\.editor-area:has\(\.timeline:not\(\.collapsed\)\) \.stage \{\s*display:none\s*\}/);
  assert.match(compactShell, /\.editor-area:has\(\.timeline:not\(\.collapsed\)\) \.timeline-body \{\s*flex:1;\s*min-height:0;\s*overflow-y:auto;/);
  // Compact screens grow tap targets inside the same 45px tool row, and phones
  // wrap the player so the scrubber spans the full width.
  assert.match(compactShell, /\.player-bar \.icon-button,\.player-bar \.play-button \{\s*width:38px;\s*height:38px/);
  assert.match(compactShell, /\.timeline-tools \.icon-button \{\s*width:36px;\s*height:36px/);
  assert.match(compactShell, /@media \(max-width:430px\) \{\s*\.editor-area \{\s*--player-h:98px\s*\}\s*\.player-bar \{\s*flex-wrap:wrap/);
  assert.match(compactShell, /\.player-bar \.cut-seek-group \{\s*order:10;\s*flex:1 0 100%/);
  // Short portrait phones cap the stage so the player stays above the fixed rail.
  assert.match(compactShell, /--player-h:98px/);
  assert.match(compactShell, /@media \(max-width:700px\) and \(max-height:640px\) and \(orientation:portrait\) \{\s*\.stage \{\s*flex:0 0 auto;\s*height:calc\(100dvh - 66px - 58px - var\(--player-h,56px\)/);
  // The stage chrome and the project name are controls too: compact screens give
  // them thumb-sized height without taking any room away from the preview.
  assert.match(compactShell, /\.stage-bottom \{\s*bottom:6px\s*\}/);
  assert.match(compactShell, /\.stage-ratio,\.stage-bottom \.text-button \{\s*min-height:32px;\s*padding-top:0;\s*padding-bottom:0\s*\}/);
  assert.match(compactShell, /\.project-title input \{\s*padding:7px 0\s*\}/);
  for (const pathname of ['/package.json', '/.git/config', '/%2e%2e/package.json', '/..%2fpackage.json', '/missing.js']) {
    assert.equal((await fetch(origin + pathname)).status, 404, pathname);
  }
  assert.equal((await fetch(origin + '/%GG')).status, 400);
  const head = await fetch(origin, {method:'HEAD'});
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await fetch(origin, {method:'POST'})).status, 405);
});
