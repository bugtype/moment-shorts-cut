import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBenchmarkMatrix, writeBenchmarkMatrix } from '../qa/export-matrix.mjs';
import { readProjectDocument } from '../dist/core/project.mjs';
import { prepareCommand } from '../dist/core/commands.mjs';

test('A–E cases use valid documents and unchanged metadata-only plans', () => {
  const { documents, manifest } = createBenchmarkMatrix();
  assert.equal(Object.keys(documents).length, 12);
  assert.equal(manifest.runs.length, 16);
  assert.equal(manifest.requiresSuccessfulBrowserSmoke, true);
  for (const run of manifest.runs) {
    const project = readProjectDocument(documents[run.project]);
    const { data } = prepareCommand(project, 'render.plan', { quality: run.quality, format: 'mp4' });
    assert.deepEqual(run.output, data.output);
    assert.deepEqual(run.media, data.media);
    assert.equal(run.rendered, false);
    assert.equal(run.status, 'unmeasured');
  }
  assert.deepEqual(manifest.runs.slice(0, 3).map(run => run.output.duration), [12, 30, 60]);
  assert.deepEqual(manifest.runs.filter(run => run.id.startsWith('E-')).map(run => run.output.duration), [64, 32, 16, 8, 4]);
  const d = manifest.runs.filter(run => run.id.startsWith('D-'));
  assert.equal(d.length, 8);
  assert.deepEqual(d.map(run => [run.output.width, run.output.height]), [
    [720, 1280], [1080, 1920], [720, 900], [1080, 1350],
    [720, 720], [1080, 1080], [1280, 720], [1920, 1080],
  ]);
});

test('matrix generation is deterministic and documents are independent snapshots', () => {
  const first = createBenchmarkMatrix(), second = createBenchmarkMatrix();
  assert.deepEqual(first, second);
  first.documents['B-multicut-30s.moment.json'].project.clips[0].start = 1;
  assert.equal(first.documents['D-9x16.moment.json'].project.clips[0].start, 0);
  assert.equal(second.documents['B-multicut-30s.moment.json'].project.clips[0].start, 0);
});

test('file preparation refuses existing output and preserves unrelated files', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'moment-export-matrix-'));
  const destination = join(parent, 'projects');
  try {
    assert.deepEqual(await writeBenchmarkMatrix(destination), { projectDocuments: 12, plannedRuns: 16, rendered: false });
    const report = JSON.parse(await readFile(join(destination, 'matrix.json'), 'utf8'));
    assert.equal(report.runs.length, 16);
    const marker = join(destination, 'keep.txt');
    await writeFile(marker, 'keep');
    await assert.rejects(writeBenchmarkMatrix(destination), { code: 'EEXIST' });
    assert.equal(await readFile(marker, 'utf8'), 'keep');
  } finally { await rm(parent, { recursive: true, force: true }); }
});
