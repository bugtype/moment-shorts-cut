// Synthetic, in-memory recipe: no media, files, network or translation service.
import assert from 'node:assert/strict';
import { createDemoProject } from '../dist/core/project.mjs';
import { createEditorService } from '../dist/integration/editor-service.mjs';

let project = createDemoProject();
project.clips = [{start: 0, end: 2}];
project.captions = [
  {start: 0, end: 1, text: 'Draft opening', speaker: '0', keywords: 'opening'},
  {start: 5, end: 6, text: 'Draft retained cue', basis: 'timeline', speaker: '1', keywords: 'retained', timing: 'estimated'},
];
let commits = 0;
const service = createEditorService({
  getProject: () => project,
  commitProject: next => { project = next; commits++; },
});
const before = structuredClone(project);
const page = await service.execute('captions.list', {offset: 0, limit: 20});
assert.equal(page.ok, true);
assert.deepEqual(page.data.captions.map(row => row.caption), before.captions);

// Stand-ins for caller-reviewed corrections to the inspected authored rows.
// Re-read indices after structural edits; these are not output occurrences.
const corrections = [
  {captionIndex: 0, text: 'Reviewed opening'},
  {captionIndex: 1, text: 'Reviewed retained cue'},
];
assert.ok(corrections.length >= 1 && corrections.length <= 20);
assert.equal(new Set(corrections.map(row => row.captionIndex)).size, corrections.length);
const operations = corrections.map(({captionIndex, text}) => ({
  command: 'captions.update', arguments: {captionIndex, patch: {text}},
}));
const preview = await service.execute('project.preview', {operations});
assert.equal(preview.ok, true);
assert.deepEqual(project, before);
assert.equal(commits, 0);

// Preview is not a reservation. This isolated example has no competing writer;
// a real host must enforce its concurrency policy. Do not automatically chunk
// larger corrections and claim they form one atomic edit: each batch is separate.
const result = await service.execute('project.batch', {operations});
assert.equal(result.ok, true);
const expected = structuredClone(before);
for (const {captionIndex, text} of corrections) expected.captions[captionIndex].text = text;
assert.deepEqual(project, expected, 'only the requested text fields may change');
assert.equal(commits, 1);
const changedCaptions = project.captions.filter((cue, index) => cue.text !== before.captions[index].text).length;
console.log(JSON.stringify({ok: true, changedCaptions, rendered: false, filesWritten: false}));
