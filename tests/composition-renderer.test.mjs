import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompositionRenderer } from '../dist/composition-renderer.mjs';
import { projectSubtitles } from '../dist/core/project.mjs';
import { createDemoProject, validateProject } from '../dist/core/project.mjs';
import { createPlayback } from '../dist/playback.mjs';
import { newCard } from '../dist/effects.mjs';
import { createCanvasTrace } from './fixtures/canvas-trace.mjs';

const media = { source: { traceName: 'video' }, sw: 100, sh: 200, ready: true,
  sourceTime: 1, time: 1, total: 12, elapsed: 1, remaining: 11, progress: 1 / 12 };

test('composition keeps source geometry and layer order without changing project or media', () => {
  const project = createDemoProject();
  project.design.layout = 'full';
  project.fit = 'contain'; project.zoom = 1; project.panX = .1; project.panY = -.1;
  project.effects.motion = 'none'; project.effects.vignette = .3; project.effects.transition = 'flash';
  const input = { ...media, elapsed: 0, progress: 0 }, before = structuredClone({ project, input });
  const trace = createCanvasTrace(), renderer = createCompositionRenderer(trace.makeCanvas);
  renderer.draw(trace.context, 200, 200, project, input);
  assert.deepEqual(trace.events.find(event => event[1] === 'drawImage' && event[2] === 'video'),
    ['output', 'drawImage', 'video', 70, -20, 100, 200]);
  const output = trace.events.filter(event => event[0] === 'output');
  assert.deepEqual(output.slice(0, 2), [['output', 'fillStyle', project.design.background], ['output', 'fillRect', 0, 0, 200, 200]]);
  const image = output.findIndex(event => event[1] === 'drawImage' && event[2] === 'video');
  const vignette = output.findIndex(event => event[1] === 'createRadialGradient');
  const text = output.findIndex(event => event[1] === 'drawImage' && String(event[2]).startsWith('text-'));
  assert.ok(image < vignette && vignette < text);
  assert.deepEqual(output.slice(-4), [['output', 'globalAlpha', .75], ['output', 'fillStyle', '#ffffff'], ['output', 'fillRect', 0, 0, 200, 200], ['output', 'restore']]);
  assert.deepEqual({ project, input }, before);
});

test('unavailable source omits media/vignette while text cache is reused and explicitly cleared', () => {
  const project = createDemoProject(), trace = createCanvasTrace();
  project.effects.vignette = .5;
  const renderer = createCompositionRenderer(trace.makeCanvas);
  for (const missing of [{ ready: false }, { sw: 0 }, { sh: 0 }]) {
    renderer.draw(trace.context, 540, 960, project, { ...media, ...missing });
  }
  assert.ok(!trace.events.some(event => event[1] === 'drawImage' && event[2] === 'video'));
  assert.ok(!trace.events.some(event => event[1] === 'createRadialGradient'));
  const cached = trace.canvasCount;
  assert.ok(cached > 0);
  renderer.draw(trace.context, 540, 960, project, { ...media, ready: false });
  assert.equal(trace.canvasCount, cached);
  renderer.clear();
  renderer.draw(trace.context, 540, 960, project, { ...media, ready: false });
  assert.equal(trace.canvasCount, cached * 2);
});

test('export caption omission preserves source, title, credit and cards without leaking to later previews', () => {
  const project = createDemoProject();
  project.design.title.lines = ['TITLEONLY']; project.design.title.enabled = true;
  project.design.credit.text = 'CREDITONLY'; project.design.credit.enabled = true;
  project.captions = [{start:0,end:3,text:'CAPTIONONLY'}];
  project.overlays = [{...newCard(12),role:'body',text:'CARDONLY'}];
  const before = structuredClone(project), sidecars = [projectSubtitles(project,{format:"srt"}),projectSubtitles(project,{format:"vtt"})];
  const render = options => {
    const trace = createCanvasTrace(), renderer = createCompositionRenderer(trace.makeCanvas);
    renderer.draw(trace.context, 540, 960, project, media, options);
    return trace.events;
  };
  const clean = render({includeCaptions:false}), normal = render();
  const has = (events, text) => events.some(event => event.includes(text));
  assert.equal(has(clean,'CAPTIONONLY'),false);
  assert.equal(has(normal,'CAPTIONONLY'),true);
  for (const value of ['TITLEONLY','CREDITONLY','CARDONLY','video']) assert.ok(has(clean,value), value);
  assert.deepEqual(project,before);
  assert.deepEqual([projectSubtitles(project,{format:"srt"}),projectSubtitles(project,{format:"vtt"})],sidecars);
});

