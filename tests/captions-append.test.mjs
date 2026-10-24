import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDemoProject,createProjectDocument,validateProject} from '../dist/core/project.mjs';
import {prepareCommand,commandDefinition} from '../dist/core/commands.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createMcpToolAdapter} from '../dist/integration/mcp-adapter.mjs';

function fixture(){
  const p=createDemoProject();p.clips=[{start:2,end:4},{start:2,end:4}];p.speed=2;
  p.captions=[{start:10,end:11,text:'Retained outside output',basis:'timeline',speaker:'1',keywords:'retain',timing:'estimated'},
    {start:8,end:9,text:'Original',speaker:'0',keywords:'unchanged'}];
  return p;
}
const added=[{start:2,end:3,text:' source <b> literal 🎬 '},{start:1,end:2,text:'timeline',basis:'timeline',speaker:'0',keywords:'word'}];
const srt='1\n00:00:01,000 --> 00:00:02,000\nImported';

test('append preserves every original, supplied order and absolute clocks without aliases or retiming',()=>{
  const p=fixture(),before=structuredClone(p),args={captions:structuredClone(added)},copy=structuredClone(args);
  const result=prepareCommand(p,'captions.append',args);
  const expected=structuredClone(before);expected.captions.push(...copy.captions);
  assert.deepEqual(result.project,expected);assert.deepEqual(result.data,{updated:true,outputDuration:2});
  assert.deepEqual(p,before);assert.deepEqual(args,copy);validateProject(result.project);
  args.captions[0].text='caller changed';result.project.captions[0].text='result changed';
  assert.equal(result.project.captions[2].text,added[0].text);assert.deepEqual(p,before);
  const repeat=prepareCommand(expected,'captions.append',copy);assert.equal(repeat.project.captions.length,6);
  assert.deepEqual(repeat.project.captions.slice(-2),added,'explicit retries append again');
});

test('incoming bounds and full combined cap reject atomically; empty is not an edit',()=>{
  const p=fixture(),before=structuredClone(p);
  for(const [args,expectedPath] of [
    [{captions:[]},'arguments.captions'],
    [{captions:[{start:1,end:1,text:'bad'}]},'arguments.captions[0]'],
    [{captions:[added[0],{start:3,end:5,text:'bad',basis:'timeline'}]},'arguments.captions[1]'],
    [{captions:[{start:11,end:13,text:'bad'}]},'arguments.captions[0]'],
    [{captions:[{start:0,end:1,text:'x',unknown:true}]},'arguments.captions[0].unknown'],
    [{captions:[{start:0,end:1,text:'x'}],offset:2},'arguments.offset'],
  ])assert.throws(()=>prepareCommand(p,'captions.append',args),e=>e.code==='INVALID_ARGUMENT'&&e.path===expectedPath);
  assert.deepEqual(p,before);
  p.captions=Array.from({length:9999},()=>({start:10,end:11,text:'old',basis:'timeline'}));
  const full=prepareCommand(p,'captions.append',{captions:[added[0]]}).project;assert.equal(full.captions.length,10000);
  assert.throws(()=>prepareCommand(full,'captions.append',{captions:[added[0]]}),e=>e.path==='project.captions');
  const empty=fixture();empty.captions=[];
  assert.equal(prepareCommand(empty,'captions.append',{captions:Array.from({length:10000},()=>added[0])}).project.captions.length,10000);
  assert.throws(()=>prepareCommand(empty,'captions.append',{captions:Array.from({length:10001},()=>added[0])}),e=>e.path==='arguments.captions');
});

test('single insert and replacement retain prior validation paths and acknowledgments',()=>{
  const p=fixture();
  const result=prepareCommand(p,'captions.insert',{captionIndex:1,caption:added[0]});
  assert.deepEqual(result.data,{updated:true,captionIndex:1,totalCaptions:3,outputDuration:2});
  assert.deepEqual(result.project.captions,[p.captions[0],added[0],p.captions[1]]);
  assert.throws(()=>prepareCommand(p,'captions.insert',{captionIndex:3,caption:added[0]}),e=>e.path==='arguments.captionIndex');
  assert.throws(()=>prepareCommand(p,'captions.insert',{captionIndex:1,caption:{start:4,end:5,text:'x',basis:'timeline'}}),e=>e.path==='arguments.caption');
  assert.throws(()=>prepareCommand(p,'captions.replace',{captions:[...p.captions,...added]}),e=>e.path==='arguments.captions[0]');
});

