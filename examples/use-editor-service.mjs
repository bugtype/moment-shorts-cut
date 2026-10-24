// Local example only. No HTTP server, remote connection or media job is started.
import assert from 'node:assert/strict';
import { createDemoProject } from '../dist/core/project.mjs';
import { createEditorService } from '../dist/integration/editor-service.mjs';
import { createMcpToolAdapter } from '../dist/integration/mcp-adapter.mjs';
let project=createDemoProject();
const service=createEditorService({getProject:()=>project,commitProject:next=>{project=next;}});
await service.execute('template.apply',{templateId:'explainer',withContent:true});
// Inspect configuration first, then page through cues without fetching the whole project.
const beforeRead=JSON.stringify(project);
const summary=await service.execute('project.summary');
assert.equal(summary.ok,true);
assert.equal(summary.data.ratio,project.ratio);
assert.equal(summary.data.captionCount,project.captions.length);
assert.deepEqual(summary.data.media,{requiresVideo:false,requiresAudio:false});
const page=await service.execute('captions.list',{offset:0,limit:2});
assert.equal(page.ok,true);
assert.deepEqual(page.data.captions.map(item=>item.caption),project.captions.slice(0,2));
assert.equal(JSON.stringify(project),beforeRead);
const adapter=createMcpToolAdapter({
  // Replace this local demo check with the host's per-project authorization.
  resolveService:(projectId,context)=>projectId==='demo-project'&&context?.userId==='demo-owner'?service:null,
});
const result=await adapter.callTool('moment_render_plan',{projectId:'demo-project',quality:720,format:'webm'},{userId:'demo-owner'});
console.log(JSON.stringify({ok:!result.isError,captionRows:page.data.captions.length,output:result.structuredContent.data.output,rendered:result.structuredContent.data.rendered},null,2));
