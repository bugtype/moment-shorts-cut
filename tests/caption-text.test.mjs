import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {replaceCaptionText} from '../dist/core/caption-text.mjs';
import {createDemoProject,createProjectDocument} from '../dist/core/project.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
const cap=text=>({start:1,end:3,text,basis:'timeline',speaker:'1',keywords:'원본',timing:'estimated'});

test('literal correction preserves timing, basis and metadata while counting nonoverlapping matches',()=>{
 const captions=[cap('이름 이름 😀'),cap('aaaa'),cap('Name name'),cap('e\u0301 é')],before=structuredClone(captions);
 const result=replaceCaptionText(captions,{find:'이름',replacement:'$& <새>'});
 assert.equal(result.matches,2);assert.equal(result.changedCaptions,1);
 assert.deepEqual(result.captions[0],{...captions[0],text:'$& <새> $& <새> 😀'});
 assert.equal(result.captions[1],captions[1]);assert.deepEqual(captions,before);
 assert.equal(replaceCaptionText(captions,{find:'aa',replacement:'b'}).captions[1].text,'bb');
 assert.equal(replaceCaptionText(captions,{find:'name',replacement:'용어'}).captions[2].text,'Name 용어');
 assert.equal(replaceCaptionText(captions,{find:'é',replacement:'E'}).captions[3].text,'e\u0301 E');
 assert.equal(replaceCaptionText([cap('a.* a.*')],{find:'.*',replacement:'$1'}).captions[0].text,'a$1 a$1');
});
test('no match or identical replacement reuses original captions without changing history-worthy state',()=>{
 const captions=[cap('안녕 안녕')];
 for(const args of [{find:'없음',replacement:''},{find:'안녕',replacement:'안녕'}]){
  const result=replaceCaptionText(captions,args);assert.equal(result.captions,captions);assert.equal(result.changedCaptions,0);
 }
 assert.equal(replaceCaptionText(captions,{find:'안녕',replacement:'안녕'}).matches,2);
 assert.equal(replaceCaptionText([cap('말 지움')],{find:' 지움',replacement:''}).captions[0].text,'말');
});
test('invalid input or any unusable result rejects the entire replacement without mutation',()=>{
 for(const args of [{find:'',replacement:'a'},{find:'a'.repeat(2001),replacement:''},{find:'a',replacement:'b'.repeat(2001)},{find:null,replacement:'a'},{find:'a',replacement:1}])
  assert.throws(()=>replaceCaptionText([cap('a')],args),e=>e.code==='INVALID_ARGUMENT');
 for(const [captions,args] of [
  [[cap('a ok'),cap('a')],{find:'a',replacement:''}],
  [[cap('a ok'),cap('a ')],{find:'a',replacement:' '}],
  [[cap('a'),cap('a'.repeat(2000))],{find:'a',replacement:'bb'}],
 ]){
  const before=structuredClone(captions);assert.throws(()=>replaceCaptionText(captions,args),e=>e.code==='INVALID_ARGUMENT'&&e.path==='project.captions[1].text');assert.deepEqual(captions,before);
 }
 assert.equal(replaceCaptionText([cap('a'.repeat(1000))],{find:'a',replacement:'bb'}).captions[0].text.length,2000);
});
test('shared command commits once, never commits no-op/error and preserves unrelated project data',async()=>{
 let project=createDemoProject(),commits=0;project.captions=[cap('이름 이름')];
 const before=structuredClone(project);
 const service=createEditorService({getProject:()=>project,commitProject:next=>{project=next;commits++;}});
 const result=await service.execute('captions.text.replace',{find:'이름',replacement:'새 이름'});
 assert.deepEqual(result.data,{updated:true,matches:2,changedCaptions:1});assert.equal(commits,1);
 assert.deepEqual({...project,captions:before.captions},before);
 for(const args of [{find:'없음',replacement:'x'},{find:'이름',replacement:'이름'}])assert.equal((await service.execute('captions.text.replace',args)).data.updated,false);
 assert.equal(commits,1);
 const saved=structuredClone(project);
 const failed=await service.execute('captions.text.replace',{find:'새 이름 새 이름',replacement:''});assert.equal(failed.ok,false);assert.equal(commits,1);assert.deepEqual(project,saved);
});
test('CLI dry-run previews correction, save round-trips, and invalid changes leave destination untouched',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-correct-'));
 try{
  const input=path.join(dir,'project.json'),output=path.join(dir,'corrected.json'),p=createDemoProject();p.captions=[cap('이름 이름')];
  const original=JSON.stringify(createProjectDocument(p));await fs.writeFile(input,original);
  const run=args=>spawnSync(process.execPath,[fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),'exec','captions.text.replace','--project',input,...args],{encoding:'utf8'});
  const args=['--json','{"find":"이름","replacement":"새 이름"}'];
  let result=run([...args,'--dry-run']);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).preview.project.captions[0].text,'새 이름 새 이름');
  result=run([...args,'--out',output]);assert.equal(result.status,0,result.stderr);const saved=await fs.readFile(output,'utf8');assert.equal(JSON.parse(saved).project.captions[0].text,'새 이름 새 이름');
  result=run(['--json','{"find":"이름 이름","replacement":""}','--out',output,'--overwrite']);assert.equal(result.status,1);assert.equal(await fs.readFile(output,'utf8'),saved);assert.equal(await fs.readFile(input,'utf8'),original);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('replacement inspection matches application without returning caption data', async () => {
  const { inspectCaptionTextReplacement } = await import('../dist/core/caption-text.mjs');
  for (const [text, find, replacement, expected] of [
    ['aaa', 'aa', 'X', 'Xa'],
    ['aaaaa', 'aa', 'aa', 'aaaaa'],
    ['a a', 'a', '$&$$$`', '$&$$$` $&$$$`'],
    ['가🙂가🙂', '가🙂', 'e\u0301', 'e\u0301e\u0301'],
    ['hello', 'absent', 'x', 'hello'],
    [' a b ', 'a', '', '  b '],
    ['\r\na\r\n', 'a', 'b', '\r\nb\r\n'],
  ]) {
    const captions = [{ start: 1, end: 2, text, speaker: '0', basis: 'timeline', timing: 'estimated' }];
    const before = structuredClone(captions);
    const preview = inspectCaptionTextReplacement(captions, { find, replacement });
    const applied = replaceCaptionText(captions, { find, replacement });
    assert.deepEqual(preview, { matches: applied.matches, changedCaptions: applied.changedCaptions });
    assert.equal(applied.captions[0].text, expected);
    assert.deepEqual(captions, before);
    assert.equal(Object.hasOwn(preview, 'captions'), false);
    if (!preview.changedCaptions) assert.equal(applied.captions, captions);
  }
  assert.deepEqual(inspectCaptionTextReplacement([], { find: 'a', replacement: '' }), {
    matches: 0, changedCaptions: 0,
  });
});

