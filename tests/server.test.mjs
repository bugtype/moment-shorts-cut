import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {createPreviewServer} from '../scripts/serve.mjs';

// Source-level checks for audited opaque CSS pairs, not a cascade engine or
// native browser/assistive-technology verification.
function declaration(css, selector, property) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const block = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1];
  assert.ok(block, `Missing style owner: ${selector}`);
  const value = block.match(new RegExp(`(?:^|;)\\s*${property}:([^;}]*)`))?.[1]?.trim();
  assert.ok(value, `Missing ${property} in ${selector}`);
  return value;
}
function color(value, shell) {
  const variable = value.match(/var\((--[\w-]+)\)/)?.[1];
  if (variable) return color(declaration(shell, ':root', variable), shell);
  const hex = value.match(/#[\da-f]{6}\b|#[\da-f]{3}\b/i)?.[0];
  assert.ok(hex, `Expected an audited opaque color: ${value}`);
  return hex.length === 4 ? '#' + [...hex.slice(1)].map(digit => digit + digit).join('') : hex;
}
function contrast(first, second) {
  const luminance = hex => {
    const [r,g,b] = hex.slice(1).match(/../g).map(part => {
      const channel = Number.parseInt(part, 16) / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return .2126*r + .7152*g + .0722*b;
  };
  const [low,high] = [luminance(first),luminance(second)].sort((a,b)=>a-b);
  return (high+.05)/(low+.05);
}

test('project-name input keeps the shared form focus outline', async () => {
  const shell = await readFile(new URL('../dist/styles/shell-library.css', import.meta.url), 'utf8');
  const nameStyle = shell.match(/\.project-title input\s*\{([^}]*)\}/)?.[1];
  assert.ok(nameStyle, 'the header name retains its existing style owner');
  // Source contract only: this is not native CSS rendering or a cascade engine.
  assert.match(shell, /input:focus,textarea:focus,select:focus\s*\{[^}]*outline:2px solid var\(--focus\);\s*outline-offset:1px\s*\}/);
  assert.doesNotMatch(nameStyle, /\boutline(?:-[\w-]+)?\s*:/, 'do not suppress the shared input indicator');
});

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
    return contrast(color, '#ffffff');
  });
  // WCAG 2.2 SC 1.4.3 normal-text threshold; do not round before comparing.
  assert.deepEqual(ratios.map(ratio => ratio >= 4.5), [true, true], `Label contrast on white: ${ratios}`);
});

test('shared primary and recording action text retains contrast in normal and hover states', async () => {
  const [shell, dialogs] = await Promise.all(['shell-library','inspector-dialogs']
    .map(name => readFile(new URL(`../dist/styles/${name}.css`, import.meta.url), 'utf8')));
  const foreground = color(declaration(shell, '.button.primary', 'color'), shell);
  const pairs = ['.button.primary','.button.primary:hover'].map(selector =>
    [selector, foreground, color(declaration(shell, selector, 'background'), shell)]);
  pairs.push(['.recording', color(declaration(dialogs, '.recording', 'color'), shell),
    color(declaration(dialogs, '.recording', 'background'), shell)]);
  for (const [name,text,background] of pairs)
    assert.ok(contrast(text,background) >= 4.5, `${name}: ${contrast(text,background)}`);
  // Keep the decorative brand color independent of readable action surfaces.
  assert.equal(declaration(shell, ':root', '--accent'), '#f86747');
});

test('shared keyboard and form focus indicators contrast with the audited light surfaces', async () => {
  const [shell, dialogs, workspace] = await Promise.all(['shell-library','inspector-dialogs','workspace-state']
    .map(name => readFile(new URL(`../dist/styles/${name}.css`, import.meta.url), 'utf8')));
  const surfaces = [declaration(shell, ':root', 'background'), declaration(dialogs, '.notice', 'background'),
    declaration(workspace, '.inspector-section>summary:hover', 'background')].map(value=>color(value,shell));
  const owners = [[shell,'button:focus-visible,a:focus-visible'],[shell,'input:focus,textarea:focus,select:focus'],
    ...['.inspector-section>summary:focus-visible','.caption-workspace #captionRows:focus-visible',
      '.caption-disclosure>summary:focus-visible'].map(selector=>[workspace,selector])];
  for (const [css,selector] of owners) {
    const outline = declaration(css, selector, 'outline');
    assert.match(outline,/^2px solid /,'retain a visible indicator rather than just changing its color');
    for (const background of surfaces) {
      const ratio = contrast(color(outline,shell), background);
      assert.ok(ratio >= 3, `${selector} on ${background}: ${ratio}`);
    }
  }
});

test('dialog instructions and notices, including template overrides, retain readable contrast', async () => {
  const [shell,dialogs,templates] = await Promise.all(['shell-library','inspector-dialogs','templates']
    .map(name => readFile(new URL(`../dist/styles/${name}.css`, import.meta.url), 'utf8')));
  const noticeBackground = color(declaration(dialogs,'.notice','background'),shell);
  const pairs = [
    ['.modal-copy',color(declaration(dialogs,'.modal-copy','color'),shell),color(declaration(dialogs,'dialog','background'),shell)],
    ['.notice',color(declaration(dialogs,'.notice','color'),shell),noticeBackground],
    ['.template-details .notice',color(declaration(templates,'.template-details .notice','color'),shell),noticeBackground],
  ];
  for (const [name,text,background] of pairs)
    assert.ok(contrast(text,background) >= 4.5, `${name}: ${contrast(text,background)}`);
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
  // Static association/content contract, not native label activation or AT behavior.
  for (const [control, key] of [['zoom', 'shell.zoom'], ['volume', 'shell.volume']]) {
    const row = pageHtml.match(new RegExp(`<div class="slider-label">(<label[^>]*for="${control}"[^>]*>[\\s\\S]*?</label>) ([\\s\\S]*?)</div>`));
    assert.ok(row, `${control} has a text label beside, not around, its readout`);
    assert.match(row[1], new RegExp(`id="${control}Label"[^>]*data-i18n="${key.replace('.', '\\.')}"`));
    assert.doesNotMatch(row[1], /<(?:input|output|button|select|textarea|meter|progress)\b/);
    assert.match(row[2], new RegExp(`^<output id="${control}Value" aria-labelledby="${control}Label">100%</output>$`));
    assert.equal([...pageHtml.matchAll(new RegExp(`\\bid="${control}(?:Label|Value)?"`, 'g'))].length, 3);
    assert.match(pageHtml, new RegExp(`<input id="${control}" type="range"[^>]*aria-label="[^"]+"[^>]*data-i18n-aria-label="[^"]+"`));
  }
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
