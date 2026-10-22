import { commandDefinitions } from '../core/commands.mjs';
import { CommandError, assertJson, validate } from '../core/validation.mjs';
import { errorResult } from './editor-service.mjs';

// Tool mapping only. The host supplies transport, discovery, authentication and storage.
// A project ID is a selector, never authorization. Resolve it per authenticated call.
export function createMcpToolAdapter({resolveService}){
  if(typeof resolveService!=='function')throw new TypeError('An authorized project resolver is required.');
  const definitions=commandDefinitions();
  const names=new Map(definitions.map(c=>[`moment_${c.name.replaceAll('.','_')}`,c]));
  return {
    listTools(){return {resultType:'complete',tools:[...names].map(([name,c])=>({name,description:c.description,inputSchema:{...c.inputSchema,properties:{projectId:{type:'string',minLength:1,maxLength:200},...c.inputSchema.properties},required:['projectId',...c.inputSchema.required]},annotations:{readOnlyHint:!c.mutates,destructiveHint:c.mutates,openWorldHint:false}}))};},
    async callTool(name,args,context){
      const command=names.get(name);
      // Host must translate this into a JSON-RPC invalid-params protocol error.
      if(!command)throw new CommandError('UNKNOWN_TOOL','지원하지 않는 MCP 도구입니다.');
      let result;
      try{
        if(!args||typeof args.projectId!=='string'||!args.projectId.trim()||args.projectId.length>200)throw new CommandError('INVALID_ARGUMENT','projectId가 필요합니다.');
        assertJson(args);
        // Capture nested input before the resolver yields to authentication/storage.
        const {projectId,...input}=structuredClone(args);
        validate(command.inputSchema,input);
        const service=await resolveService(projectId,context);
        if(!service)throw new CommandError('NOT_FOUND','접근 가능한 프로젝트를 찾을 수 없습니다.');
        result=await service.execute(command.name,input);
      }catch(error){result=errorResult(command.name,error);}
      return {resultType:'complete',content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,isError:!result.ok};
    },
  };
}