test('replacement inspection preserves validation order and global cue error paths', async () => {
  const { inspectCaptionTextReplacement } = await import('../dist/core/caption-text.mjs');
  const cases = [
    { find: '', replacement: 'x' },
    { find: null, replacement: 'x' },
    { find: 'a'.repeat(2001), replacement: 'x' },
    { find: 'a', replacement: null },
    { find: 'a', replacement: 'x'.repeat(2001) },
    { find: 'a', replacement: 'x'.repeat(2000) },
    { find: 'a', replacement: ' \n' },
  ];
  const captions = [{ start: 0, end: 1, text: 'untouched' }, { start: 1, end: 2, text: 'aa' }];
  const before = structuredClone(captions);
  function failure(fn) {
    let caught;
    try { fn(); } catch (error) { caught = error; }
    assert.ok(caught, 'Expected validation failure');
    return { code: caught.code, path: caught.path, message: caught.message };
  }
  for (const options of cases) {
    assert.deepEqual(
      failure(() => inspectCaptionTextReplacement(captions, options)),
      failure(() => replaceCaptionText(captions, options)),
    );
    assert.deepEqual(captions, before);
  }
  const result = failure(() => inspectCaptionTextReplacement(captions, { find: 'a', replacement: '' }));
  assert.equal(result.code, 'INVALID_ARGUMENT');
  assert.equal(result.path, 'project.captions[1].text');
});

