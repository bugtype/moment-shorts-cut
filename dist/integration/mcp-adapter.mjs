import { API_VERSION, commandDefinitions } from '../core/commands.mjs';
import { FORMAT, FORMAT_VERSION } from '../core/project.mjs';
import { CommandError, assertJson, validate } from '../core/validation.mjs';
import { errorResult } from './editor-service.mjs';

const text = { type: 'string' };
const record = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const documentSchema = record({
  format: { enum: [FORMAT] },
  formatVersion: { enum: [FORMAT_VERSION] },
  project: { type: 'object', description: 'Complete project state; retain fields not involved in the requested edit.' },
});
const mediaReference = {
  type: ['object', 'null'],
  properties: { name: text, required: { enum: [true] } },
  required: ['name', 'required'],
  additionalProperties: false,
};

function dataSchema(command) {
  switch (command) {
    case 'project.get': return documentSchema;
    case 'project.import': return record({ imported: { enum: [true] } });
    case 'templates.list': return {
      type: 'array', items: record({ id: text, name: text, category: text, description: text }),
    };
    case 'captions.export': return record({ format: { enum: ['srt', 'vtt'] }, text: {
      type: 'string', description: 'SRT or plain WebVTT in final output seconds after clips and speed; save this string, not the result envelope.',
    } });
    case 'render.plan': return record({
      planVersion: { enum: [1] }, project: documentSchema,
      output: record({
        width: { type: 'number', minimum: 1 }, height: { type: 'number', minimum: 1 },
        fps: { enum: [30] }, format: { enum: ['mp4', 'webm'] }, duration: { type: 'number', minimum: 0 },
      }),
      media: record({ video: mediaReference, audio: mediaReference }),
      rendered: { enum: [false], description: 'A plan is metadata, not an encoded video or downloadable artifact.' },
    });
    default: return record({ updated: { enum: [true] }, outputDuration: {
      type: 'number', minimum: 0, description: 'Total edited duration in output seconds, after speed.',
    } });
  }
}

function outputSchema(command) {
  const common = { apiVersion: { enum: [API_VERSION] }, command: { enum: [command] } };
  return {
    type: 'object',
    description: 'The structuredContent envelope. Check ok before reading data; validation failures do not apply edits.',
    oneOf: [
      record({ ok: { enum: [true] }, ...common, data: dataSchema(command) }),
      record({ ok: { enum: [false] }, ...common, error: record({
        code: text, message: text, path: { type: 'string', description: 'Optional invalid input field path.' },
      }, ['code', 'message']) }),
    ],
  };
}

function inputSchema(command) {
  const schema = structuredClone(command.inputSchema);
  schema.properties = {
    projectId: {
      type: 'string', minLength: 1, maxLength: 200,
      description: 'Project selector, not a path or credential. The bundled stdio server accepts only "session".',
    },
    ...schema.properties,
  };
  schema.required = ['projectId', ...schema.required];
  const p = schema.properties;
  if (p.document) p.document.description = 'Complete moment-project document from project.get/browser settings export, not a partial patch. Media bytes are not included.';
  if (p.templateId) p.templateId.description = 'An ID from templates.list; browser-local custom templates are not available here.';
  if (p.withContent) p.withContent.description = 'Default false preserves authored content. True replaces title, credit and timed card content with template examples.';
  if (p.clips) {
    p.clips.description = 'Replace the entire ordered clip list. Times are source seconds; repeats are allowed. Each end must exceed start and stay within source duration.';
    p.clips.items.properties.start.description = 'Clip start in source seconds, not output seconds.';
    p.clips.items.properties.end.description = 'Clip end in source seconds, exclusive.';
  }
  if (p.captions) {
    p.captions.description = 'Replace the entire caption list; [] clears it. Each interval must fit its time basis.';
    p.captions.items.properties.basis.description = 'Default source: original media seconds. timeline: edited timeline seconds BEFORE speed. SRT/VTT export converts to output seconds.';
    p.captions.items.properties.text.description = 'Authored caption text, at most 2,000 UTF-16 code units in runtime validation; do not silently truncate.';
    p.captions.items.properties.start.description = 'Start in the selected basis, not final output seconds.';
    p.captions.items.properties.end.description = 'End in the selected basis; must exceed start.';
  }
  if (command.name === 'title.update') {
    p.patch.description = 'Partial base-title update, not timed scene cards. A visible scene card can hide this base title.';
    p.patch.properties.lines.description = 'Exactly two authored title lines; use an empty string for an unused line.';
    p.patch.properties.start.description = 'Start in final output seconds, AFTER speed.';
    p.patch.properties.end.description = 'End in final output seconds; null follows the full output duration.';
  }
  if (command.name === 'project.update') {
    p.patch.description = 'Only supplied settings change. Changing ratio resets zoom/pan; speed changes retime output text.';
    p.patch.properties.speed.description = 'Playback speed multiplier; output duration is edited timeline duration divided by speed.';
  }
  if (p.quality) p.quality.description = 'Output short edge in pixels; defaults to 1080. Creates a plan only.';
  if (p.format) p.format.description = command.name === 'captions.export'
    ? 'Subtitle format: srt (default) or plain vtt. The destination filename does not select the format.'
    : 'Planned output container; defaults to mp4, without checking local codec support.';
  return schema;
}

// Tool mapping only. The host supplies transport, discovery, authentication and storage.
// A project ID is a selector, never authorization. Resolve it per authenticated call.
export function createMcpToolAdapter({ resolveService }) {
  if (typeof resolveService !== 'function') throw new TypeError('An authorized project resolver is required.');
  const names = new Map(commandDefinitions().map(command => [
    `moment_${command.name.replaceAll('.', '_')}`, command,
  ]));

  function listTools() {
    return structuredClone({
      resultType: 'complete',
      tools: [...names].map(([name, command]) => ({
        name, description: command.description,
        inputSchema: inputSchema(command), outputSchema: outputSchema(command.name),
        annotations: { readOnlyHint: !command.mutates, destructiveHint: command.mutates, openWorldHint: false },
      })),
    });
  }

  async function callTool(name, args, context) {
    const command = names.get(name);
    // Host must translate this into a JSON-RPC invalid-params protocol error.
    if (!command) throw new CommandError('UNKNOWN_TOOL', '지원하지 않는 MCP 도구입니다.');
    let result;
    try {
      if (!args || typeof args.projectId !== 'string' || !args.projectId.trim() || args.projectId.length > 200) {
        throw new CommandError('INVALID_ARGUMENT', 'projectId가 필요합니다.');
      }
      assertJson(args);
      // Capture nested input before the resolver yields to authentication/storage.
      const { projectId, ...input } = structuredClone(args);
      validate(command.inputSchema, input);
      const service = await resolveService(projectId, context);
      if (!service) throw new CommandError('NOT_FOUND', '접근 가능한 프로젝트를 찾을 수 없습니다.');
      result = await service.execute(command.name, input);
    } catch (error) {
      result = errorResult(command.name, error);
    }
    return {
      resultType: 'complete', content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result, isError: !result.ok,
    };
  }
  return { listTools, callTool };
}
