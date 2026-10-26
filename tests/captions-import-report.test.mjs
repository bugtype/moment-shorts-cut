import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDemoProject, createProjectDocument} from '../dist/core/project.mjs';
import {prepareCommand, commandDefinition} from '../dist/core/commands.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createMcpToolAdapter} from '../dist/integration/mcp-adapter.mjs';

const cue = (start, end, text) => `00:00:${start},000 --> 00:00:${end},000\n${text}`;
const input = [cue('00', '20', ' kept '), cue('15', '20', 'outside'),
  cue('04', '03', 'reversed'), cue('00', '01', '<b></b>'),
  'malformed --> timing\nnot counted'].join('\n\n');
const expectedReport = {acceptedCaptions: 1, clippedCaptions: 1, discardedRecognizedEntries: 3};

test('opt-in report counts only recognized input entries using the explicit pre-speed clock', () => {
  for (const basis of ['source', 'timeline']) for (const mode of ['replace', 'append']) {
    const project = createDemoProject(); project.clips = [{start: 2, end: 6}]; project.speed = 2;
    const before = structuredClone(project);
    const result = prepareCommand(project, 'captions.import', {text: input, basis, mode, report: true});
    assert.deepEqual(result.data.report, expectedReport);
    assert.equal(result.data.importedCaptions, result.data.report.acceptedCaptions);
    assert.equal(result.project.captions.at(-1).end, basis === 'source' ? 12 : 4);
    assert.equal(result.project.captions.at(-1).text, ' kept ');
    assert.equal(result.project.captions.length, mode === 'append' ? before.captions.length + 1 : 1);
    if (mode === 'append') assert.deepEqual(result.project.captions.slice(0, -1), before.captions);
    assert.deepEqual(project, before);
  }
});

test('omitted and false reports preserve the exact legacy acknowledgment and project result', () => {
  const project = createDemoProject();
  const args = {text: input, basis: 'source'};
  const legacy = prepareCommand(project, 'captions.import', args);
  const disabled = prepareCommand(project, 'captions.import', {...args, report: false});
  const enabled = prepareCommand(project, 'captions.import', {...args, report: true});
  assert.deepEqual(legacy.data, {updated: true, outputDuration: 12, importedCaptions: 1});
  assert.deepEqual(disabled, legacy);
  assert.deepEqual(enabled.project, legacy.project);
  assert.deepEqual(Object.keys(enabled.data).sort(), ['importedCaptions', 'outputDuration', 'report', 'updated']);
});

test('clean input reports zeros; returned diagnostics are detached on subsequent execution', () => {
  const project = createDemoProject(), args = {text: cue('00', '12', 'clean'), basis: 'source', report: true};
  const first = prepareCommand(project, 'captions.import', args);
  assert.deepEqual(first.data.report, {acceptedCaptions: 1, clippedCaptions: 0, discardedRecognizedEntries: 0});
  first.data.report.clippedCaptions = 999;
  assert.equal(prepareCommand(project, 'captions.import', args).data.report.clippedCaptions, 0);
});

test('invalid report values, no accepted cues and capacity failures remain atomic without success diagnostics', async () => {
  let project = createDemoProject(), commits = 0, failCommit = false;
  const service = createEditorService({getProject: () => project, commitProject: next => {
    if (failCommit) throw new Error('Synthetic storage failure');
    project = next; commits++;
  }});
  const original = structuredClone(project);
  for (const args of [
    ...[null, 0, 'true', {}, []].map(report => ({text: input, basis: 'source', report})),
    {text: cue('15', '20', 'outside'), basis: 'source', report: true},
    {text: cue('00', '01', 'x'.repeat(2001)), basis: 'source', report: true},
  ]) {
    const result = await service.execute('captions.import', args);
    assert.equal(result.ok, false); assert.equal(result.error.code, 'INVALID_ARGUMENT');
    assert.equal(Object.hasOwn(result, 'data'), false); assert.deepEqual(project, original);
  }
  assert.equal(commits, 0);
  project.captions = Array.from({length: 10000}, () => ({start: 0, end: 1, text: 'retained'}));
  const full = structuredClone(project);
  const overflow = await service.execute('captions.import', {text: input, basis: 'source', mode: 'append', report: true});
  assert.equal(overflow.ok, false); assert.deepEqual(project, full); assert.equal(commits, 0);
  const recovery = await service.execute('captions.import', {text: input, basis: 'source', report: true});
  assert.equal(recovery.ok, true); assert.deepEqual(recovery.data.report, expectedReport); assert.equal(commits, 1);
  failCommit = true;
  const beforeFailure = structuredClone(project);
  const failed = await service.execute('captions.import', {text: input, basis: 'source', report: true});
  assert.equal(failed.ok, false); assert.equal(Object.hasOwn(failed, 'data'), false);
  assert.deepEqual(project, beforeFailure); assert.equal(commits, 1);
});

