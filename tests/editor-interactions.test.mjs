import test from 'node:test';
import assert from 'node:assert/strict';
import { bindPreviewDrag, bindEditorKeyboard } from '../dist/editor-interactions.mjs';
import { createDemoProject } from '../dist/core/project.mjs';
import { newCard } from '../dist/effects.mjs';

function fixture(mode = 'video') {
  let project = createDemoProject(), blocked = false;
  if (mode === 'scene') project.overlays = [newCard(12)];
  const events = [], history = [];
  const canvas = { setPointerCapture: id => events.push(['capture', id]), getBoundingClientRect: () => ({ width: 100, height: 200 }) };
  bindPreviewDrag(canvas, {
    getProject: () => project, blocked: () => blocked,
    pause: () => events.push('pause'), selection: () => ({ mode, scene: mode === 'scene' ? project.overlays[0] : null }),
    snapshot: () => history.push(structuredClone(project)),
    preview: () => events.push('preview'), commit: () => events.push('commit'),
  });
  return { canvas, events, history, get project() { return project; },
    replace: value => { project = value; }, block: () => { blocked = true; } };
}
const pointer = (x, y) => ({ clientX: x, clientY: y, pointerId: 7 });

test('drag snapshots only its first real movement and commits once on pointer cancellation', () => {
  const f = fixture();
  f.canvas.onpointerdown(pointer(0, 0));f.canvas.onpointermove(pointer(0, 0));f.canvas.onpointerup(pointer(0, 0));
  assert.equal(f.history.length, 0);assert.ok(!f.events.includes('commit'));
  f.canvas.onpointerdown(pointer(0, 0));f.canvas.onpointermove(pointer(10, 20));f.canvas.onpointermove(pointer(20, 40));
  assert.equal(f.history.length, 1);assert.equal(f.history[0].panX, 0);
  assert.equal(f.project.panX, .2);assert.equal(f.project.panY, .2);
  f.canvas.onpointercancel(pointer(0, 0));f.canvas.onpointerup(pointer(0, 0));
  assert.equal(f.events.filter(event => event === 'commit').length, 1);
  f.project.panX = 1;f.project.panY = 1;
  f.canvas.onpointerdown(pointer(0, 0));f.canvas.onpointermove(pointer(500, 500));f.canvas.onpointerup(pointer(0, 0));
  assert.equal(f.history.length, 1, 'Clamped no-op retains history');
});

