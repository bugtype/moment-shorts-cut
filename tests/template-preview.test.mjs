import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplatePreview } from '../dist/template-preview.mjs';
import { TEMPLATES, saveCustomTemplate } from '../dist/template-catalog.mjs';
import { createDemoProject } from '../dist/core/project.mjs';
import { message } from '../dist/i18n.mjs';

function fixture() {
  const controls = new Map(), frames = new Map(), draws = [], dialogs = [], applications = [];
  let frame = 0, time = 100, media = { source: { name: 'sample' }, ready: true };
  const query = selector => {
    if (!controls.has(selector)) {
      const attributes=new Map();
      controls.set(selector, { width:432, height:768, getContext:()=>({}),
        setAttribute:(name,value)=>attributes.set(name,String(value)),
        getAttribute:name=>attributes.get(name)??null,
        removeAttribute:name=>attributes.delete(name) });
    }
    return controls.get(selector);
  };
  const modal = { open: true, classList: { add() {} } };
  const preview = createTemplatePreview({
    composition: { draw: (...args) => draws.push(args) },
    getMedia: () => media, modal, query,
    openModal: (...args) => { dialogs.push(args); modal.open = true; },
    onApply: (template, withContent) => applications.push([template, withContent]),
  }, {
    requestFrame: callback => { frames.set(++frame, callback); return frame; },
    cancelFrame: id => frames.delete(id), clock: () => time,
  });
  return { preview, controls, query, frames, draws, dialogs, modal, applications,
    setMedia: value => { media = value; },
    tick(now) { time = now; const [id, callback] = frames.entries().next().value; frames.delete(id); callback(now); },
  };
}

test('template thumbnails reuse private demo projects and keep original template data intact', () => {
  const f = fixture(), other = fixture(), template = TEMPLATES.find(item => item.id === 'interview');
  const before = structuredClone(template), target = f.query('#canvas');
  f.preview.draw(target, template);
  f.preview.draw(target, template, 2);
  const first = f.draws[0], second = f.draws[1];
  assert.equal(first[3], second[3]);
  assert.deepEqual(first.slice(1, 3), [432, 768]);
  assert.equal(first[4].time, 4.800000000000001);
  assert.equal(second[4].time, .999 * 12);
  assert.ok(first[3].captions.every((caption, index) => caption.speaker === String(index % 2)));
  const media = { source: { name: 'raster' }, ready: false };
  f.setMedia(media);f.preview.draw(target, template, -1);
  assert.equal(f.draws[2][4].source, media.source);
  assert.equal(f.draws[2][4].ready, false);assert.equal(f.draws[2][4].time, 0);
  other.preview.draw(target, template);
  assert.notEqual(first[3], other.draws[0][3]);
  assert.deepEqual(template, before);
});

test('preview play, pause, modal close and apply own only their animation loop', () => {
  const f = fixture(), template = TEMPLATES[0];
  f.preview.open(template);
  assert.equal(f.draws.length, 1);assert.equal(f.frames.size, 0);
  f.query('#toggleTemplateDemo').onclick();
  assert.equal(f.frames.size, 1);
  f.tick(100);assert.equal(f.draws.length, 2);
  f.tick(116);assert.equal(f.draws.length, 2);
  f.tick(134);assert.equal(f.draws.length, 3);
  f.query('#toggleTemplateDemo').onclick();assert.equal(f.frames.size, 0);
  f.query('#toggleTemplateDemo').onclick();f.modal.open = false;f.tick(200);
  assert.equal(f.frames.size, 0);
  f.preview.open(template);f.query('#toggleTemplateDemo').onclick();f.modal.onclose();
  assert.equal(f.frames.size, 0);
  f.preview.open(template);f.query('#toggleTemplateDemo').onclick();f.query('#applyTemplateStyle').onclick();
  assert.equal(f.frames.size, 0);
  f.query('#applyTemplateStructure').onclick();
  assert.deepEqual(f.applications, [[template, false], [template, true]]);
});

test('preview markup escapes template text and retains explicit application consequences', () => {
  const f = fixture(), template = { ...saveCustomTemplate('<name>&',createDemoProject()), description: '<description>&', flow: ['<step>'], source: 'missing' };
  f.preview.open(template);
  const [title, body, footer] = f.dialogs[0];
  assert.equal(title, '<name>&', 'Custom heading stays raw until modalOpen escapes it once');
  assert.match(body, /&lt;description&gt;&amp;/);assert.match(body, /&lt;step&gt;/);
  assert.doesNotMatch(body, /class="reference-link"/);
  assert.match(body, /대사 자막과 영상은 유지됩니다/);
  assert.match(footer, /id="applyTemplateStyle"/);assert.match(footer, /id="applyTemplateStructure"/);
});

test('built-in preview passes a localizable title descriptor, not HTML markup', () => {
  const f=fixture(); f.preview.open(TEMPLATES[0]);
  assert.deepEqual(f.dialogs[0][0],message('templates.builtin.reference.name'));
});
