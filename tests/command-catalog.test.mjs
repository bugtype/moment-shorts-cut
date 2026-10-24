import test from 'node:test';
import assert from 'node:assert/strict';
import * as catalog from '../dist/core/command-catalog.mjs';
import * as commands from '../dist/core/commands.mjs';
import { createDemoProject } from '../dist/core/project.mjs';
import { setLocale, formatError } from '../dist/i18n.mjs';

test('existing command facade reexports the catalog without changing its public contract', () => {
  assert.deepEqual(Object.keys(commands).sort(), ['API_VERSION', 'commandDefinition', 'commandDefinitions', 'prepareCommand'].sort());
  assert.equal(commands.API_VERSION, 1);
  assert.equal(commands.commandDefinition, catalog.commandDefinition);
  assert.equal(commands.commandDefinitions, catalog.commandDefinitions);
  const definitions = commands.commandDefinitions();
  assert.equal(definitions.length, 40);
  assert.equal(definitions[0].name, 'project.get');
  assert.deepEqual(definitions.slice(-2).map(item => item.name), ['project.batch', 'project.preview']);
  assert.deepEqual(definitions.map(item => Object.keys(item)), definitions.map(() => ['name', 'description', 'inputSchema', 'mutates']));
});

test('returned catalog schemas are detached and cannot extend the runtime batch trust boundary', () => {
  const all = catalog.commandDefinitions();
  const original = catalog.commandDefinitions();
  all.find(item => item.name === 'project.update').inputSchema.properties.patch.properties.ratio.enum.push('arbitrary');
  all.reverse();
  assert.deepEqual(catalog.commandDefinitions(), original);
  const batch = catalog.commandDefinition('project.batch');
  const names = batch.inputSchema.properties.operations.items.properties.command.enum;
  assert.equal(names.length, 26);
  for (const name of names) assert.equal(catalog.isBatchCommand(name), true);
  names.push('project.import');
  for (const name of ['project.import', 'project.get', 'project.summary', 'project.preview', 'project.batch', 'jobs.submit', 'unknown']) {
    assert.equal(catalog.isBatchCommand(name), false);
  }
  assert.throws(() => commands.prepareCommand(createDemoProject(), 'project.batch', {
    operations: [{ command: 'project.import', arguments: {} }],
  }), { code: 'INVALID_ARGUMENT' });
  assert.deepEqual(catalog.commandDefinition('project.preview').inputSchema, catalog.commandDefinition('project.batch').inputSchema);
});

test('unknown-command diagnostics retain lazy localization and metadata', () => {
  const messages = new Set();
  try {
    for (const locale of ['ko', 'en', 'zh-CN']) {
      setLocale(locale, { persist: false });
      assert.throws(() => catalog.commandDefinition('unknown'), error => {
        assert.equal(error.code, 'UNKNOWN_COMMAND');
        assert.equal(error.messageKey, 'errors.unknownCommand');
        messages.add(formatError(error));
        return true;
      });
    }
    assert.equal(messages.size, 3);
  } finally {
    setLocale('ko', { persist: false });
  }
});
