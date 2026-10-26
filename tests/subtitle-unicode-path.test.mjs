import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDemoProject, createProjectDocument, projectSubtitles} from '../dist/core/project.mjs';

const formats = [{format:'srt'}, {format:'vtt'}, {format:'txt'}, {format:'txt',review:true}];
function fixture() {
  const project = createDemoProject();
  project.speed = 2;
  project.clips = [{start:4,end:6}, {start:0,end:2}, {start:4,end:6}];
  project.captions = [
    {start:9,end:10,text:'Trimmed invalid \ud800'},
    {start:0,end:1,text:'Later valid source'},
    {start:4,end:5,text:'First emitted invalid \ud800',speaker:'1'},
    {start:0,end:.5,text:'Timeline text',basis:'timeline'},
  ];
  return project;
}
const unicodeAt = field => error => error.code === 'INVALID_ARGUMENT' &&
  error.messageKey === 'errors.textUnicode' && error.path === field;

for (const format of formats) {
  test(`${JSON.stringify(format)} Unicode errors identify authored rows, not sorted/repeated output positions`, () => {
    const project = fixture(), before = structuredClone(project);
    for (const range of [{}, {captionIndex:1,count:3}, {captionIndex:2,count:1}, {captionIndex:1}, {count:3}])
      assert.throws(() => projectSubtitles(project, {...format,...range}), unicodeAt('project.captions[2].text'));
    assert.deepEqual(project,before);
    assert.doesNotThrow(() => projectSubtitles(project, {...format,captionIndex:1,count:1}));
    project.captions[2].text = 'Fixed 😀 �';
    assert.doesNotThrow(() => projectSubtitles(project,format), 'Trimmed invalid text stays excluded');
    project.captions[3].text = 'Timeline invalid \udfff';
    assert.throws(() => projectSubtitles(project, {...format,captionIndex:1}), unicodeAt('project.captions[3].text'));
  });
}

test('review Unicode failures distinguish an emitted speaker label from cue text and ignore unused labels', () => {
  const project = fixture();
  project.speakerLabels = ['Unused invalid \ud800', 'Used invalid \udfff'];
  for (const range of [{}, {captionIndex:2,count:1}, {captionIndex:1,count:3}]) {
    assert.throws(() => projectSubtitles(project,{format:'txt',review:true,...range}), unicodeAt('project.captions[2].text'));
    project.captions[2].text = 'Valid text';
    assert.throws(() => projectSubtitles(project,{format:'txt',review:true,...range}), unicodeAt('project.speakerLabels[1]'));
    project.captions[2].text = 'Invalid \ud800';
  }
  project.captions[2].text = 'Valid text';
  for (const format of ['srt','vtt','txt']) assert.doesNotThrow(() => projectSubtitles(project,{format}));
  project.speakerLabels[1] = 'Valid 😀 speaker';
  assert.doesNotThrow(() => projectSubtitles(project,{format:'txt',review:true}));
  project.captions[2].speaker = '0';
  assert.throws(() => projectSubtitles(project,{format:'txt',review:true,captionIndex:2}), unicodeAt('project.speakerLabels[0]'));
});

test('existing NUL, precision, blank-line and range diagnostics retain their precedence and shape', () => {
  const project = fixture();
  project.captions[2].text = '\ud800\0';
  for (const format of formats) assert.throws(() => projectSubtitles(project,format), error =>
    error.messageKey === (format.review ? 'review.nul' : `errors.${format.format}Nul`) && error.path === undefined);
  project.captions[2].text = '\ud800';project.speakerLabels[1] = '\0';
  assert.throws(() => projectSubtitles(project,{format:'txt',review:true}), error => error.messageKey === 'review.nul' && error.path === undefined);
  project.captions[2].end = 4.00001;
  assert.throws(() => projectSubtitles(project,{format:'srt'}), error => error.messageKey === 'errors.subtitlePrecision' && error.path === undefined);
  project.captions[2].end = 5;project.captions[2].text = '\ud800\n\nblank';
  assert.throws(() => projectSubtitles(project,{format:'vtt'}), error => error.messageKey === 'errors.subtitleBlank' && error.path === undefined);
  assert.throws(() => projectSubtitles(project,{captionIndex:4}), {path:'arguments.captionIndex'});
  assert.throws(() => projectSubtitles(project,{format:'srt',review:true,captionIndex:4}), {path:'arguments.review'});
});

