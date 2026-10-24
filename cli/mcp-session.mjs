import { createDemoProject } from '../dist/core/project.mjs';
import { createEditorService } from '../dist/integration/editor-service.mjs';
import { createMcpToolAdapter } from '../dist/integration/mcp-adapter.mjs';

export const MCP_PROTOCOL_VERSION = '2025-11-25';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (id, code, message) => ({jsonrpc: '2.0', id, error: {code, message}});

// Lifecycle and project state belong to one connection, independently of its byte transport.
export function createMcpSession() {
  let state = createDemoProject();
  let phase = 'new';
  const service = createEditorService({
    getProject: () => state,
    commitProject: next => { state = next; },
  });
  // The launched process owns exactly one ephemeral project, not a file or browser session.
  const adapter = createMcpToolAdapter({
    resolveService: projectId => projectId === 'session' ? service : null,
  });

  async function dispatch(message) {
    if (!object(message) || message.jsonrpc !== '2.0' ||
        typeof message.method !== 'string' ||
        (Object.hasOwn(message, 'id') && typeof message.id !== 'string' &&
          !(typeof message.id === 'number' && Number.isSafeInteger(message.id)))) {
      return failure(null, -32600, 'Invalid request');
    }
    const {id, method, params} = message;
    if (!Object.hasOwn(message, 'id')) {
      // Tool calls without IDs are notifications: they must never mutate state.
      if (method === 'notifications/initialized' && phase === 'initializing') phase = 'ready';
      return null;
    }
    if (params !== undefined && !object(params)) return failure(id, -32602, 'Invalid params');
    let result;
    if (method === 'ping') {
      result = {};
    } else if (method === 'initialize') {
      if (phase !== 'new' || typeof params?.protocolVersion !== 'string' ||
          !object(params.capabilities) || !object(params.clientInfo) ||
          typeof params.clientInfo.name !== 'string' || typeof params.clientInfo.version !== 'string') {
        return failure(id, -32602, 'Invalid initialization');
      }
      phase = 'initializing';
      result = {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {tools: {}},
        serverInfo: {name: 'moment-shorts-studio', version: '1.0.0'},
        instructions: 'Use projectId "session". Changes exist only in this process. Import an editing document with moment_project_import; retrieve moment_project_get before disconnecting to save it through your client. No media upload or video rendering is available.',
      };
    } else if (phase !== 'ready') {
      return failure(id, -32600, 'Initialize the session first');
    } else if (method === 'tools/list') {
      if (params?.cursor !== undefined) return failure(id, -32602, 'Pagination is not supported');
      result = {tools: adapter.listTools().tools};
    } else if (method === 'tools/call') {
      if (typeof params?.name !== 'string' || (params.arguments !== undefined && !object(params.arguments))) {
        return failure(id, -32602, 'Invalid tool call');
      }
      try {
        const {resultType, ...toolResult} = await adapter.callTool(params.name, params.arguments ?? {});
        result = toolResult;
      } catch (error) {
        if (error.code === 'UNKNOWN_TOOL') return failure(id, -32602, 'Unknown tool');
        throw error;
      }
    } else {
      return failure(id, -32601, 'Method not found');
    }
    return {jsonrpc: '2.0', id, result};
  }
  return { dispatch };
}
