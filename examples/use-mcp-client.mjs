// Dependency-free interactive stdio example. Only synthetic project metadata is used.
// No project files, browser, media provider, network or persistent service is involved.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createDemoProject, createProjectDocument } from '../dist/core/project.mjs';

async function withClient(work) {
  const server = fileURLToPath(new URL('../cli/mcp.mjs', import.meta.url));
  const child = spawn(process.execPath, [server], {stdio: ['pipe', 'pipe', 'pipe']});
  const exited = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  exited.catch(() => {}); // Observe spawn errors even before the first response wait.
  let stderr = '', nextId = 0;
  child.stderr.setEncoding('utf8').on('data', text => { stderr += text; });
  const lines = createInterface({input: child.stdout, crlfDelay: Infinity});
  const responses = lines[Symbol.asyncIterator]();
  const send = message => new Promise((resolve, reject) => {
    child.stdin.write(JSON.stringify(message) + '\n', error => error ? reject(error) : resolve());
  });
  async function request(method, params) {
    const id = ++nextId;
    let timeout;
    try {
      const response = await Promise.race([
        (async () => {
          await send({jsonrpc: '2.0', id, method, params});
          const line = await responses.next();
          if (line.done) throw new Error(`Server exited before replying: ${stderr}`);
          return JSON.parse(line.value);
        })(),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('MCP response timed out')), 10000); }),
      ]);
      assert.equal(response.id, id);
      if (response.error) throw new Error(`${response.error.code}: ${response.error.message}`);
      return response.result;
    } finally { clearTimeout(timeout); }
  }
  try {
    const hello = await request('initialize', {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'moment-example', version: '1'},
    });
    assert.equal(hello.protocolVersion, '2025-11-25');
    await send({jsonrpc: '2.0', method: 'notifications/initialized'});
    const call = (name, args = {}) => request('tools/call', {name, arguments: {projectId: 'session', ...args}});
    const data = async (name, args) => {
      const result = await call(name, args);
      assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
      assert.equal(result.structuredContent.ok, true);
      assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
      return result.structuredContent.data;
    };
    const result = await work({request, call, data});
    child.stdin.end();
    let shutdownTimer;
    try {
      const code = await Promise.race([exited, new Promise((_, reject) => {
        shutdownTimer = setTimeout(() => reject(new Error('MCP shutdown timed out')), 3000);
      })]);
      assert.equal(code, 0, stderr);
    } finally { clearTimeout(shutdownTimer); }
    assert.equal(stderr, '');
    return result;
  } finally {
    lines.close();
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

const saved = await withClient(async ({request, call, data}) => {
  const {tools} = await request('tools/list', {});
  assert.equal(tools.length, 41);
  assert.ok(tools.some(tool => tool.name === 'moment_project_import'));
  await data('moment_project_import', {document: createProjectDocument(createDemoProject())});
  await data('moment_project_update', {patch: {name: 'MCP 예제', speed: 2}});
  const before = await data('moment_project_get');
  const summary = await data('moment_project_summary');
  assert.equal(summary.speed, 2);
  assert.equal(summary.clipCount, before.project.clips.length);
  assert.equal(summary.ratio, before.project.ratio);
  assert.deepEqual(summary.media, {requiresVideo:false, requiresAudio:false});
  assert.equal(Object.hasOwn(summary, 'name'), false);
  const rejected = await call('moment_project_update', {patch: {speed: 0}});
  assert.equal(rejected.isError, true);
  assert.equal(rejected.structuredContent.error.code, 'INVALID_ARGUMENT');
  assert.deepEqual(await data('moment_project_get'), before, 'failed input must not change the project');
  const exportedTemplate = await data('moment_template_export', {id:'mcp-reusable-style',name:'Reusable style'});
  assert.equal(exportedTemplate.format, 'moment-template');
  assert.equal(exportedTemplate.template.id, 'mcp-reusable-style');
  assert.deepEqual(await data('moment_project_get'), before, 'template capture is read-only');
  const beforeInspection = await data('moment_project_get');
  const inspection = await data('moment_captions_inspect', {maxGraphemesPerSecond:1,limit:2});
  assert.equal(inspection.metric, 'non-whitespace-graphemes-per-second');
  assert.ok(inspection.flaggedOccurrences > 0);
  assert.ok(inspection.issues.length <= 2);
  const inspectedCue = await data('moment_captions_list', {offset:inspection.issues[0].captionIndex,limit:1});
  assert.equal(inspectedCue.captions[0].captionIndex,inspection.issues[0].captionIndex);
  assert.equal(inspectedCue.captions[0].caption.text,beforeInspection.project.captions[inspection.issues[0].captionIndex].text);
  assert.deepEqual(await data('moment_project_get'), beforeInspection);
  await data('moment_timeline_replace', {clips: [{start: 2, end: 6}]});
  const imported = await data('moment_captions_import', {text: '1\n00:00:02,000 --> 00:00:04,000\n안녕하세요', basis: 'source'});
  assert.deepEqual(imported, {updated: true, importedCaptions: 1, outputDuration: 2});
  // Opt-in diagnostics are post-commit; default acknowledgment above stays exact.
  const reported = await data('moment_captions_import', {text: '1\n00:00:02,000 --> 00:00:04,000\n안녕하세요\n\n2\n00:00:15,000 --> 00:00:20,000\noutside', basis: 'source', report: true});
  assert.deepEqual(reported, {...imported, report: {acceptedCaptions: 1, clippedCaptions: 0, discardedRecognizedEntries: 1}});

  const srt = await data('moment_captions_export');
  assert.match(srt.text, /00:00:00,000 --> 00:00:01,000/);
  assert.match(srt.text, /안녕하세요/);
  const vtt = await data('moment_captions_export', {format: 'vtt'});
  assert.equal(vtt.format, 'vtt');
  assert.equal(vtt.text, 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\n안녕하세요\n');
  const invalidFormat = await call('moment_captions_export', {format: 'ass'});
  assert.equal(invalidFormat.isError, true);
  assert.equal(invalidFormat.structuredContent.error.code, 'INVALID_ARGUMENT');
  assert.deepEqual(await data('moment_captions_export'), srt);
  const assigned = await data('moment_captions_speaker_assign', {captionIndex: 0, count: 1, speaker: '0'});
  assert.equal(assigned.changedCaptions, 1);
  assert.equal((await data('moment_captions_speaker_assign', {captionIndex: 0, count: 1, speaker: '0'})).updated, false);
  const review = await data('moment_captions_export', {format: 'txt', review: true});
  assert.equal(review.format, 'txt');
  assert.ok(review.text.includes('안녕하세요'));
  const shifted = await data('moment_captions_timing_shift', {basis: 'source', delta: .1});
  assert.equal(shifted.updated, true);
  await data('moment_captions_timing_shift', {basis: 'source', delta: -.1});
  const transcript = await data('moment_captions_export', {format: 'txt'});
  assert.equal(transcript.format, 'txt');
  assert.equal(transcript.text, '안녕하세요\n');
  const corrected = await data('moment_captions_text_replace', {find: '안녕하세요', replacement: '안녕 세상'});
  assert.deepEqual(corrected, {updated: true, matches: 1, changedCaptions: 1});
  const noChange = await data('moment_captions_text_replace', {find: '없는 말', replacement: '교정'});
  assert.deepEqual(noChange, {updated: false, matches: 0, changedCaptions: 0});
  assert.match((await data('moment_captions_export')).text, /안녕 세상/);
  const styled = await data('moment_captions_style_update', {patch: {captionSize: 44, captionY: .8}});
  assert.equal(styled.updated, true);
  assert.equal((await data('moment_project_get')).project.captionSize, 44);
  const split = await data('moment_timeline_split', {clipIndex: 0, sourceTime: 4});
  assert.equal(split.outputDuration, 2);
  assert.deepEqual((await data('moment_project_get')).project.clips, [{start: 2, end: 4}, {start: 4, end: 6}]);
  await data('moment_overlays_add', {id:'shared-card',patch:{text:'공유 카드',start:0,end:1}});
  const portable = await data('moment_template_export', {id:'shared-style',name:'공유 스타일'});
  portable.template.settings.captionSize = 40;
  await data('moment_template_apply_document', {document: portable, withContent: true});
  assert.equal((await data('moment_project_get')).project.captionSize, 40);
  await data('moment_effects_update', {patch: {brightness: 1.1, saturation: .8, motion: 'none', transition: 'none'}});
  assert.equal((await data('moment_project_get')).project.effects.brightness, 1.1);
  const card = (await data('moment_project_get')).project.overlays[0];
  await data('moment_overlays_update', {id: card.id, patch: {text: 'MCP 장면 문구', start: 0, end: 1}});
  assert.equal((await data('moment_project_get')).project.overlays[0].text, 'MCP 장면 문구');
  await data('moment_overlays_remove', {id: card.id});
  const cards = [['hook', '시선을 끄는 시작', 0, .5], ['tip', '핵심 팁', .5, 1.5], ['cta', '다음 편도 함께해요', 1.5, 2]];
  for (const [id, text, start, end] of cards) {
    assert.deepEqual(await data('moment_overlays_add', {id, patch: {text, start, end}}), {updated: true, outputDuration: 2, id});
  }
  assert.deepEqual((await data('moment_project_get')).project.overlays.map(item => item.id), ['hook', 'tip', 'cta']);
  const reordered = await data('moment_overlays_move', {id: 'hook', toIndex: 2});
  assert.equal(reordered.updated, true);
  assert.deepEqual((await data('moment_project_get')).project.overlays.map(item => item.id), ['tip', 'cta', 'hook']);
  await data('moment_credit_update', {patch: {text: '출처: 내 채널', start: 1, end: null}});
  assert.equal((await data('moment_project_get')).project.design.credit.text, '출처: 내 채널');
  const plan = await data('moment_render_plan', {quality: 720, format: 'webm'});
  assert.equal(plan.rendered, false);
  assert.equal(plan.output.duration, 2);
  const duplicate = await data('moment_timeline_duplicate', {clipIndex: 0});
  assert.equal(duplicate.outputDuration, 3);
  assert.deepEqual((await data('moment_project_get')).project.clips, [{start: 2, end: 4}, {start: 2, end: 4}, {start: 4, end: 6}]);
  const beforeOverlapCheck = await data('moment_project_get');
  const overlaps = await data('moment_captions_overlaps', {limit:20});
  assert.equal(overlaps.metric, 'output-time-overlap');
  assert.ok(overlaps.issues.length <= 20);
  assert.deepEqual(await data('moment_project_get'), beforeOverlapCheck);
  const beforeMove = (await data('moment_project_get')).project;
  assert.equal((await data('moment_timeline_move', {clipIndex: 2, toIndex: 0})).updated, true);
  const afterMove = (await data('moment_project_get')).project;
  assert.deepEqual(afterMove.clips, [beforeMove.clips[2], beforeMove.clips[0], beforeMove.clips[1]]);
  assert.deepEqual(afterMove.overlays, beforeMove.overlays);
  assert.equal((await data('moment_timeline_move', {clipIndex: 0, toIndex: 0})).updated, false);
  await data('moment_captions_replace', {captions: [{start:0,end:1,text:'Hello'}, {start:1,end:2,text:'world'}]});
  const merged = await data('moment_captions_merge', {captionIndex:0});
  assert.equal(merged.mergedCaptionIndex, 0);
  assert.equal((await data('moment_project_get')).project.captions[0].text, 'Hello world');
  const splitCaption = await data('moment_captions_split', {captionIndex:0,textOffset:5});
  assert.equal(splitCaption.createdCaptionIndex, 1);
  assert.deepEqual((await data('moment_project_get')).project.captions.map(cue=>cue.text), ['Hello',' world']);
  const beforeBatch = await data('moment_project_get');
  const rejectedBatch = await call('moment_project_batch', {operations:[
    {command:'project.update',arguments:{patch:{name:'Must not survive'}}},
    {command:'overlays.remove',arguments:{id:'missing-card'}},
  ]});
  assert.equal(rejectedBatch.isError, true);
  assert.equal(rejectedBatch.structuredContent.error.code, 'NOT_FOUND');
  assert.match(rejectedBatch.structuredContent.error.path, /^arguments\.operations\[1\]/);
  assert.deepEqual(await data('moment_project_get'), beforeBatch);
  const batch = await data('moment_project_batch', {operations:[
    {command:'project.update',arguments:{patch:{name:'Atomic edit'}}},
    {command:'credit.update',arguments:{patch:{text:'Reviewed together'}}},
  ]});
  assert.equal(batch.operationCount, 2);
  assert.equal((await data('moment_project_get')).project.name, 'Atomic edit');
  await data('moment_captions_style_update', {patch:{speakerLabels:['Host','Guest'],speakerColors:['#ffffff','#b5ff00']}});
  assert.deepEqual((await data('moment_project_get')).project.speakerLabels,['Host','Guest']);
  const templateDetail = await data('moment_template_inspect', {templateId:'hook-result',withContent:true});
  assert.equal(templateDetail.template.id,'hook-result');
  assert.ok(templateDetail.cards.length <= 12);
  const beforePreview = await data('moment_project_get');
  const preflight = await data('moment_project_preview', {operations:[{command:'project.update',arguments:{patch:{speed:2}}}]});
  assert.equal(preflight.operationCount,1);
  assert.equal(preflight.wouldCommit,true);
  assert.deepEqual(await data('moment_project_get'),beforePreview);
  const clipPage = await data('moment_timeline_list', {offset:0,limit:2});
  assert.ok(clipPage.clips.length <= 2);
  assert.equal(clipPage.clips[0].outputStart, clipPage.clips[0].timelineStart / clipPage.speed);
  // Fetch only the authored cue and its neighbor, not the complete project.
  const nearby = await data('moment_captions_list', {offset:0,limit:2});
  assert.equal(nearby.captions[0].captionIndex,0);
  assert.equal(nearby.captions[0].caption.text,'Hello');
  const cueUpdate = await data('moment_captions_update', {captionIndex:0,patch:{text:'Hello again'}});
  assert.equal(cueUpdate.captionIndex, 0);
  assert.equal((await data('moment_project_get')).project.captions[0].text, 'Hello again');
  const beforeInsert = await data('moment_captions_list');
  const inserted = await data('moment_captions_insert', {captionIndex:1,caption:{start:1,end:2,text:'Additional cue',basis:'timeline'}});
  assert.equal(inserted.totalCaptions,beforeInsert.totalCaptions+1);
  assert.equal((await data('moment_captions_list',{offset:1,limit:1})).captions[0].caption.text,'Additional cue');
  const removed = await data('moment_captions_remove',{captionIndex:1});
  assert.equal(removed.totalCaptions,beforeInsert.totalCaptions);
  assert.deepEqual(await data('moment_captions_list'),beforeInsert);
  // Save this document through the client's authorized file workflow in a real integration.
  return JSON.parse(JSON.stringify(await data('moment_project_get')));
});
await withClient(async ({data}) => {
  assert.notEqual((await data('moment_project_get')).project.name, saved.project.name);
  await data('moment_project_import', {document: saved});
  assert.deepEqual(await data('moment_project_get'), saved);
});
console.log(JSON.stringify({ok: true, tools: 41, recoveredFromInvalidInput: true, reimported: true, rendered: false}));