test('real CLI exposes a repairable authored path and preserves existing files until targeted repair succeeds', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'moment-unicode-path-'));
  try {
    const input=path.join(directory,'source.json'), output=path.join(directory,'review.vtt'), repaired=path.join(directory,'repaired.json');
    const document=createProjectDocument(fixture()), original=JSON.stringify(document);
    await fs.writeFile(input,original);await fs.writeFile(output,'Existing reviewed bytes');
    const cli=fileURLToPath(new URL('../cli/moment.mjs',import.meta.url));
    const run=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});
    const args=['--json','{"format":"vtt","captionIndex":1,"count":3}','--out',output,'--overwrite'];
    const failed=run('exec','captions.export','--project',input,...args);
    assert.equal(failed.status,1);assert.equal(failed.stdout,'');
    assert.equal(JSON.parse(failed.stderr).error.path,'project.captions[2].text');
    assert.equal(await fs.readFile(input,'utf8'),original);assert.equal(await fs.readFile(output,'utf8'),'Existing reviewed bytes');
    const repair=run('exec','captions.update','--project',input,'--json','{"captionIndex":2,"patch":{"text":"Repaired 😀"}}','--out',repaired);
    assert.equal(repair.status,0,repair.stderr);
    const expected=structuredClone(document);expected.project.captions[2].text='Repaired 😀';
    assert.deepEqual(JSON.parse(await fs.readFile(repaired,'utf8')),expected);
    const retry=run('exec','captions.export','--project',repaired,...args);
    assert.equal(retry.status,0,retry.stderr);assert.match(await fs.readFile(output,'utf8'),/Repaired 😀/);
    assert.equal(await fs.readFile(input,'utf8'),original);
    assert.equal((await fs.readdir(directory)).some(name=>name.startsWith('.moment-')),false);
  } finally {await fs.rm(directory,{recursive:true,force:true});}
});

test('real MCP session uses the path to repair cue then speaker without altering unrelated project data', () => {
  const project=fixture();project.speakerLabels[1]='Invalid \ud800 label';
  const document=createProjectDocument(project);
  const call=(id,name,args={})=>({jsonrpc:'2.0',id,method:'tools/call',params:{name:`moment_${name}`,arguments:{projectId:'session',...args}}});
  const messages=[
    {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'path-recovery',version:'1'}}},
    {jsonrpc:'2.0',method:'notifications/initialized'},
    call(2,'project_import',{document}),
    call(3,'captions_export',{format:'txt',review:true,captionIndex:1,count:3}),
    call(4,'project_get'),
    call(5,'captions_update',{captionIndex:2,patch:{text:'Fixed cue'}}),
    call(6,'captions_export',{format:'txt',review:true,captionIndex:2,count:1}),
    call(7,'captions_style_update',{patch:{speakerLabels:[project.speakerLabels[0],'Fixed speaker']}}),
    call(8,'captions_export',{format:'txt',review:true,captionIndex:2,count:1}),
    call(9,'project_get'),
  ];
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../cli/mcp.mjs',import.meta.url))],{
    input:messages.map(JSON.stringify).join('\n')+'\n',encoding:'utf8',maxBuffer:4*1024*1024,
  });
  assert.equal(result.status,0,result.stderr);
  const replies=new Map(result.stdout.trim().split('\n').map(line=>{const r=JSON.parse(line);return [r.id,r.result];}));
  for (const [id,field] of [[3,'project.captions[2].text'],[6,'project.speakerLabels[1]']]) {
    const response=replies.get(id);assert.equal(response.isError,true);
    assert.equal(response.structuredContent.error.code,'INVALID_ARGUMENT');assert.equal(response.structuredContent.error.path,field);
    assert.deepEqual(JSON.parse(response.content[0].text),response.structuredContent);
  }
  assert.deepEqual(replies.get(4).structuredContent.data,document);
  assert.equal(replies.get(8).isError,false);assert.match(replies.get(8).structuredContent.data.text,/Fixed speaker/);
  const expected=structuredClone(document);expected.project.captions[2].text='Fixed cue';expected.project.speakerLabels[1]='Fixed speaker';
  assert.deepEqual(replies.get(9).structuredContent.data,expected);
});
