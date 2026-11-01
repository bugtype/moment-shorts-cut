import test from 'node:test';
import assert from 'node:assert/strict';
import {assertJson} from '../dist/core/validation.mjs';
import {createDemoProject,createProjectDocument,readProjectDocument} from '../dist/core/project.mjs';
import {initLocale,setLocale,formatError} from '../dist/i18n.mjs';

const isRepeatedAt=path=>error=>error.code==='INVALID_ARGUMENT'&&
  error.messageKey==='errors.sharedReference'&&error.path===path;

test('JSON trees reject repeated objects, arrays and cycles at the repeated path',()=>{
  const object={text:'same'},array=['same'],cycle={};cycle.self=cycle;
  assert.throws(()=>assertJson({first:object,second:object}),isRepeatedAt('$.second'));
  assert.throws(()=>assertJson({first:array,second:array}),isRepeatedAt('$.second'));
  assert.throws(()=>assertJson([object,object]),isRepeatedAt('$.1'));
  assert.throws(()=>assertJson(cycle),isRepeatedAt('$.self'));
  const cyclicArray=[];cyclicArray.push(cyclicArray);
  assert.throws(()=>assertJson(cyclicArray),isRepeatedAt('$.0'));
});

test('equal independent values and repeated primitives remain valid; validation has no lasting ownership',()=>{
  const value={first:{text:'same'},second:{text:'same'},arrays:[['same'],['same']],
    primitives:[null,null,false,false,1,1,'same','same']};
  assert.doesNotThrow(()=>assertJson(value));
  assert.doesNotThrow(()=>assertJson(value));
  assert.deepEqual(JSON.parse(JSON.stringify(value)),value);
});

test('project object import/export rejects cross-field aliases without changing the input',()=>{
  const project=createDemoProject();
  project.speakerColors=['#ffffff','#b5ff00'];
  project.design.title.colors=project.speakerColors;
  const document={format:'moment-project',formatVersion:1,project};
  const before=JSON.stringify(document),colors=project.speakerColors;
  assert.throws(()=>createProjectDocument(project),isRepeatedAt('$.design.title.colors'));
  assert.throws(()=>readProjectDocument(document),isRepeatedAt('$.project.design.title.colors'));
  assert.equal(JSON.stringify(document),before);
  assert.equal(project.speakerColors,colors);
  assert.equal(project.design.title.colors,colors);
  // JSON files already represent independent values, so their contract is unchanged.
  const restored=readProjectDocument(JSON.parse(before));
  assert.notEqual(restored.design.title.colors,restored.speakerColors);
  const exported=createProjectDocument(restored);
  assert.deepEqual(readProjectDocument(JSON.parse(JSON.stringify(exported))),restored);
  assert.notEqual(exported.project,restored);
});

test('shared-reference errors have localized guidance without exposing authored data',()=>{
  initLocale();
  try{
    const shared={text:'PRIVATE_AUTHORED_CONTENT'},messages=new Set();
    for(const locale of ['ko','en','zh-CN']){
      setLocale(locale);
      assert.throws(()=>assertJson({first:shared,second:shared}),error=>{
        assert.ok(isRepeatedAt('$.second')(error));
        const text=formatError(error);messages.add(text);
        assert.doesNotMatch(text,/PRIVATE_AUTHORED_CONTENT|errors\.sharedReference/);
        assert.ok(text.length>10);
        return true;
      });
    }
    assert.equal(messages.size,3);
  }finally{initLocale();}
});
