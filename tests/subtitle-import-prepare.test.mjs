import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextFileWorkflow } from '../dist/text-file-workflow.mjs';
import { createDemoProject, createProjectDocument } from '../dist/core/project.mjs';
import { createEditorService } from '../dist/integration/editor-service.mjs';
import { CommandError } from '../dist/core/validation.mjs';

const file = (text = '00:00:01,000 --> 00:00:03,000\nNew') => new Blob([text]);
function fixture() {
  const f = { project: createDemoProject(), writes: 0, calls: 0, messages: [], focused: 0, blocked: false, current: true };
  const controls = { '#srtInput': {value:'selected'}, '#projectInput': {value:'selected'} };
  const service = createEditorService({
    getProject: () => f.project,
    commitProject: next => {
      if (f.blocked) throw new CommandError('BUSY', 'busy');
      f.project = next;
      f.writes++;
    },
  });
  f.workflow = createTextFileWorkflow({
    getProject: () => f.project,
    execute: (...args) => { f.calls++; return service.execute(...args); },
    query: id => controls[id], closeModal: () => {},
    focusImportedCaption: () => { f.focused++; }, settingsUnavailable: () => false,
    download: () => assert.fail('no download'), toast: value => f.messages.push(value),
  });
  f.options = { owned:true, prepareOnly:true, isCurrent:() => f.current };
  f.controls = controls;
  return f;
}

test('review reads once and exposes only counts; one later commit uses captured output clock', async () => {
  const f = fixture();
  f.project.speed = 2;
  const before = structuredClone(f.project);
  let reads = 0;
  const source = file('00:00:01,000 --> 00:00:10,000\nNew');
  const prepared = await f.workflow.importSrt({size:source.size,arrayBuffer:() => { reads++; return source.arrayBuffer(); }}, {...f.options,clock:'output'});
  assert.deepEqual(Object.keys(prepared).sort(), ['commit','ok','prepared','report']);
  assert.deepEqual(prepared.report, {acceptedCaptions:1,clippedCaptions:1,discardedRecognizedEntries:0});
  assert.deepEqual(f.project, before);
  assert.equal(f.calls, 0);
  assert.equal(f.writes, 0);
  prepared.report.acceptedCaptions = 999;
  assert.equal((await prepared.commit()).ok, true);
  assert.deepEqual(f.project.captions, [{start:2,end:12,text:'New',basis:'timeline'}]);
  assert.equal(reads, 1);
  assert.equal(f.writes, 1);
  assert.equal(f.focused, 0);
  assert.deepEqual(f.messages, []);
  assert.deepEqual(await prepared.commit(), {ok:false,stale:true});
  assert.equal(f.writes, 1);
});

test('duplicate commits never queue twice; busy failure can retry the same preparation', async () => {
  const f = fixture();
  const prepared = await f.workflow.importSrt(file(), f.options);
  f.blocked = true;
  const first = prepared.commit();
  assert.equal((await prepared.commit()).error.code, 'BUSY');
  assert.equal((await first).ok, false);
  assert.equal(f.calls, 1);
  assert.equal(f.writes, 0);
  f.blocked = false;
  assert.equal((await prepared.commit()).ok, true);
  assert.equal(f.calls, 2);
  assert.equal(f.writes, 1);
});

test('cancellation, project replacement and same-object edits invalidate prepared captions', async () => {
  for (const change of [f => { f.current = false; }, f => { f.project = structuredClone(f.project); }, f => { f.project.speed = 2; }]) {
    const f = fixture();
    const prepared = await f.workflow.importSrt(file(), f.options);
    change(f);
    assert.equal((await prepared.commit()).ok, false);
    assert.equal(f.writes, 0);
    assert.equal(f.calls, 0);
    assert.deepEqual(f.messages, []);
  }
});

test('new subtitle and settings reads invalidate the preparation even if the newer read fails', async () => {
  for (const kind of ['subtitle','settings']) {
    const f = fixture();
    const prepared = await f.workflow.importSrt(file(), f.options);
    if (kind === 'subtitle') await f.workflow.importSrt(file('invalid'), f.options);
    else await f.workflow.importProjectSettings(new Blob(['invalid JSON']));
    assert.deepEqual(await prepared.commit(), {ok:false,stale:true});
    assert.equal(f.writes, 0);
  }
  const f = fixture();
  const prepared = await f.workflow.importSrt(file(), f.options);
  await f.workflow.importProjectSettings(new Blob([JSON.stringify(createProjectDocument(f.project))]));
  assert.deepEqual(await prepared.commit(), {ok:false,stale:true});
  assert.equal(f.writes, 1);
});

test('queued execution repeats the caller guard and does not commit a cancelled request', async () => {
  const f = fixture();
  let checks = 0;
  const prepared = await f.workflow.importSrt(file(), {...f.options,beforeCommit:() => {
    checks++;
    if (checks >= 4) throw new CommandError('CONFLICT','closed while queued');
  }});
  const result = await prepared.commit();
  assert.equal(result.ok, false);
  assert.equal(f.calls, 1);
  assert.equal(f.writes, 0);
  assert.equal(checks, 4);
});

test('legacy immediate import keeps focus, toast and hidden-input reset behavior', async () => {
  const f = fixture();
  const result = await f.workflow.importSrt(file());
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result, 'report'), false);
  assert.equal(f.writes, 1);
  assert.equal(f.focused, 1);
  assert.equal(f.messages.length, 1);
  assert.equal(f.controls['#srtInput'].value, '');
});
