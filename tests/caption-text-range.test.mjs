import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { replaceCaptionText, inspectCaptionTextReplacement } from '../dist/core/caption-text.mjs';
import { createDemoProject, createProjectDocument } from '../dist/core/project.mjs';
import { prepareCommand, commandDefinition } from '../dist/core/commands.mjs';
import { createEditorService } from '../dist/integration/editor-service.mjs';
import { createMcpToolAdapter } from '../dist/integration/mcp-adapter.mjs';

const cue = (text, index = 0) => ({start:index,end:index+1,text,basis:'timeline',speaker:'1',keywords:'word',timing:'estimated'});
const options = {find:'aa',replacement:'$&😀'};

test('independent defaults select all, tail or prefix with literal nonoverlapping matches', () => {
  const captions = [cue('aaaa'), cue('aaaa'), cue('aaaa')];
  for (const [range, indexes] of [[{},[0,1,2]], [{captionIndex:1},[1,2]], [{count:1},[0]], [{captionIndex:1,count:1},[1]]]) {
    const result = replaceCaptionText(captions, {...options,...range});
    assert.equal(result.matches, indexes.length * 2);
    assert.equal(result.changedCaptions, indexes.length);
    assert.deepEqual(inspectCaptionTextReplacement(captions, {...options,...range}), {matches:result.matches,changedCaptions:result.changedCaptions});
    for (let index = 0; index < captions.length; index++) {
      if (indexes.includes(index)) assert.deepEqual(result.captions[index], {...captions[index],text:'$&😀$&😀'});
      else assert.equal(result.captions[index], captions[index]);
    }
  }
  assert.deepEqual(replaceCaptionText([], options), {captions:[],matches:0,changedCaptions:0});
});

test('explicit invalid ranges reject before no hits or identical replacement, including empty arrays', () => {
  for (const captions of [[], [cue('same')]]) {
    for (const args of [{find:'absent',replacement:'new'}, {find:'same',replacement:'same'}]) {
      for (const captionIndex of [-1,10000,1,.5,'0',null,undefined,NaN,Infinity]) {
        for (const helper of [replaceCaptionText, inspectCaptionTextReplacement]) {
          assert.throws(() => helper(captions, {...args,captionIndex}), error => error.code === 'INVALID_ARGUMENT' && error.path === 'arguments.captionIndex');
        }
      }
      for (const count of [0,-1,10001,2,.5,'1',null,undefined,NaN,Infinity]) {
        for (const helper of [replaceCaptionText, inspectCaptionTextReplacement]) {
          assert.throws(() => helper(captions, {...args,count}), error => error.code === 'INVALID_ARGUMENT' && error.path === 'arguments.count');
        }
      }
    }
  }
  assert.throws(() => replaceCaptionText([], {...options,captionIndex:0}), {path:'arguments.captionIndex'});
  assert.throws(() => replaceCaptionText([], {...options,count:1}), {path:'arguments.count'});
});

test('range protects outside unusable results and preserves absolute failure paths atomically', () => {
  const captions = [cue('a'), cue('a ok'), cue('a'.repeat(2000))];
  const before = structuredClone(captions);
  const result = replaceCaptionText(captions, {find:'a',replacement:'',captionIndex:1,count:1});
  assert.equal(result.captions[1].text, ' ok');
  assert.equal(result.captions[0], captions[0]);
  assert.equal(result.captions[2], captions[2]);
  for (const helper of [replaceCaptionText, inspectCaptionTextReplacement]) {
    assert.throws(() => helper(captions, {find:'a',replacement:'',count:2}), {path:'project.captions[0].text'});
    assert.throws(() => helper(captions, {find:'a',replacement:'aa',captionIndex:1}), {path:'project.captions[2].text'});
  }
  assert.deepEqual(captions, before);
  const noop = replaceCaptionText(captions, {find:'a',replacement:'a',captionIndex:0,count:1});
  assert.equal(noop.captions, captions);
  assert.equal(noop.changedCaptions, 0);
});

