import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createAppFixture} from './fixtures/app.mjs';
import {initLocale, setLocale, t} from '../dist/i18n.mjs';
import {fmt} from '../dist/ui-format.mjs';

// Real app presentation and native-input handlers, not browser/AT speech simulation.
const value = (current, total) => t('shell.playheadValue', {current:fmt(current), total:fmt(total)});
const resetLocale = () => initLocale({languages:['ko'], document:null, storage:null});

test('initial native seek range has a localized output-time description without redundant slider roles', () => {
  const html = fs.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const input = html.match(/<input id="seek"[^>]*>/)[0];
  assert.match(input, /type="range" min="0" max="12" step="0\.01" value="0"/);
  assert.match(input, /aria-valuetext="출력 시간 00:00 \/ 00:12"/);
  assert.match(input, /data-i18n-aria-valuetext="shell\.playheadValue"/);
  assert.match(input, /data-i18n-aria-valuetext-params='\{"current":"00:00","total":"00:12"\}'/);
  assert.doesNotMatch(input, /\s(?:role|aria-live|aria-valuenow|aria-valuemin|aria-valuemax)=/);
});

test('seek descriptions use output seconds at slow, normal, fast and imported custom speeds', async () => {
  for (const speed of [.25,1,2,4,1.23456789]) {
    const f = await createAppFixture();
    try {
      initLocale({languages:['en'],document:f.doc,storage:null});
      f.evaluate(`state.speed=${speed};seekTo(6);true`);
      const seek = f.element('#seek');
      assert.equal(Number(seek.value), 6); assert.equal(Number(seek.max), 12);
      assert.equal(seek.getAttribute('aria-valuetext'), value(6/speed,12/speed));
      assert.deepEqual(JSON.parse(seek.getAttribute('data-i18n-aria-valuetext-params')),
        {current:fmt(6/speed),total:fmt(12/speed)});
      assert.match(f.element('#timeDisplay').innerHTML, new RegExp(fmt(6/speed)));
      assert.equal(seek.getAttribute('aria-live'), null);
      assert.equal(f.evaluate('history.length'), 0);
    } finally { resetLocale(); }
  }
});

test('start, whole-second boundaries and endpoint update descriptions without changing precise current time', async () => {
  const f = await createAppFixture();
  try {
    initLocale({languages:['en'],document:f.doc,storage:null});
    f.evaluate('state.speed=2;true');
    const before = f.evaluate('({state,history,future})');
    for (const time of [0,.01,1.99,2,2.01,11.99,12]) {
      f.evaluate(`seekTo(${time});true`);
      assert.equal(f.evaluate('current'), time);
      assert.equal(Number(f.element('#seek').value), time);
      assert.equal(f.element('#seek').getAttribute('aria-valuetext'), value(time/2,6));
      assert.deepEqual(f.evaluate('({state,history,future})'), before);
    }
  } finally { resetLocale(); }
});

test('native range input remains in the pre-speed clock and preserves its node and focus', async () => {
  const f = await createAppFixture();
  try {
    initLocale({languages:['en'],document:f.doc,storage:null});
    f.evaluate('state.speed=4;true');
    const seek = f.element('#seek'), handler = seek.oninput, before = f.evaluate('({state,history,future})');
    seek.focus(); seek.value='6.25'; handler({target:seek});
    assert.equal(f.evaluate('current'),6.25);
    assert.equal(Number(seek.value),6.25);
    assert.equal(seek.getAttribute('aria-valuetext'),value(6.25/4,3));
    assert.equal(f.doc.activeElement,seek); assert.equal(f.element('#seek'),seek); assert.equal(seek.oninput,handler);
    assert.deepEqual(f.evaluate('({state,history,future})'),before);
  } finally { resetLocale(); }
});

test('paused locale changes translate the current description without replacing the slider or consuming drafts', async () => {
  const f = await createAppFixture();
  try {
    initLocale({languages:['ko'],document:f.doc,storage:null});
    f.evaluate('state.speed=2;seekTo(6);true');
    const seek=f.element('#seek'), name=f.element('#projectName'), handler=seek.oninput;
    name.value='unsubmitted title draft';seek.focus();
    const before=f.evaluate('({state,history,future,current})'), focusCount=f.focusEvents.length;
    for (const locale of ['en','zh-CN','ko']) {
      setLocale(locale);
      assert.equal(seek.getAttribute('aria-valuetext'),value(3,6));
      assert.equal(f.element('#seek'),seek);assert.equal(seek.oninput,handler);
      assert.equal(f.doc.activeElement,seek);assert.equal(f.focusEvents.length,focusCount);
      assert.equal(name.value,'unsubmitted title draft');
      assert.deepEqual(f.evaluate('({state,history,future,current})'),before);
    }
  } finally { resetLocale(); }
});

test('same displayed second does not rewrite value text and total/speed changes refresh it', async () => {
  const f=await createAppFixture();
  try {
    initLocale({languages:['en'],document:f.doc,storage:null});
    f.evaluate('seekTo(1.01);true');
    const seek=f.element('#seek'), writes=[], setAttribute=seek.setAttribute;
    seek.setAttribute=function(name,value){ if(name==='aria-valuetext')writes.push(value);return setAttribute.call(this,name,value); };
    for (const time of [1.02,1.2,1.99]) f.evaluate(`seekTo(${time});true`);
    assert.deepEqual(writes,[]);
    f.evaluate('seekTo(2);true');assert.deepEqual(writes,[value(2,12)]);
    f.evaluate('runEditorCommand("project.update",{patch:{speed:2}});true');
    assert.equal(seek.getAttribute('aria-valuetext'),value(1,6));
    f.evaluate('runEditorCommand("timeline.replace",{clips:[{start:0,end:8}]});true');
    assert.equal(Number(seek.max),8);assert.equal(seek.getAttribute('aria-valuetext'),value(1,4));
  } finally { resetLocale(); }
});
