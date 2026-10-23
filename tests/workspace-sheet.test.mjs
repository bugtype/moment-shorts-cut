import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspacePanels } from '../dist/workspace-panels.mjs';

function createSheetApp() {
  const classes = new Set();
  const library = { hidden: false };
  const close = { focused: 0, focus() { this.focused++; } };
  const rail = [
    { dataset: { panel: 'templates' }, expanded: '', focus() {}, setAttribute(name, value) { if (name === 'aria-expanded') this.expanded = value; } },
    { dataset: { panel: 'captions' }, expanded: '', focus() {}, setAttribute(name, value) { if (name === 'aria-expanded') this.expanded = value; } },
  ];
  let compact = true;
  const app = {
    panel: 'templates',
    document: {
      body: {
        classList: {
          add: name => classes.add(name),
          remove: name => classes.delete(name),
          toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
        },
      },
    },
    window: { matchMedia: () => ({ matches: compact }) },
    query: selector => selector === '#libraryPanel' ? library : selector === '#panelClose' ? close : null,
    queryAll: () => rail,
  };
  return {
    panels: createWorkspacePanels(app),
    library, close, rail, classes,
    setCompact: value => { compact = value; },
  };
}

test('compact panel sheet opens, closes and yields to the desktop dock', () => {
  const { panels, library, close, rail, classes, setCompact } = createSheetApp();

  panels.syncPanelSheet();
  assert.equal(library.hidden, true, 'the compact panel starts closed');
  assert.equal(classes.has('panel-sheet-open'), false);
  assert.deepEqual(rail.map(button => button.expanded), ['false', 'false']);

  panels.togglePanelSheet();
  assert.equal(library.hidden, false);
  assert.equal(classes.has('panel-sheet-open'), true);
  assert.equal(close.focused, 1, 'opening moves focus to the close control');
  assert.deepEqual(rail.map(button => button.expanded), ['true', 'false']);

  panels.closePanelSheet();
  assert.equal(library.hidden, true);
  assert.equal(classes.has('panel-sheet-open'), false);

  panels.togglePanelSheet();
  assert.equal(library.hidden, false);

  setCompact(false);
  panels.syncPanelSheet();
  assert.equal(library.hidden, false, 'the dock is always visible on desktop');
  assert.equal(classes.has('panel-sheet-open'), false);
  assert.deepEqual(rail.map(button => button.expanded), ['true', 'false']);

  panels.togglePanelSheet();
  assert.equal(library.hidden, false, 'desktop has no toggleable sheet');
});