test('import append projects the old closed output and default/explicit replace stay identical',()=>{
  const p=fixture(),before=structuredClone(p);
  const append=prepareCommand(p,'captions.import',{text:srt,basis:'timeline',mode:'append'});
  assert.deepEqual(append.data,{updated:true,outputDuration:2,importedCaptions:1});
  assert.deepEqual(append.project.captions.slice(0,2),p.captions);
  assert.deepEqual(append.project.captions.at(-1),{start:1,end:2,text:'Imported',basis:'timeline'});
  const defaults=prepareCommand(p,'captions.import',{text:srt,basis:'source'});
  assert.deepEqual(defaults,prepareCommand(p,'captions.import',{text:srt,basis:'source',mode:'replace'}));
  assert.equal(defaults.project.captions.length,1);assert.deepEqual(p,before);
  for(const args of [{text:srt,basis:'source',mode:'merge'},{text:'x'.repeat(100001),basis:'source',mode:'append'}])
    assert.throws(()=>prepareCommand(p,'captions.import',args),e=>e.code==='INVALID_ARGUMENT');
});

test('preview does not commit, batch rollback is atomic, and service captures append arguments',async()=>{
  let p=fixture(),commits=0;
  const before=structuredClone(p),service=createEditorService({getProject:()=>p,commitProject:next=>{p=next;commits++;}});
  const operations=[{command:'captions.append',arguments:{captions:added}}];
  const preview=await service.execute('project.preview',{operations});assert.equal(preview.ok,true);assert.equal(preview.data.after.captionCount,4);assert.equal(commits,0);
  const bad=await service.execute('project.batch',{operations:[...operations,{command:'captions.append',arguments:{captions:[]}}]});
  assert.equal(bad.ok,false);assert.deepEqual(p,before);assert.equal(commits,0);
  const result=await service.execute('project.batch',{operations});assert.equal(result.ok,true);assert.equal(commits,1);assert.deepEqual(p.captions.slice(0,2),before.captions);
  const args={captions:[structuredClone(added[0])]};const pending=service.execute('captions.append',args);args.captions[0].text='late mutation';
  assert.equal((await pending).ok,true);assert.equal(p.captions.at(-1).text,added[0].text);assert.equal(commits,2);
  const adapter=createMcpToolAdapter({resolveService:()=>service});
  const tools=adapter.listTools().tools;assert.equal(tools.length,41);
  const tool=tools.find(t=>t.name==='moment_captions_append');assert.equal(tool.annotations.readOnlyHint,false);assert.match(tool.inputSchema.properties.captions.description,/Non-idempotent/);
  assert.equal(tool.inputSchema.properties.captions.minItems,1);assert.equal(tool.inputSchema.properties.captions.maxItems,10000);
  assert.deepEqual(commandDefinition('captions.import').inputSchema.properties.mode.enum,['replace','append']);
  assert.equal((await adapter.callTool(tool.name,{projectId:'session',captions:[]})).isError,true);
  const appended=await adapter.callTool(tool.name,{projectId:'session',captions:added});assert.deepEqual(appended.structuredContent.data,{updated:true,outputDuration:2});
});

test('real CLI args stdin writes append project and protects output on error; stdio import keeps exact output schema',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'moment-append-'));
  const cli=fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),mcp=fileURLToPath(new URL('../cli/mcp.mjs',import.meta.url));
  try{
    const p=fixture(),input=path.join(dir,'project.json'),output=path.join(dir,'appended.json');
    const raw=JSON.stringify(createProjectDocument(p));await fs.writeFile(input,raw);
    const run=args=>spawnSync(process.execPath,[cli,'exec','captions.append','--project',input,'--args-file','-','--out',output,...args.flags||[]],{input:JSON.stringify(args.value),encoding:'utf8'});
    assert.equal(run({value:{captions:added}}).status,0);const saved=JSON.parse(await fs.readFile(output,'utf8'));assert.deepEqual(saved.project.captions,[...p.captions,...added]);
    const bytes=await fs.readFile(output,'utf8');assert.notEqual(run({flags:['--overwrite'],value:{captions:[]}}).status,0);assert.equal(await fs.readFile(output,'utf8'),bytes);assert.equal(await fs.readFile(input,'utf8'),raw);
    const request=(id,name,args)=>({jsonrpc:'2.0',id,method:'tools/call',params:{name:'moment_'+name,arguments:{projectId:'session',...args}}});
    const messages=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'append-test',version:'1'}}},{jsonrpc:'2.0',method:'notifications/initialized'},request(2,'project_import',{document:createProjectDocument(p)}),request(3,'captions_append',{captions:added}),request(4,'captions_import',{text:srt,basis:'timeline',mode:'append'}),request(5,'project_get',{})];
    const child=spawnSync(process.execPath,[mcp],{input:messages.map(m=>JSON.stringify(m)).join('\n')+'\n',encoding:'utf8'});assert.equal(child.status,0,child.stderr);
    const replies=child.stdout.trim().split('\n').map(JSON.parse);assert.deepEqual(replies.find(r=>r.id===3).result.structuredContent.data,{updated:true,outputDuration:2});
    assert.deepEqual(replies.find(r=>r.id===4).result.structuredContent.data,{updated:true,outputDuration:2,importedCaptions:1});
    assert.equal(replies.find(r=>r.id===5).result.structuredContent.data.project.captions.length,5);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
