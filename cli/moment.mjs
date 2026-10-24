#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { createDemoProject, createProjectDocument, readProjectDocument } from '../dist/core/project.mjs';
import { createEditorService, errorResult } from '../dist/integration/editor-service.mjs';
import { CommandError } from '../dist/core/validation.mjs';

const usage=`Moment CLI · Node.js 20+
  node cli/moment.mjs commands
  node cli/moment.mjs init --out project.json [--overwrite]
  node cli/moment.mjs exec <command> --project project.json [--json '{}'] [--args-file args.json] [--out result.json] [--overwrite] [--dry-run]

명령과 입력 규격: commands
수정 명령에는 --out이 필요합니다. 기존 파일 교체는 --overwrite로 지정하세요.
captions.export는 format(srt/vtt/txt)에 따라 SRT·WebVTT·TXT를 --out으로 저장합니다. 기본값은 SRT입니다.
영상/음성 파일과 인코더는 포함하지 않습니다.
`;
const MAX_JSON_FILE_BYTES=10*1024*1024;
function parse(argv){
  const [mode,...tail]=argv,opts={},command=mode==='exec'?tail.shift():undefined;
  const allowed=mode==='exec'?['--project','--json','--args-file','--out','--overwrite','--dry-run']:mode==='init'?['--out','--overwrite']:[];
  for(let i=0;i<tail.length;i++){
    const key=tail[i];if(!allowed.includes(key)||Object.hasOwn(opts,key))throw new CommandError('CLI_USAGE','이 명령에서 지원하지 않거나 중복된 옵션입니다.');
    if(['--overwrite','--dry-run'].includes(key))opts[key]=true;
    else {if(!tail[i+1]||tail[i+1].startsWith('--'))throw new CommandError('CLI_USAGE','옵션 값이 없습니다.');opts[key]=tail[++i];}
  }
  if(opts['--json']&&opts['--args-file'])throw new CommandError('CLI_USAGE','--json과 --args-file 중 하나만 지정하세요.');
  return {mode,command,opts};
}
async function jsonFile(file){
  const info=await fs.stat(file);if(info.size>MAX_JSON_FILE_BYTES)throw new CommandError('FILE_TOO_LARGE','JSON 파일은 10 MB 이하만 지원합니다.');
  const bytes=await fs.readFile(file);
  if(bytes.length>MAX_JSON_FILE_BYTES)throw new CommandError('FILE_TOO_LARGE','JSON 파일은 10 MB 이하만 지원합니다.');
  if(!isUtf8(bytes))throw new CommandError('INVALID_JSON','JSON 파일을 올바른 UTF-8로 저장하세요.');
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
}
async function writeOutput(file,text,overwrite){
  const absolute=path.resolve(file),temporary=path.join(path.dirname(absolute),`.moment-${randomUUID()}.tmp`);
  try{
    await fs.writeFile(temporary,text,{flag:'wx',mode:0o600});
    if(overwrite)await fs.rename(temporary,absolute);
    else {await fs.link(temporary,absolute);await fs.unlink(temporary);}
  }finally{await fs.unlink(temporary).catch(()=>{});}
  return absolute;
}
async function main(){
  const {mode,command,opts}=parse(process.argv.slice(2));
  if(!mode||['help','--help','-h'].includes(mode)){process.stdout.write(usage);return;}
  let state=createDemoProject();
  const service=createEditorService({getProject:()=>state,commitProject:next=>{state=next;}});
  if(mode==='commands'){process.stdout.write(JSON.stringify({apiVersion:1,commands:service.describe()},null,2)+'\n');return;}
  if(mode==='init'){
    if(!opts['--out'])throw new CommandError('CLI_USAGE','--out 경로를 지정하세요.');
    const output=await writeOutput(opts['--out'],JSON.stringify(createProjectDocument(state),null,2)+'\n',opts['--overwrite']);
    process.stdout.write(JSON.stringify({ok:true,output})+'\n');return;
  }
  if(mode!=='exec'||!command)throw new CommandError('CLI_USAGE','exec 뒤에 명령 이름을 지정하세요.');
  const descriptor=service.describe().find(c=>c.name===command);
  if(!descriptor)throw new CommandError('UNKNOWN_COMMAND','사용 가능한 명령은 commands로 확인하세요.');
  if(command!=='templates.list'&&!opts['--project'])throw new CommandError('CLI_USAGE','--project 파일을 지정하세요.');
  if(descriptor.mutates&&!opts['--out']&&!opts['--dry-run'])throw new CommandError('CLI_USAGE','수정 결과를 저장할 --out 경로를 지정하세요.');
  if(opts['--project'])state=readProjectDocument(await jsonFile(opts['--project']));
  const args=opts['--args-file']?await jsonFile(opts['--args-file']):JSON.parse(opts['--json']||'{}');
  const result=await service.execute(command,args);
  if(!result.ok){process.stderr.write(JSON.stringify(result)+'\n');process.exitCode=1;return;}
  if(opts['--dry-run'])result.preview=descriptor.mutates?createProjectDocument(state):result.data;
  else if(opts['--out']){
    const data=descriptor.mutates?createProjectDocument(state):result.data;
    const text=command==='captions.export'?data.text:JSON.stringify(data,null,2)+'\n';
    result.output=await writeOutput(opts['--out'],text,opts['--overwrite']);
  }
  process.stdout.write(JSON.stringify(result)+'\n');
}
try{await main();}catch(error){
  const mapped=error instanceof CommandError?error:new CommandError(error instanceof SyntaxError?'INVALID_JSON':error.code==='EEXIST'?'FILE_EXISTS':'FILE_ERROR',error instanceof SyntaxError?'JSON 문법을 확인하세요.':error.code==='EEXIST'?'출력 파일이 있습니다. 다른 경로 또는 --overwrite를 사용하세요.':'파일 경로와 읽기/쓰기 권한을 확인하세요.');
  process.stderr.write(JSON.stringify(errorResult('cli',mapped))+'\n');process.exitCode=1;
}