test('blocked, disabled and replaced targets never apply stale gesture mutations', () => {
  const f = fixture('title');
  f.project.design.title.enabled = false;
  f.canvas.onpointerdown(pointer(0, 0));f.canvas.onpointermove(pointer(10, 10));f.canvas.onpointerup(pointer(0, 0));
  assert.equal(f.history.length, 0);
  f.project.design.title.enabled = true;
  f.canvas.onpointerdown(pointer(0, 0));f.canvas.onpointermove(pointer(10, 10));
  const replacement = createDemoProject(), before = structuredClone(replacement);
  f.replace(replacement);f.canvas.onpointermove(pointer(20, 20));f.canvas.onpointercancel(pointer(0, 0));
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

test('preview drag ignores other fingers and records one history entry for its owner', () => {
  const f = fixture();
  const other = (x, y) => ({ ...pointer(x, y), pointerId: 8 });
  f.canvas.onpointerdown(pointer(0, 0));
  f.canvas.onpointermove(pointer(10, 20));
  f.canvas.onpointerdown(other(90, 90));
  f.canvas.onpointermove(other(0, 0));
  f.canvas.onpointerup(other(0, 0));
  f.canvas.onpointercancel(other(0, 0));
  assert.equal(f.project.panX, .1, 'a second finger must not move the preview');
  assert.equal(f.events.filter(event => event === 'commit').length, 0, 'only the initiating finger can end the edit');
  f.canvas.onpointermove(pointer(20, 40));
  f.canvas.onpointerup(pointer(20, 40));
  assert.equal(f.project.panX, .2);
  assert.equal(f.project.panY, .2);
  assert.equal(f.history.length, 1);
  assert.equal(f.history[0].panX, 0);
  assert.equal(f.events.filter(event => event === 'commit').length, 1);
  assert.deepEqual(f.events.filter(Array.isArray), [['capture', 7]]);
});

test('lost pointer capture finishes once and permits a new preview drag', () => {
  const f = fixture();
  f.canvas.onpointerdown(pointer(0, 0));
  f.canvas.onpointermove(pointer(10, 20));
  f.canvas.onlostpointercapture(pointer(10, 20));
  f.canvas.onpointermove(pointer(90, 90));
  assert.equal(f.project.panX, .1, 'movement after capture loss must not keep editing');
  f.canvas.onpointerup(pointer(90, 90));
  assert.equal(f.events.filter(event => event === 'commit').length, 1);
  f.canvas.onpointerdown(pointer(0, 0));
  f.canvas.onpointermove(pointer(10, 20));
  f.canvas.onpointercancel(pointer(10, 20));
  f.canvas.onlostpointercapture(pointer(10, 20));
  assert.equal(f.project.panX, .2);
  assert.equal(f.history.length, 2);
  assert.equal(f.events.filter(event => event === 'commit').length, 2);
});

test('output stepping accepts only unmodified punctuation outside editable ancestors and busy states',()=>{
 let handler,blocked=false,busy=false;const calls=[];
 bindEditorKeyboard({addEventListener:(_,fn)=>handler=fn},{blocked:()=>blocked,stepBlocked:()=>busy,stepOutput:d=>calls.push(d)});
 const press=(key,extra={})=>{let prevented=false;handler({key,target:{tagName:'BODY'},preventDefault:()=>prevented=true,...extra});return prevented;};
 assert.equal(press(','),true);assert.equal(press('.'),true);assert.deepEqual(calls,[-1,1]);
 for(const extra of [{defaultPrevented:true},{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{isComposing:true},{keyCode:229},
  ...['INPUT','TEXTAREA','SELECT','SUMMARY'].map(tagName=>({target:{tagName}})),
  {target:{tagName:'SPAN',isContentEditable:true}},{target:{tagName:'SPAN',closest:()=>({tagName:'SUMMARY'})}}]){
  assert.equal(press(',',extra),false);assert.equal(press('.',extra),false);
 }
 blocked=true;assert.equal(press('.'),false);blocked=false;busy=true;assert.equal(press(','),false);assert.deepEqual(calls,[-1,1]);
});

test('handled keyboard events never trigger global editor shortcuts', () => {
  let handler;
  const calls = [];
  bindEditorKeyboard({ addEventListener: (_, callback) => { handler = callback; } }, {
    blocked: () => false,
    togglePlayback: () => calls.push('play'),
    undo: () => calls.push('undo'),
    seekBy: () => calls.push('seek'),
    stepOutput: () => calls.push('step'),
    navigateCut: () => calls.push('cut'),
  });
  for (const key of [' ', 'z', 'ArrowLeft', 'ArrowRight', ',', '.', '[', ']']) {
    handler({
      key,
      code: key === ' ' ? 'Space' : key,
      ctrlKey: key === 'z',
      defaultPrevented: true,
      target: { tagName: 'BODY' },
      preventDefault: () => calls.push('prevent'),
    });
  }
  assert.deepEqual(calls, []);
});

test('horizontal tab navigation never falls through to seeking, including nested labels', () => {
  let handler;
  const seeks = [];
  bindEditorKeyboard({ addEventListener: (_, callback) => { handler = callback; } }, {
    blocked: () => false,
    seekBy: delta => seeks.push(delta),
  });
  const tab = {
    tagName: 'BUTTON',
    getAttribute: name => name === 'role' ? 'tab' : null,
  };
  const nestedLabel = {
    tagName: 'SPAN',
    getAttribute: () => null,
    closest: selector => selector === '[role="tab"]' ? tab : null,
  };
  for (const target of [tab, nestedLabel]) {
    for (const key of ['ArrowLeft', 'ArrowRight']) {
      for (const extra of [{}, { isComposing: true }, { keyCode: 229 },
        { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
        handler({ key, target, ...extra });
      }
    }
  }
  assert.deepEqual(seeks, []);
  for (const target of [
    { tagName: 'BUTTON' },
    { tagName: 'SPAN', getAttribute: () => null, closest: () => null },
  ]) {
    handler({ key: 'ArrowLeft', target });
    handler({ key: 'ArrowRight', target });
  }
  assert.deepEqual(seeks, [-1, 1, -1, 1]);
});

test('composition and editable ancestors own all shortcut keys without cancellation', () => {
  let handler;
  const calls = [];
  bindEditorKeyboard({ addEventListener: (_, callback) => { handler = callback; } }, {
    blocked: () => false,
    togglePlayback: () => calls.push('play'),
    undo: () => calls.push('undo'),
    seekBy: () => calls.push('seek'),
    stepOutput: () => calls.push('step'),
    navigateCut: () => calls.push('cut'),
  });
  const guards = [
    { isComposing: true }, { keyCode: 229 },
    { target: { tagName: 'SPAN', isContentEditable: true } },
    { target: { tagName: 'SPAN', closest: selector => selector.startsWith('input,') ? {} : null } },
  ];
  for (const extra of guards) for (const key of [' ', 'z', 'ArrowLeft', 'ArrowRight', ',', '.', '[', ']']) {
    handler({ key, code: key === ' ' ? 'Space' : key, ctrlKey: key === 'z',
      target: { tagName: 'BODY' }, preventDefault: () => calls.push('prevent'), ...extra });
  }
  assert.deepEqual(calls, []);
});

test('plain transport ignores modifiers while Ctrl/Meta Undo and Shift redo retain their mapping', () => {
  let handler;
  const calls = [];
  bindEditorKeyboard({ addEventListener: (_, callback) => { handler = callback; } }, {
    blocked: () => false,
    togglePlayback: () => calls.push('play'),
    undo: redo => calls.push(['undo', !!redo]),
    seekBy: delta => calls.push(['seek', delta]),
  });
  const press = (key, extra = {}) => handler({ key, code: key === ' ' ? 'Space' : key,
    target: { tagName: 'BODY' }, preventDefault: () => calls.push('prevent'), ...extra });
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
    for (const key of [' ', 'ArrowLeft', 'ArrowRight']) press(key, { [modifier]: true });
  }
  assert.deepEqual(calls, []);
  for (const modifier of ['ctrlKey', 'metaKey']) {
    press('z', { [modifier]: true });
    press('Z', { [modifier]: true, shiftKey: true });
  }
  assert.deepEqual(calls, ['prevent', ['undo', false], 'prevent', ['undo', true],
    'prevent', ['undo', false], 'prevent', ['undo', true]]);
  calls.length = 0;
  press(' '); press('ArrowLeft'); press('ArrowRight');
  assert.deepEqual(calls, ['prevent', 'play', ['seek', -1], ['seek', 1]]);
});

function coordinates(f,mode){
 const target=mode==='video'||mode==='caption'?f.project:mode==='scene'?f.project.overlays[0]:f.project.design[mode];
 return {target,xKey:mode==='video'?'panX':mode==='caption'?'captionX':'x',yKey:mode==='video'?'panY':mode==='caption'?'captionY':'y'};
}
const shifted=(x,y,extra={})=>({...pointer(x,y),shiftKey:true,...extra});

for(const mode of ['video','title','credit','caption','scene'])test(`${mode}: Shift drag preserves the exact opposite coordinate, including values outside drag bounds`,()=>{
 for(const locked of [-0,Number.MIN_VALUE,0,1])for(const axis of ['x','y']){
  const f=fixture(mode),{target,xKey,yKey}=coordinates(f,mode),lockedKey=axis==='x'?yKey:xKey;
  target[xKey]=target[yKey]=.5;target[lockedKey]=locked;
  f.canvas.onpointerdown(shifted(0,0));f.canvas.onpointermove(shifted(0,0));
  assert.equal(f.history.length,0);assert.ok(Object.is(target[lockedKey],locked));
  f.canvas.onpointermove(shifted(axis==='x'?20:2,axis==='x'?2:20));
  assert.ok(Object.is(target[lockedKey],locked));assert.equal(target[axis==='x'?xKey:yKey],axis==='x'?.7:.6);
  f.canvas.onpointermove({...pointer(axis==='x'?30:90,axis==='x'?90:30),shiftKey:false});
  assert.ok(Object.is(target[lockedKey],locked),'lock survives release and later opposite-direction movement');
  assert.equal(f.history.length,1);f.canvas.onpointerup(pointer(0,0));
  assert.equal(f.events.filter(event=>event==='commit').length,1);
 }
});

test('Shift lock chooses raw client direction once, ties horizontally, and resets with the next gesture',()=>{
 const f=fixture();f.canvas.onpointerdown(shifted(0,0));f.canvas.onpointermove(shifted(8,10));
 assert.equal(f.project.panX,0,'non-square canvas must not choose normalized horizontal dominance');
 assert.equal(f.project.panY,.05);f.canvas.onpointermove(pointer(80,20));
 assert.equal(f.project.panX,0);assert.equal(f.project.panY,.1);f.canvas.onpointerup(pointer(0,0));
 f.canvas.onpointerdown(shifted(0,0));f.canvas.onpointermove(shifted(10,10));
 assert.equal(f.project.panX,.1);assert.equal(f.project.panY,.1,'equal client deltas choose horizontal');
 f.canvas.onpointercancel(pointer(0,0));assert.equal(f.history.length,2);
 f.canvas.onpointerdown(pointer(0,0));f.canvas.onpointermove(pointer(10,20));f.canvas.onpointerup(pointer(0,0));
 assert.equal(f.project.panX,.2);assert.equal(f.project.panY,.2,'ordinary next drag is free on both axes');
});

test('only Shift held at gesture start enables the lock; ordinary touch and later modifiers keep free drag',()=>{
 for(const extra of [{},{ctrlKey:true,shiftKey:true},{metaKey:true,shiftKey:true},{altKey:true,shiftKey:true},{pointerType:'touch'}]){
  const f=fixture();f.canvas.onpointerdown({...pointer(0,0),...extra});
  f.canvas.onpointermove(shifted(10,20));f.canvas.onpointerup(pointer(0,0));
  assert.equal(f.project.panX,.1);assert.equal(f.project.panY,.1);assert.equal(f.history.length,1);
 }
});

test('axis gestures retain pointer ownership, no-motion behavior and exactly one cancellation/capture-loss commit',()=>{
 const f=fixture('title'),{target,xKey,yKey}=coordinates(f,'title');target[xKey]=0;target[yKey]=0;
 f.canvas.onpointerdown(shifted(0,0));f.canvas.onpointermove(shifted(0,0));
 f.canvas.onpointercancel(pointer(0,0));f.canvas.onlostpointercapture(pointer(0,0));assert.equal(f.history.length,0);
 f.canvas.onpointerdown(shifted(0,0));f.canvas.onpointermove({...shifted(1,100),pointerId:8});
 f.canvas.onpointerup({...pointer(1,100),pointerId:8});f.canvas.onpointermove(shifted(20,1));
 assert.equal(target[xKey],.2);assert.equal(target[yKey],0);assert.equal(f.history.length,1);
 f.canvas.onlostpointercapture(pointer(0,0));f.canvas.onpointercancel(pointer(0,0));f.canvas.onpointerup(pointer(0,0));
 assert.equal(f.events.filter(event=>event==='commit').length,1,'capture loss commits the existing partial edit, not rollback');
 const before=structuredClone(f.project);f.canvas.onpointermove(shifted(90,90));assert.deepEqual(f.project,before);
});