test('10,000 mixed-basis rows cross page boundaries without touching outside references or metadata', () => {
  const captions = Array.from({length:10000}, (_,index) => ({...cue('한글 aa e\u0301',index),...(index%2?{}:{basis:'source'})}));
  const before = structuredClone(captions);
  const result = replaceCaptionText(captions, {...options,captionIndex:49,count:2});
  assert.equal(result.matches, 2);
  for (let index = 0; index < captions.length; index++) {
    if (index === 49 || index === 50) assert.deepEqual(result.captions[index], {...captions[index],text:'한글 $&😀 e\u0301'});
    else assert.equal(result.captions[index], captions[index]);
  }
  assert.deepEqual(captions, before);
  assert.equal(replaceCaptionText(captions, {...options,captionIndex:9999,count:1}).changedCaptions, 1);
});

test('service, batch preview and MCP schemas use scoped counts without extra commits', async () => {
  let project = createDemoProject(), commits = 0;
  project.captions = [cue('aa'),cue('aa'),cue('aa')];
  project.clips = [{start:0,end:1}]; // Valid existing later timeline cues remain untouched.
  const service = createEditorService({getProject:() => project,commitProject:next => {project=next;commits++;}});
  const adapter = createMcpToolAdapter({resolveService:() => service});
  const tool = adapter.listTools().tools.find(item => item.name === 'moment_captions_text_replace');
  assert.deepEqual(tool.inputSchema.properties.captionIndex, {...commandDefinition('captions.text.replace').inputSchema.properties.captionIndex,description:tool.inputSchema.properties.captionIndex.description});
  const operation = {command:'captions.text.replace',arguments:{...options,captionIndex:1,count:1}};
  const preview = await service.execute('project.preview',{operations:[operation]});
  assert.deepEqual(preview.data.changedFields, ['captions']);
  assert.equal(commits, 0);
  const result = await adapter.callTool(tool.name,{projectId:'session',...operation.arguments});
  assert.deepEqual(result.structuredContent.data,{updated:true,matches:1,changedCaptions:1});
  assert.equal(commits, 1);
  const before = structuredClone(project);
  const failed = await service.execute('project.batch',{operations:[operation,{command:'captions.text.replace',arguments:{...options,count:4}}]});
  assert.equal(failed.ok, false);
  assert.equal(commits, 1);
  assert.deepEqual(project, before);
  assert.equal((await service.execute('captions.text.replace',{find:'absent',replacement:'x',count:1})).data.updated, false);
  assert.equal(commits, 1);
});

test('CLI range edits are exact, dry-run writes nothing and invalid range preserves existing output', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'moment-replace-range-'));
  try {
    const input = path.join(directory,'in.json'), output = path.join(directory,'out.json');
    const project = createDemoProject(); project.captions = [cue('aa'),cue('aa')];
    await fs.writeFile(input,JSON.stringify(createProjectDocument(project)));
    await fs.writeFile(output,'sentinel');
    const cli = fileURLToPath(new URL('../cli/moment.mjs',import.meta.url));
    const run = (range, extra=[]) => spawnSync(process.execPath,[cli,'exec','captions.text.replace','--project',input,'--json',JSON.stringify({...options,...range}),'--out',output,'--overwrite',...extra],{encoding:'utf8'});
    assert.equal(run({captionIndex:1,count:1},['--dry-run']).status,0);
    assert.equal(await fs.readFile(output,'utf8'),'sentinel');
    assert.equal(run({count:3}).status,1);
    assert.equal(await fs.readFile(output,'utf8'),'sentinel');
    assert.equal(run({captionIndex:1,count:1}).status,0);
    const saved = JSON.parse(await fs.readFile(output,'utf8')).project;
    assert.deepEqual(saved.captions,[project.captions[0],{...project.captions[1],text:'$&😀'}]);
  } finally { await fs.rm(directory,{recursive:true,force:true}); }
});
