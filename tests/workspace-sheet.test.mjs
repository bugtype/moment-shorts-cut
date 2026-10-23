import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspacePanels } from '../dist/workspace-panels.mjs';

function createSheetApp() {
  const classes = new Set();
  const library = { hidden: false, style: { removeProperty(name) { if (name === 'max-height') delete this.maxHeight; } } };
  const canvas = { getBoundingClientRect: () => ({ top: 76, bottom: 400 }) };
  const railRect = { getBoundingClientRect: () => ({ top: 786 }) };
  const close = { focused: 0, focus() { this.focused++; } };
  const rail = [
    { dataset: { panel: 'templates' }, expanded: '', focus() {}, setAttribute(name, value) { if (name === 'aria-expanded') this.expanded = value; } },
    { dataset: { panel: 'captions' }, expanded: '', focus() {}, setAttribute(name, value) { if (name === 'aria-expanded') this.expanded = value; } },
  ];
  let compact = true, short = false;
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
    window: { matchMedia: query => ({ matches: String(query).includes('max-height:720px') ? short : compact }) },
    query: selector => selector === '#libraryPanel' ? library : selector === '#panelClose' ? close
      : selector === '#canvasWrap' ? canvas : selector === '.rail' ? railRect : null,
    queryAll: () => rail,
  };
  return {
    panels: createWorkspacePanels(app),
    library, close, rail, classes,
    setCompact: value => { compact = value; },
    setShort: value => { short = value; },
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

test('the open sheet fills the room between the preview and the rail', () => {
  const { panels, library, setShort } = createSheetApp();
  panels.togglePanelSheet();
  assert.equal(library.style.maxHeight, '378px');

  // Short phones hand the sheet the whole editor instead of a partial height.
  setShort(true);
  panels.syncPanelSheet();
  assert.equal(library.style.maxHeight, undefined);
});
