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
