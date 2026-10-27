import test from 'node:test';
import assert from 'node:assert/strict';
import { commandDefinitions } from '../dist/core/commands.mjs';
import { createMcpToolAdapter } from '../dist/integration/mcp-adapter.mjs';
import { inputSchema } from '../dist/integration/mcp-input-schema.mjs';

function objects(value, result = new Set()) {
  if (value && typeof value === 'object' && !result.has(value)) {
    result.add(value);
    for (const child of Object.values(value)) objects(child, result);
  }
  return result;
}

const adapter = () => createMcpToolAdapter({
  resolveService: () => assert.fail('schema discovery must not resolve a project'),
});

test('every discovered input schema adds the selector without sharing catalog or discovery objects', () => {
  const definitions = commandDefinitions(), original = structuredClone(definitions);
  const first = adapter().listTools(), second = adapter().listTools();
  assert.equal(first.resultType, 'complete');
  assert.equal(first.tools.length, definitions.length);
  assert.deepEqual(first, second);
  const originals = objects(definitions), prior = objects(first);
  for (const node of objects(second)) assert.equal(prior.has(node), false);
  first.tools.forEach((tool, index) => {
    const command = definitions[index], schema = tool.inputSchema;
    assert.equal(tool.name, `moment_${command.name.replaceAll('.', '_')}`);
    assert.deepEqual(Object.keys(schema.properties), ['projectId', ...Object.keys(command.inputSchema.properties)]);
    assert.deepEqual(schema.required, ['projectId', ...command.inputSchema.required]);
    assert.deepEqual(schema.properties.projectId, {
      type: 'string', minLength: 1, maxLength: 200,
      description: 'Project selector, not a path or credential. The bundled stdio server accepts only "session".',
    });
    for (const node of objects(schema)) assert.equal(originals.has(node), false);
  });
  assert.deepEqual(definitions, original);
  assert.deepEqual(commandDefinitions(), original);
});

test('input schema owner enriches frozen descriptors with the same detached discovery bytes', () => {
  const definitions = commandDefinitions(), original = structuredClone(definitions);
  for (const node of objects(definitions)) Object.freeze(node);
  const tools = adapter().listTools().tools;
  definitions.forEach((command, index) => {
    const first = inputSchema(command), second = inputSchema(command);
    assert.equal(JSON.stringify(first), JSON.stringify(tools[index].inputSchema));
    assert.deepEqual(first, second);
    const source = objects(command), prior = objects(first);
    for (const node of objects(second)) {
      assert.equal(source.has(node), false);
      assert.equal(prior.has(node), false);
    }
    first.required.push('consumer-only');
    first.properties.projectId.description = 'consumer-only';
    if (first.properties.captions) first.properties.captions.items.properties.basis.enum.push('output');
    assert.equal(JSON.stringify(inputSchema(command)), JSON.stringify(second));
    assert.equal(JSON.stringify(adapter().listTools().tools[index].inputSchema), JSON.stringify(second));
  });
  assert.deepEqual(definitions, original);
  assert.deepEqual(commandDefinitions(), original);
});
