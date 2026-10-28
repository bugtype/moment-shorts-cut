#!/usr/bin/env node
import { once } from 'node:events';
import { isUtf8 } from 'node:buffer';
import { createMcpSession } from './mcp-session.mjs';
import { commandDefinitions } from '../dist/core/commands.mjs';

const MAX_MESSAGE_BYTES = 10 * 1024 * 1024;
const failure = (id, code, message) => ({jsonrpc: '2.0', id, error: {code, message}});
function startupCommands(args) {
  if (!args.length) return undefined;
  if (args.length !== 2 || args[0] !== '--tools')
    throw new Error('Use --tools followed by comma-separated command names.');
  const commands = args[1].split(',');
  const known = new Set(commandDefinitions().map(command => command.name));
  if (!commands.length || new Set(commands).size !== commands.length ||
      commands.some(name => !known.has(name)))
    throw new Error('Tool names must be nonempty, distinct existing command names.');
  return commands;
}

async function send(message) {
  if (message && !process.stdout.write(JSON.stringify(message) + '\n')) await once(process.stdout, 'drain');
}

async function handle(bytes, dispatch) {
  let message;
  try {
    if (!isUtf8(bytes)) throw new Error('Invalid UTF-8');
    message = JSON.parse(bytes.toString('utf8'));
  } catch {
    await send(failure(null, -32700, 'Parse error'));
    return;
  }
  try {
    await send(await dispatch(message));
  } catch {
    await send(failure(message?.id ?? null, -32603, 'Internal error'));
  }
}

async function main() {
  const commands = startupCommands(process.argv.slice(2));
  const { dispatch } = createMcpSession({ commands });
  let pending = Buffer.alloc(0), pendingLength = 0;
  for await (const chunk of process.stdin) {
    let start = 0;
    for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, start)) {
      if (pendingLength + end - start > MAX_MESSAGE_BYTES) throw new Error('Message exceeds 10 MiB.');
      const line = Buffer.concat([pending.subarray(0, pendingLength), chunk.subarray(start, end)]);
      pending = Buffer.alloc(0);
      pendingLength = 0;
      await handle(line, dispatch);
      start = end + 1;
    }
    const required = pendingLength + chunk.length - start;
    if (required > MAX_MESSAGE_BYTES) throw new Error('Message exceeds 10 MiB.');
    // Grow only unfinished tails; avoid recopying their prefix on every fragment.
    if (required > pending.length) {
      const grown = Buffer.alloc(Math.min(MAX_MESSAGE_BYTES, Math.max(required, pending.length * 2)));
      pending.copy(grown, 0, 0, pendingLength);
      pending = grown;
    }
    if (chunk.length > start) chunk.copy(pending, pendingLength, start);
    pendingLength = required;
  }
  if (pendingLength) await handle(pending.subarray(0, pendingLength), dispatch);
}

try {
  await main();
} catch {
  process.stderr.write('Moment MCP stopped: invalid options, oversized input, or stream failure.\n');
  process.exitCode = 1;
}
