// Prepared projects and render plans only. No media is imported or rendered.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDemoProject, createProjectDocument, outputDuration } from '../dist/core/project.mjs';
import { prepareCommand } from '../dist/core/commands.mjs';
import { newCard } from '../dist/effects.mjs';

export function createBenchmarkMatrix() {
  const documents = {}, runs = [];
  function save(id, project, qualities = [720], expectedDuration = outputDuration(project)) {
    project.name = `Synthetic benchmark ${id}`;
    const filename = `${id}.moment.json`;
    documents[filename] = createProjectDocument(project);
    if (outputDuration(project) !== expectedDuration) throw new Error(`Unexpected duration for ${id}`);
    for (const quality of qualities) {
      const { data } = prepareCommand(project, 'render.plan', { quality, format: 'mp4' });
      runs.push({ id: `${id}-${quality}`, project: filename, quality,
        includeAudio: project.kind !== 'demo', includeCaptions: true,
        output: data.output, media: data.media, rendered: data.rendered, status: 'unmeasured' });
    }
  }
  save('A-demo-12s', createDemoProject(), [720], 12);

  const base = createDemoProject();
  base.kind = 'video'; base.fileName = 'synthetic-av.mp4'; base.duration = 12;
  base.clips = [{ start: 0, end: 10 }, { start: 2, end: 12 }, { start: 0, end: 10 }];
  base.captions = [
    { start: 0, end: 3, text: '첫 번째 합성 장면' },
    { start: 3, end: 6, text: 'Ordinary caption with a cut' },
    { start: 6, end: 9, text: '第二个合成场景' },
    { start: 9, end: 12, text: '다시 만나는 장면' },
  ];
  base.captionAnimation = 'none';
  save('B-multicut-30s', structuredClone(base), [720], 30);

  const effects = structuredClone(base);
  effects.clips = Array.from({ length: 5 }, () => ({ start: 0, end: 12 }));
  effects.captionAnimation = 'slide';
  effects.globalKeywords = '합성,caption,合成';
  effects.effects = { ...effects.effects, motion: 'in', transition: 'fadeBlack',
    brightness: 1.05, contrast: 1.1, saturation: 1.1, vignette: .25, progress: true };
  effects.overlays = [{ ...newCard(60, 5), id: 'synthetic-free-card', role: 'free',
    text: '텍스트 효과 · Text effects · 文字效果', detail: 'Synthetic fixture only', end: 10 }];
  effects.audioName = 'bgm-60.wav'; effects.audioOffset = 1.25;
  effects.volume = .6; effects.audioVolume = .2;
  save('C-effects-audio-60s', effects, [720], 60);

  for (const ratio of ['9:16', '4:5', '1:1', '16:9']) {
    const project = structuredClone(base);
    project.ratio = ratio;
    save(`D-${ratio.replace(':', 'x')}`, project, [720, 1080], 30);
  }

  for (const speed of [.25, .5, 1, 2, 4]) {
    const project = structuredClone(base);
    project.speed = speed;
    project.clips = [{ start: 8, end: 12 }, { start: 0, end: 4 }, { start: 8, end: 12 }, { start: 4, end: 8 }];
    project.captions = [
      { start: 8, end: 12, text: '배열 우선순위: 반복된 원본 자막' },
      { start: 2, end: 13, basis: 'timeline', timing: 'estimated',
        text: '긴 자막과 추정 시간 · Long caption · 长字幕 👩🏽‍💻 '.repeat(18) },
      { start: 0, end: 4, text: '컷 경계 앞뒤: source zero to four' },
    ];
    project.audioName = 'bgm-60.wav'; project.audioOffset = .4;
    project.design.title.start = 0; project.design.title.end = 16 / speed;
    project.design.credit.start = 0; project.design.credit.end = 16 / speed;
    save(`E-speed-${String(speed).replace('.', '_')}`, project, [720], 16 / speed);
  }


  return { documents, manifest: { schemaVersion: 1, rendered: false,
    scope: 'Prepared synthetic projects; no browser import or export measured.',
    requiresSuccessfulBrowserSmoke: true,
    caveats: ['render.plan is metadata only',
      'Repeated markers need clip-occurrence mapping; the calibration analyzer does not analyze edited output'],
    runs } };
}

export async function writeBenchmarkMatrix(directory) {
  const { documents, manifest } = createBenchmarkMatrix();
  await mkdir(directory); // Refuse existing destinations, including symlinks.
  for (const [filename, document] of Object.entries(documents))
    await writeFile(resolve(directory, filename), JSON.stringify(document, null, 2) + '\n', { flag: 'wx' });
  await writeFile(resolve(directory, 'matrix.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return { projectDocuments: Object.keys(documents).length, plannedRuns: manifest.runs.length, rendered: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node qa/export-matrix.mjs <new-output-directory>');
    console.log(JSON.stringify(await writeBenchmarkMatrix(process.argv[2])));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
