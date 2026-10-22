// Local example only. No HTTP server, remote connection or media job is started.
import { createDemoProject } from '../dist/core/project.mjs';
import { createEditorService } from '../dist/integration/editor-service.mjs';
import { createMcpToolAdapter } from '../dist/integration/mcp-adapter.mjs';
let project=createDemoProject();
const service=createEditorService({getProject:()=>project,commitProject:next=>{project=next;}});
await service.execute('template.apply',{templateId:'explainer',withContent:true});
const adapter=createMcpToolAdapter({
  // Replace this local demo check with the host's per-project authorization.
  resolveService:(projectId,context)=>projectId==='demo-project'&&context?.userId==='demo-owner'?service:null,
});
const result=await adapter.callTool('moment_render_plan',{projectId:'demo-project',quality:720,format:'webm'},{userId:'demo-owner'});
console.log(JSON.stringify({ok:!result.isError,output:result.structuredContent.data.output,rendered:result.structuredContent.data.rendered},null,2));
