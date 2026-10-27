import { inputSchema } from './mcp-input-schema.mjs';
import { outputSchema } from './mcp-output-schema.mjs';
import { commandDefinitions } from '../core/commands.mjs';
import { CommandError, assertJson, validate } from '../core/validation.mjs';
import { errorResult } from './editor-service.mjs';

// Tool mapping only. The host supplies transport, discovery, authentication and storage.
// A project ID is a selector, never authorization. Resolve it per authenticated call.
export function createMcpToolAdapter({ resolveService, commands }) {
  if (typeof resolveService !== 'function') throw new TypeError('An authorized project resolver is required.');
  const definitions = commandDefinitions();
  if (commands !== undefined && (!Array.isArray(commands) || !commands.length ||
      new Set(commands).size !== commands.length ||
      Array.from(commands).some(name => typeof name !== 'string' || !definitions.some(command => command.name === name)))) {
    throw new TypeError('Tool selection must contain distinct existing command names.');
  }
  // Copy the selection into a fixed map in canonical catalog order.
  const selected = commands === undefined ? definitions : definitions.filter(command => commands.includes(command.name));
  const names = new Map(selected.map(command => [
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
