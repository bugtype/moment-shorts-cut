import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_CAPTIONS, parseSubtitles} from '../dist/captions.mjs';
import {createDemoProject, createProjectDocument, readProjectDocument} from '../dist/core/project.mjs';
import {commandDefinition, prepareCommand} from '../dist/core/commands.mjs';

test('subtitle import, project documents and replacement commands share the caption count boundary', () => {
  assert.equal(MAX_CAPTIONS, 10000);
  assert.equal(commandDefinition('captions.replace').inputSchema.properties.captions.maxItems, MAX_CAPTIONS);
  const cue='00:00:00,000 --> 00:00:01,000\n자막 🎬\n\n';
  const captions=parseSubtitles(cue.repeat(MAX_CAPTIONS),12);
  const original=createDemoProject();
  const {project}=prepareCommand(original,'captions.replace',{captions});
  assert.equal(project.captions.length,MAX_CAPTIONS);
  assert.deepEqual(readProjectDocument(createProjectDocument(project)),project);
  assert.throws(()=>parseSubtitles(cue.repeat(MAX_CAPTIONS+1),12),/10,000/);
  const tooMany=[...captions,{start:0,end:1,text:'one more'}];
  assert.throws(()=>prepareCommand(original,'captions.replace',{captions:tooMany}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>createProjectDocument({...project,captions:tooMany}),{code:'INVALID_ARGUMENT'});
  assert.deepEqual(original,createDemoProject());
});
