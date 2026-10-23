import test from 'node:test';
import assert from 'node:assert/strict';
import { bindPreviewDrag, bindEditorKeyboard } from '../dist/editor-interactions.mjs';
import { createDemoProject } from '../dist/core/project.mjs';

function fixture(mode = 'video') {
  let project = createDemoProject(), blocked = false;
  const events = [], history = [];
  const canvas = { setPointerCapture: id => events.push(['capture', id]), getBoundingClientRect: () => ({ width: 100, height: 200 }) };
  bindPreviewDrag(canvas, {
    getProject: () => project, blocked: () => blocked,
    pause: () => events.push('pause'), selection: () => ({ mode }),
    snapshot: () => history.push(structuredClone(project)),
    preview: () => events.push('preview'), commit: () => events.push('commit'),
  });
  return { canvas, events, history, get project() { return project; },
    replace: value => { project = value; }, block: () => { blocked = true; } };
}
const pointer = (x, y) => ({ clientX: x, clientY: y, pointerId: 7 });

test('drag snapshots only its first real movement and commits once on pointer cancellation', () => {
  const f = fixture();
  f.canvas.onpointerdown(pointer(0, 0));f.canvas.onpointermove(pointer(0, 0));f.canvas.onpointerup();
  assert.equal(f.history.length, 0);assert.ok(!f.events.includes('commit'));
  f.canvas.onpointerdown(pointer(0, 0));f.canvas.onpointermove(pointer(10, 20));f.canvas.onpointermove(pointer(20, 40));
  assert.equal(f.history.length, 1);assert.equal(f.history[0].panX, 0);
  assert.equal(f.project.panX, .2);assert.equal(f.project.panY, .2);
  f.canvas.onpointercancel();f.canvas.onpointerup();
  assert.equal(f.events.filter(event => event === 'commit').length, 1);
  f.project.panX = 1;f.project.panY = 1;
  f.canvas.onpointerdown(pointer(0, 0));f.canvas.onpointermove(pointer(500, 500));f.canvas.onpointerup();
  assert.equal(f.history.length, 1, 'Clamped no-op retains history');
});

test('blocked, disabled and replaced targets never apply stale gesture mutations', () => {
  const f = fixture('title');
  f.project.design.title.enabled = false;
  f.canvas.onpointerdown(pointer(0, 0));f.canvas.onpointermove(pointer(10, 10));f.canvas.onpointerup();
  assert.equal(f.history.length, 0);
  f.project.design.title.enabled = true;
  f.canvas.onpointerdown(pointer(0, 0));f.canvas.onpointermove(pointer(10, 10));
  const replacement = createDemoProject(), before = structuredClone(replacement);
  f.replace(replacement);f.canvas.onpointermove(pointer(20, 20));f.canvas.onpointercancel();
  assert.deepEqual(replacement, before);assert.ok(!f.events.includes('commit'));
  f.block();f.canvas.onpointerdown(pointer(0, 0));f.canvas.onpointermove(pointer(20, 20));
  assert.deepEqual(replacement, before);
});

test('keyboard controller retains native form/button Space behavior and global shortcut order', () => {
  let handler, blocked = false;
  const events = [], document = { addEventListener(name, callback) { assert.equal(name, 'keydown');handler = callback; } };
  bindEditorKeyboard(document, { blocked: () => blocked, togglePlayback: () => events.push('toggle'), undo: redo => events.push(['undo', redo]), seekBy: delta => events.push(['seek', delta]) });
  const press = (tagName, key, extra = {}) => handler({ target: { tagName }, key, code: key === ' ' ? 'Space' : key, preventDefault: () => events.push('prevent'), ...extra });
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'SUMMARY', 'BUTTON']) press(tag, ' ');
  assert.deepEqual(events, []);
  press('BODY', ' ');press('BUTTON', 'Z', { ctrlKey: true, shiftKey: true });press('BUTTON', 'ArrowLeft');press('BUTTON', 'ArrowRight');
  assert.deepEqual(events, ['prevent', 'toggle', 'prevent', ['undo', true], ['seek', -1], ['seek', 1]]);
  blocked = true;press('BODY', ' ');press('BODY', 'ArrowRight');
  assert.equal(events.length, 6);
});
