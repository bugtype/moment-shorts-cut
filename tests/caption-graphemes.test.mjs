import {LocalizedError} from '../dist/core/validation.mjs';
import {message as msg} from '../dist/i18n.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {splitCaptionText} from '../dist/effects.mjs';
import {createDemoProject,createProjectDocument,readProjectDocument} from '../dist/core/project.mjs';

const segments=text=>Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text),item=>item.segment);

test('caption splits keep combining, Hangul and emoji clusters intact without normalization',()=>{
 for(const cluster of ['e\u0301','\u1100\u1161\u11a8','👍🏽','👩‍👩‍👧‍👦','🇰🇷','✈️',' \u0301']){
  for(const basis of ['source','timeline'])for(const limit of [1,12,18,24]){
   const caption={start:2,end:8,text:cluster.repeat(limit+1),basis,speaker:'1',keywords:cluster};
   const before=structuredClone(caption),pieces=splitCaptionText(caption,limit);
   assert.equal(pieces.length,2);assert.equal(pieces.map(c=>c.text).join(''),caption.text);
   assert.equal(pieces[0].text,cluster.repeat(limit));assert.equal(pieces[1].text,cluster);
   assert.equal(pieces[0].start,2);assert.equal(pieces.at(-1).end,8);
   assert.equal(pieces[0].end,2+6*limit/(limit+1));
   for(const [i,piece] of pieces.entries()){
    assert.equal(piece.basis,basis);assert.equal(piece.speaker,'1');assert.equal(piece.keywords,cluster);assert.equal(piece.timing,'estimated');
    assert.ok(piece.end>piece.start);if(i)assert.equal(piece.start,pieces[i-1].end);
   }
   assert.deepEqual(caption,before);
   const project={...createDemoProject(),captions:pieces};assert.deepEqual(readProjectDocument(createProjectDocument(project)),project);
  }
 }
});

test('split timing uses grapheme weights, retains whitespace boundaries and leaves short cues unchanged',()=>{
 const pieces=splitCaptionText({start:0,end:4,text:'ae\u0301😀가'},2);
 assert.deepEqual(pieces.map(c=>[c.text,c.start,c.end]),[['ae\u0301',0,2],['😀가',2,4]]);
 for(const [text,limit] of [['   \t\n',1],[' short ',5],['e\u0301',1],['a'+'\u0301'.repeat(1999),1]]){
  const cap={start:0,end:1,text};assert.equal(splitCaptionText(cap,limit)[0],cap);
 }
 for(const text of ['  alpha   beta gamma  ','alpha\t\tbeta\ngamma','alpha'+' '.repeat(30)+'beta']){
  const parts=splitCaptionText({start:0,end:4,text},6);
  assert.equal(parts.map(c=>c.text).join('').replace(/\s/g,''),text.replace(/\s/g,''));
  parts.forEach(c=>{assert.ok(c.text.trim());assert.ok(c.end>c.start);assert.ok(segments(c.text).length<=6);});
 }
 const oversized={...createDemoProject(),captions:[{start:0,end:1,text:'a'+'\u0301'.repeat(2000)}]};
 assert.throws(()=>createProjectDocument(oversized),{code:'INVALID_ARGUMENT'},'a single grapheme cannot bypass the UTF-16 limit');
});

test('missing native segmentation rejects splitting without changing input or preventing module load',()=>{
 const source=readFileSync(new URL('../dist/effects.mjs',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replaceAll('export ','');
 for(const Intl of [undefined,{}]){
  const split=vm.runInNewContext(source+';splitCaptionText',{Intl,LocalizedError,msg});
  const caption={start:0,end:1,text:'unchanged'},before=structuredClone(caption);
  assert.throws(()=>split(caption),/문자 분할/);assert.deepEqual(caption,before);
 }
});
