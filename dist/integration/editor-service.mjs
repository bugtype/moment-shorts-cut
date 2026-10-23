import { API_VERSION, commandDefinitions, prepareCommand } from '../core/commands.mjs';
import { createProjectDocument } from '../core/project.mjs';
import { assertJson, validate, object, string, choice, fail, CommandError } from '../core/validation.mjs';

const jobIdSchema=string(200);
const jobResultSchema={...object({id:jobIdSchema,status:choice('queued','running','succeeded','failed','cancelled')},['id','status']),additionalProperties:true};
const jobCommands=[
  {name:'jobs.submit',description:'연결된 작업 제공자에 미디어 가져오기·음성 인식·렌더 작업을 제출합니다.',inputSchema:object({operation:choice('media.import','captions.transcribe','video.render'),assetId:string(200),source:choice('video','audio'),language:string(20),quality:choice(720,1080),format:choice('mp4','webm')},['operation']),mutates:true},
  {name:'jobs.get',description:'연결된 작업 제공자의 작업 상태를 읽습니다.',inputSchema:object({jobId:jobIdSchema},['jobId']),mutates:false},
  {name:'jobs.cancel',description:'연결된 작업 제공자에 작업 취소를 요청합니다.',inputSchema:object({jobId:jobIdSchema},['jobId']),mutates:true},
];
export function errorResult(command,error){
  const known=error instanceof CommandError;
  return {ok:false,apiVersion:API_VERSION,command,error:{code:known?error.code:'INTERNAL_ERROR',message:known?error.message:'작업을 완료하지 못했습니다.',...(known&&error.path?{path:error.path}:{})}};
}
/**
 * Storage, UI and media runtimes are injected. No DOM, fetch, file I/O or credentials.
 * commitProject must atomically persist/replace the supplied project or throw.
 * Async stores with external writers must check previous atomically at commit;
 * this instance's queue does not coordinate other writers or retry conflicts.
 * execute's optional beforeCommit hook must synchronously check, without editing,
 * and throw to reject a project mutation. It does not guard provider jobs.
 * A job provider must implement submit/get/cancel and return JSON job records.
 * Submission is not completion: providers own asset access, progress and artifacts.
 */
export function createEditorService({getProject,commitProject,jobs}={}){
  if(typeof getProject!=='function'||typeof commitProject!=='function')throw new TypeError('Project storage callbacks are required.');
  if(jobs&&!['submit','get','cancel'].every(k=>typeof jobs[k]==='function'))throw new TypeError('A job provider must implement submit, get and cancel.');
  let queue=Promise.resolve();
  const describe=()=>[...commandDefinitions(),...(jobs?structuredClone(jobCommands):[])];
  async function run(name,args,beforeCommit){
    try{
      if(typeof name!=='string')throw new CommandError('INVALID_ARGUMENT','명령 이름이 필요합니다.');
      let data;
      const jobCommand=jobCommands.find(c=>c.name===name);
      if(jobCommand){
        assertJson(args);validate(jobCommand.inputSchema,args);
        if(!jobs)throw new CommandError('NOT_CONFIGURED','미디어 작업 제공자가 아직 연결되지 않았습니다.');
        if(name==='jobs.submit'){
          if(args.operation==='media.import'&&!args.assetId?.trim())throw new CommandError('INVALID_ARGUMENT','등록된 assetId가 필요합니다.');
          data=await jobs.submit({request:structuredClone(args),document:createProjectDocument(await getProject())});
        }else{
          if(!args.jobId.trim())throw new CommandError('INVALID_ARGUMENT','jobId가 필요합니다.');
          data=await jobs[name==='jobs.get'?'get':'cancel'](args.jobId);
        }
        try{
          assertJson(data);validate(jobResultSchema,data);
          if(!data.id.trim())fail('작업 ID가 비어 있습니다.');
        }catch{
          throw new CommandError('INVALID_PROVIDER_RESULT','작업 제공자가 유효한 작업 상태를 반환하지 않았습니다.');
        }
      }else{
        // Keep synchronous snapshots and local commits in one uninterrupted job.
        // Read then once: custom thenable accessors can throw or have side effects.
        const value=getProject(),then=value?.then;
        const before=typeof then==='function'?await {then:(resolve,reject)=>then.call(value,resolve,reject)}:value;
        const prepared=prepareCommand(before,name,args);
        if(prepared.project){
          const checked=beforeCommit?.();
          if(typeof checked?.then==='function'){
            Promise.resolve(checked).catch(()=>{});
            throw new CommandError('INVALID_ARGUMENT','커밋 전 검사는 동기 함수여야 합니다.');
          }
          await commitProject(prepared.project,{command:name,previous:before});
        }
        data=prepared.data;
      }
      return {ok:true,apiVersion:API_VERSION,command:name,data:structuredClone(data)};
    }catch(error){return errorResult(typeof name==='string'?name:'',error);}
  }
  return Object.freeze({
    apiVersion:API_VERSION,
    describe,
    capabilities:()=>({apiVersion:API_VERSION,commands:describe().map(c=>c.name),mediaJobs:!!jobs}),
    execute(name,args={},beforeCommit){
      // Capture caller arguments now; edits made after submission cannot change it.
      let input;try{if(beforeCommit!==undefined&&typeof beforeCommit!=='function')throw new CommandError('INVALID_ARGUMENT','커밋 전 검사 함수가 필요합니다.');assertJson(args);input=structuredClone(args);}catch(error){return Promise.resolve(errorResult(name,error));}
      const result=queue.then(()=>run(name,input,beforeCommit));queue=result.then(()=>undefined,()=>undefined);return result;
    },
  });
}