test('catalog and MCP discovery expose opt-in input and optional closed diagnostic output', async () => {
  let project = createDemoProject();
  const service = createEditorService({getProject: () => project, commitProject: next => {project = next;}});
  const adapter = createMcpToolAdapter({resolveService: () => service});
  assert.deepEqual(commandDefinition('captions.import').inputSchema.properties.report, {type: 'boolean'});
  const tool = adapter.listTools().tools.find(t => t.name === 'moment_captions_import');
  assert.equal(tool.inputSchema.properties.report.type, 'boolean');
  assert.match(tool.inputSchema.properties.report.description, /post-commit/i);
  const data = tool.outputSchema.oneOf[0].properties.data;
  assert.equal(data.required.includes('report'), false);
  assert.equal(data.properties.report.additionalProperties, false);
  assert.deepEqual(data.properties.report.required.sort(), Object.keys(expectedReport).sort());
  const result = await adapter.callTool(tool.name, {projectId: 'session', text: input, basis: 'source', report: true});
  assert.equal(result.isError, false); assert.deepEqual(result.structuredContent.data.report, expectedReport);
  assert.equal(project.captions.length, 1, 'MCP diagnostics accompany the already committed operation');
});

test('batch and preview accept the optional flag but keep their existing aggregate output contracts', () => {
  const project = createDemoProject();
  const args = {operations: [{command: 'captions.import', arguments: {text: input, basis: 'source'}}]};
  const reported = structuredClone(args); reported.operations[0].arguments.report = true;
  for (const command of ['project.batch', 'project.preview'])
    assert.deepEqual(prepareCommand(project, command, reported), prepareCommand(project, command, args));
});

test('CLI dry-run exposes opt-in diagnostics without creating or overwriting files; saved output remains a document', async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'moment-import-report-'));
  try {
    const project = path.join(dir, 'project.json'), args = path.join(dir, 'args.json'), out = path.join(dir, 'out.json');
    const original = JSON.stringify(createProjectDocument(createDemoProject()));
    const argumentsText = JSON.stringify({text: input, basis: 'source', report: true});
    await fs.writeFile(project, original); await fs.writeFile(args, argumentsText);
    const run = tail => spawnSync(process.execPath, [fileURLToPath(new URL('../cli/moment.mjs', import.meta.url)),
      'exec', 'captions.import', '--project', project, '--args-file', args, ...tail], {encoding: 'utf8', timeout: 10000});
    let result = run(['--dry-run', '--out', out]);
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout).data.report, expectedReport);
    await assert.rejects(fs.stat(out), {code: 'ENOENT'});
    await fs.writeFile(out, 'keep existing');
    result = run(['--dry-run', '--out', out, '--overwrite']);
    assert.equal(result.status, 0, result.stderr); assert.equal(await fs.readFile(out, 'utf8'), 'keep existing');
    assert.equal(await fs.readFile(project, 'utf8'), original); assert.equal(await fs.readFile(args, 'utf8'), argumentsText);
    result = run(['--out', out, '--overwrite']);
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout).data.report, expectedReport);
    const saved = JSON.parse(await fs.readFile(out, 'utf8'));
    assert.equal(saved.format, 'moment-project'); assert.equal(saved.project.captions.length, 1);
    assert.equal(Object.hasOwn(saved, 'report'), false); assert.equal(Object.hasOwn(saved.project, 'report'), false);
  } finally {await fs.rm(dir, {recursive: true, force: true});}
});