test('inspection and application agree with the original split/join model for seeded literal cases', async () => {
  const { inspectCaptionTextReplacement } = await import('../dist/core/caption-text.mjs');
  let seed = 1729;
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  const characters = ['a', 'b', ' ', '\n', '$', '&', '가', '🙂', '\u0301'];
  const word = length => Array.from({ length }, () => characters[random(characters.length)]).join('');
  for (let run = 0; run < 200; run++) {
    const captions = Array.from({ length: 5 }, (_, index) => ({ start: index, end: index + 1, text: word(20) }));
    const find = word(1 + random(3));
    const replacement = run % 5 === 0 ? find : word(random(5));
    let matches = 0, changedCaptions = 0;
    const expected = captions.map(caption => {
      const parts = caption.text.split(find);
      matches += parts.length - 1;
      if (parts.length === 1 || find === replacement) return caption;
      changedCaptions++;
      return { ...caption, text: parts.join(replacement) };
    });
    assert.deepEqual(inspectCaptionTextReplacement(captions, { find, replacement }), { matches, changedCaptions });
    const result = replaceCaptionText(captions, { find, replacement });
    assert.deepEqual(result.captions, expected);
    for (let index = 0; index < captions.length; index++) {
      if (expected[index] === captions[index]) assert.equal(result.captions[index], captions[index]);
    }
  }
  const blank = [{ start: 0, end: 1, text: '   ' }];
  assert.deepEqual(inspectCaptionTextReplacement(blank, { find: ' ', replacement: ' ' }), {
    matches: 3, changedCaptions: 0,
  });
});

test('nonblank replacement preview avoids split output while application and whitespace checks retain it', async () => {
  const {inspectCaptionTextReplacement}=await import('../dist/core/caption-text.mjs');
  const original=String.prototype.split, find='확인';let splits=0;
  String.prototype.split=function(separator,...args){if(separator===find)splits++;return original.call(this,separator,...args);};
  try {
    const captions=[cap('확인 확인'),cap('앞 확인 뒤')],before=structuredClone(captions);
    const options={find,replacement:'$&🙂 e\u0301'};
    assert.deepEqual(inspectCaptionTextReplacement(captions,options),{matches:3,changedCaptions:2});
    assert.equal(splits,0,'preview needs counts and validity, not replacement output');
    const result=replaceCaptionText(captions,options);
    assert.equal(splits,2);assert.equal(result.captions[0].text,'$&🙂 e\u0301 $&🙂 e\u0301');
    assert.equal(result.captions[1].text,'앞 $&🙂 e\u0301 뒤');assert.deepEqual(captions,before);
    splits=0;
    assert.deepEqual(inspectCaptionTextReplacement([cap('확인 남김'),cap('본문 확인')],{find,replacement:''}),{matches:2,changedCaptions:2});
    assert.equal(splits,2,'empty replacement still inspects constructed text');
    splits=0;
    assert.throws(()=>inspectCaptionTextReplacement([cap('확인')],{find,replacement:'\ufeff \n'}),error=>error.messageKey==='errors.replacedEmpty'&&error.path==='project.captions[0].text');
    assert.equal(splits,1);
    splits=0;
    assert.throws(()=>inspectCaptionTextReplacement([cap('확인확인')],{find,replacement:'x'.repeat(1001)}),error=>error.messageKey==='errors.replacedTooLong'&&error.path==='project.captions[0].text');
    assert.equal(splits,0,'UTF-16 length limit still rejects before construction');
  } finally {String.prototype.split=original;}
});

test('preview nonblank proof keeps native trim whitespace and UTF-16 limit semantics',async()=>{
  const {inspectCaptionTextReplacement}=await import('../dist/core/caption-text.mjs');
  const whitespace=[9,10,11,12,13,32,160,5760,...Array.from({length:11},(_,i)=>8192+i),8232,8233,8239,8287,12288,65279];
  for(const code of whitespace) {
    const options={find:'x',replacement:String.fromCodePoint(code)};
    for(const helper of [inspectCaptionTextReplacement,replaceCaptionText])
      assert.throws(()=>helper([cap('x')],options),error=>error.messageKey==='errors.replacedEmpty'&&error.path==='project.captions[0].text');
  }
  for(const replacement of ['\u0301','\u200b','\ud800','\udc00','🙂','$&$1$`', '\r\n한글\n']) {
    const captions=[cap('xx')],options={find:'x',replacement};
    assert.deepEqual(inspectCaptionTextReplacement(captions,options),{matches:2,changedCaptions:1});
    assert.equal(replaceCaptionText(captions,options).captions[0].text,replacement+replacement);
  }
  for(const helper of [inspectCaptionTextReplacement,replaceCaptionText]) {
    const accepted=helper([cap('x'.repeat(1000))],{find:'x',replacement:'🙂'});
    assert.equal(accepted.changedCaptions,1);assert.equal(accepted.matches,1000);
    assert.throws(()=>helper([cap('x'.repeat(1001))],{find:'x',replacement:'🙂'}),error=>error.messageKey==='errors.replacedTooLong');
    assert.throws(()=>helper([cap('x')],{find:'',replacement:'🙂'}),error=>error.path==='arguments.find');
  }
});