// One corner's source-over alpha, not native pixels or a general Canvas model.
// These fixtures use full-frame clips and contained media away from that corner.
function alphaSurface(width, height) {
  let alpha = 0;
  const events = [], stack = [], canvas = { width, height };
  const covers = (x, y, w, h) => x <= 0 && y <= 0 && x + w > 0 && y + h > 0;
  const over = value => { alpha = value + alpha * (1 - value); };
  const context = {
    fillStyle: '#000000', globalAlpha: 1,
    clearRect(...rect) { events.push(['clear', ...rect]); if (covers(...rect)) alpha = 0; },
    fillRect(...rect) {
      events.push(['fill', ...rect]);
      if (covers(...rect)) over((this.fillStyle.length === 9 ? parseInt(this.fillStyle.slice(7), 16) / 255 : 1) * this.globalAlpha);
    },
    drawImage(source, ...rect) {
      events.push(['image', ...rect]);
      if (covers(...rect)) over((source.alpha ?? 1) * this.globalAlpha);
    },
    save() { stack.push([this.fillStyle, this.globalAlpha]); },
    restore() { [this.fillStyle, this.globalAlpha] = stack.pop(); },
    beginPath() {}, rect() {}, clip() {},
  };
  Object.defineProperty(canvas, 'alpha', { get: () => alpha });
  return { canvas, context, events, get alpha() { return alpha; } };
}

function alphaProject(color) {
  const project = createDemoProject();
  project.design.background = color; project.design.layout = 'full';
  project.design.title.enabled = false; project.design.credit.enabled = false;
  project.captions = []; project.overlays = []; project.fit = 'contain'; project.ratio = '1:1';
  validateProject(project);
  return project;
}

test('alpha backgrounds replace prior frames without changing opaque composition or input data', () => {
  const renderer = createCompositionRenderer(() => { throw Error('unexpected text raster'); });
  for (const color of ['#11223380', '#11223300', '#112233', '#112233fF']) {
    const project = alphaProject(color), surface = alphaSurface(200, 200);
    const before = structuredClone({ project, media });
    surface.context.fillRect(0, 0, 200, 200); // A previous opaque picture.
    surface.events.length = 0;
    const expected = color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1;
    for (let frame = 0; frame < 3; frame++) {
      renderer.draw(surface.context, 200, 200, project, media);
      assert.equal(surface.alpha, expected, color);
    }
    assert.deepEqual(surface.events.filter(event => event[0] === 'clear'),
      color.length === 9 ? Array.from({ length: 3 }, () => ['clear', 0, 0, 200, 200]) : []);
    assert.deepEqual(surface.events.slice(0, color.length === 9 ? 2 : 1),
      color.length === 9 ? [['clear', 0, 0, 200, 200], ['fill', 0, 0, 200, 200]] : [['fill', 0, 0, 200, 200]]);
    assert.deepEqual({ project, media }, before);
  }
  const failure = new Error('clear failed'), project = alphaProject('#11223300');
  let observations = 0;
  const observed = createCompositionRenderer(() => {}, { getFonts: () => { observations++; return null; } });
  assert.throws(() => observed.draw({ clearRect() { throw failure; } }, 200, 200, project, media), error => error === failure);
  assert.equal(observations, 2, 'existing final font observation still runs on failure');
});

test('export mirroring replaces alpha frames at preview dimensions and returns to ordinary painting', () => {
  const project = alphaProject('#11223380'), before = structuredClone(project);
  const preview = alphaSurface(200, 200), output = alphaSurface(400, 400);
  const app = {
    state: project, current: 1, locate: time => ({ index: 0, source: time }), duration: () => 12,
    composition: createCompositionRenderer(() => { throw Error('unexpected text raster'); }),
    sample: { complete: true }, sampleRaster: {}, mediaReady: () => true,
    videoExport: { context: output.context, canvas: output.canvas, renderOptions: { includeCaptions: false } },
    exporting: true, ctx: preview.context, canvas: preview.canvas,
  };
  const owner = createPlayback(app);
  for (const time of [1, 9, 1]) {
    app.current = time; owner.draw();
    assert.equal(output.alpha, 128 / 255);
    assert.equal(preview.alpha, output.alpha, 'a fresh export surface must replace, not blend over, the last preview');
  }
  assert.deepEqual(preview.events, Array.from({ length: 3 }, () =>
    [['clear', 0, 0, 200, 200], ['image', 0, 0, 200, 200]]).flat());
  assert.deepEqual(output.events.filter(event => event[0] === 'clear'),
    Array.from({ length: 3 }, () => ['clear', 0, 0, 400, 400]));
  app.exporting = false; owner.draw();
  assert.equal(preview.alpha, 128 / 255);
  assert.deepEqual(project, before);
});
