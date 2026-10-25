// Optional: node qa/export-calibration.mjs <new-output-directory>
// Requires FFmpeg/ffprobe with libx264 and AAC. Never runs on import or in npm test.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { analyzeDecoded, FIXTURE, MARKERS } from './export-markers.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
async function preserveFailure(error, cleanup) {
  try { await cleanup(); }
  catch (secondary) { (error.suppressed ??= []).push(secondary.message); }
}
const variants = [
  { label: 'baseline', file: 'synthetic-av.mp4', shift: 0, expected: 0 },
  { label: 'plus100ms', file: 'synthetic-av-plus100ms.mp4', shift: 4800, expected: 100 },
  { label: 'wrong-identity', file: 'synthetic-av-wrong-identity.mp4', shift: 0, expected: null },
];

function wavBuffer(sampleCount) {
  const wav = Buffer.alloc(44 + sampleCount * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(FIXTURE.sampleRate, 24); wav.writeUInt32LE(FIXTURE.sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(sampleCount * 2, 40);
  return wav;
}

function makeWav(variant) {
  const wav = wavBuffer(FIXTURE.seconds * FIXTURE.sampleRate);
  for (const [index, marker] of MARKERS.entries()) {
    const frequencyIndex = variant.expected === null ? ({ 1: 3, 3: 1 }[index] ?? index) : index;
    const count = marker.frames * (FIXTURE.sampleRate / FIXTURE.fps);
    const start = marker.frame * (FIXTURE.sampleRate / FIXTURE.fps) + variant.shift;
    for (let sample = 0; sample < count; sample++) {
      const ramp = Math.min(1, sample / 95, (count - 1 - sample) / 95);
      const value = 0.6 * Math.sin(2 * Math.PI * MARKERS[frequencyIndex].hz * sample / FIXTURE.sampleRate) * ramp;
      wav.writeInt16LE(Math.round(value * 32767), 44 + (start + sample) * 2);
    }
  }
  return wav;
}

function makeBackground() {
  const count = 60 * FIXTURE.sampleRate;
  const wav = wavBuffer(count);
  for (let sample = 0; sample < count; sample++) {
    const seconds = sample / FIXTURE.sampleRate;
    const fade = Math.min(1, sample / (FIXTURE.sampleRate - 1), (count - 1 - sample) / (FIXTURE.sampleRate - 1));
    const value = [220, 277.182631, 329.627557].reduce((sum, hz) => sum + 0.018 * Math.sin(2 * Math.PI * hz * seconds), 0);
    wav.writeInt16LE(Math.round(value * fade * 32767), 44 + sample * 2);
  }
  return wav;
}

function* videoFrames() {
  const frames = new Map([FIXTURE.backgroundGray, ...MARKERS.map(marker => marker.gray)]
    .map(gray => [gray, Buffer.alloc(FIXTURE.width * FIXTURE.height, gray)]));
  for (let frame = 0; frame < FIXTURE.fps * FIXTURE.seconds; frame++) {
    const marker = MARKERS.find(value => frame >= value.frame && frame < value.frame + value.frames);
    yield frames.get(marker?.gray ?? FIXTURE.backgroundGray);
  }
}

// Keep outputs bounded, close stdin, kill on timeout/error, and await child close.
// Commands are sequential and use argv directly, with no shell interpretation.
async function runCommand(directory, commands, name, argv, { input, binary = false,
  maxBytes = 8 * 1024 * 1024, timeoutMs = 120000 } = {}) {
  const record = { name, argv, shell: false, timeout_ms: timeoutMs, stdout_limit_bytes: maxBytes,
    stderr_limit_bytes: 4 * 1024 * 1024, cwd: 'output directory' };
  commands.push(record);
  await writeFile(path.join(directory, 'commands.json'), json(commands));
  const child = spawn(argv[0], argv.slice(1), { cwd: directory, shell: false,
    stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true });
  const chunks = { stdout: [], stderr: [] };
  const sizes = { stdout: 0, stderr: 0 };
  let failure = null;
  const abort = error => {
    failure ??= error;
    child.stdin?.destroy();
    child.kill('SIGKILL');
  };
  const timer = setTimeout(() => abort(new Error(`${name}: timeout after ${timeoutMs} ms`)), timeoutMs);
  for (const stream of ['stdout', 'stderr']) {
    child[stream].on('data', chunk => {
      const limit = stream === 'stdout' ? maxBytes : record.stderr_limit_bytes;
      if (sizes[stream] + chunk.length > limit) abort(new Error(`${name}: ${stream} exceeded ${limit} bytes`));
      else { chunks[stream].push(chunk); sizes[stream] += chunk.length; }
    });
    child[stream].on('error', abort);
  }
  child.on('error', abort);
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  const fed = input ? pipeline(Readable.from(input), child.stdin).catch(abort) : Promise.resolve();
  let status;
  try { status = await closed; await fed; }
  finally { clearTimeout(timer); }
  record.exit_code = status.code;
  record.signal = status.signal;
  record.error = failure?.message ?? (status.code !== 0 ? `${name}: exit ${status.code}` : null);
  const stdout = Buffer.concat(chunks.stdout), stderr = Buffer.concat(chunks.stderr);
  const saveLogs = async () => {
    await writeFile(path.join(directory, `${name}.${binary ? 'bin' : 'stdout.log'}`), stdout);
    await writeFile(path.join(directory, `${name}.stderr.log`), stderr);
    await writeFile(path.join(directory, 'commands.json'), json(commands));
  };
  if (record.error) {
    const error = new Error(record.error);
    await preserveFailure(error, saveLogs);
    throw error;
  }
  await saveLogs();
  return stdout;
}

async function encode(directory, commands, variant) {
  const partial = `${variant.label}.partial.mp4`;
  const input = variant.label === 'baseline' ? videoFrames() : undefined;
  const source = input ? ['-threads', '1', '-f', 'rawvideo', '-pix_fmt', 'gray',
    '-video_size', '640x360', '-framerate', '30', '-i', 'pipe:0'] : ['-i', variants[0].file];
  const video = input ? ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-threads', '1', '-pix_fmt', 'yuv420p'] : ['-c:v', 'copy'];
  try {
    await runCommand(directory, commands, `encode-${variant.label}`, [
      'ffmpeg', '-nostdin', '-hide_banner', '-n', '-loglevel', 'info', ...source,
      '-i', `${variant.label}.wav`, '-map', '0:v:0', '-map', '1:a:0', ...video,
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', '12', '-movflags', '+faststart', partial,
    ], { input });
    await rename(path.join(directory, partial), path.join(directory, variant.file));
  } catch (error) {
    await preserveFailure(error, () => rm(path.join(directory, partial), { force: true }));
    throw error;
  }
}

async function analyze(directory, commands, variant) {
  const prefix = variant.label;
  const probeBytes = await runCommand(directory, commands, `${prefix}.probe`, [
    'ffprobe', '-v', 'error', '-show_format', '-show_streams', '-show_frames',
    '-count_frames', '-of', 'json', variant.file,
  ]);
  await writeFile(path.join(directory, `${prefix}.ffprobe.json`), probeBytes);
  const decode = ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'info', '-xerror', '-i', variant.file];
  await runCommand(directory, commands, `${prefix}.full-decode`, [
    ...decode, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-',
  ]);
  // Extract the native Y plane before scaling to avoid full/limited-range gray conversion.
  const videoGray = await runCommand(directory, commands, `${prefix}.video-gray`, [
    ...decode, '-map', '0:v:0', '-vf', 'extractplanes=y,scale=8:8', '-pix_fmt', 'gray',
    '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1',
  ], { binary: true, maxBytes: 64 * 361 });
  const audioPcm = await runCommand(directory, commands, `${prefix}.audio-pcm`, [
    ...decode, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1',
  ], { binary: true, maxBytes: (FIXTURE.sampleRate * FIXTURE.seconds + FIXTURE.maxAudioPaddingSamples) * 4 });
  return { file: variant.file, sha256: sha256(await readFile(path.join(directory, variant.file))),
    ...analyzeDecoded({ probe: JSON.parse(probeBytes.toString('utf8')), videoGray, audioPcm,
      expectedOffsetMs: variant.expected }) };
}

async function analyzeBackground(directory, commands) {
  const probe = JSON.parse((await runCommand(directory, commands, 'bgm-60.probe', [
    'ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', 'bgm-60.wav',
  ])).toString('utf8'));
  await runCommand(directory, commands, 'bgm-60.full-decode', [
    'ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'info', '-xerror', '-i', 'bgm-60.wav', '-f', 'null', '-',
  ]);
  const stream = probe.streams?.[0];
  const valid = probe.streams?.length === 1 && stream.codec_name === 'pcm_s16le' &&
    stream.sample_rate === '48000' && stream.channels === 1 && stream.bits_per_sample === 16 &&
    stream.duration_ts === 2880000 && Number(probe.format?.duration) === 60;
  if (!valid) throw new Error('background WAV structure verification failed');
  return { file: 'bgm-60.wav', frames: stream.duration_ts, sample_rate: Number(stream.sample_rate),
    channels: stream.channels, sample_width_bytes: 2, duration_s: Number(probe.format.duration),
    codec: stream.codec_name, sha256: sha256(await readFile(path.join(directory, 'bgm-60.wav'))),
    full_decode_pass: true, purpose: 'synthetic preparation input; no application mix validation' };
}

export async function calibrate(outputDirectory) {
  if (typeof outputDirectory !== 'string' || !outputDirectory.trim()) {
    throw new TypeError('Usage: node qa/export-calibration.mjs <new-output-directory>');
  }
  const directory = path.resolve(outputDirectory);
  // Exclusive creation: an existing directory is refused before any writes.
  await mkdir(directory);
  const commands = [];
  try {
    const sourceHashes = {};
    for (const name of ['export-calibration.mjs', 'export-markers.mjs']) {
      sourceHashes[`qa/${name}`] = sha256(await readFile(new URL(name, import.meta.url)));
    }
    await writeFile(path.join(directory, 'source-sha256.json'), json(sourceHashes));
    const manifest = { schema: 1, scope: 'FFmpeg synthetic INPUT and analyzer calibration only; not Moment output',
      ...FIXTURE, markers: MARKERS, variants,
      background: { file: 'bgm-60.wav', seconds: 60, sample_rate: 48000, channels: 1,
        sample_format: 's16le', peak_bound: 0.054 },
      source_encoder: 'libx264; known from generator argv, not inferred from the decoder',
      app_encoder: 'unmeasured', performance: 'unmeasured', memory: 'unmeasured' };
    await writeFile(path.join(directory, 'manifest.json'), json(manifest));
    const versions = {};
    for (const program of ['ffmpeg', 'ffprobe']) {
      versions[program] = (await runCommand(directory, commands, `${program}-version`, [program, '-version']))
        .toString('utf8').split('\n')[0];
    }
    await writeFile(path.join(directory, 'versions.json'), json(versions));
    await writeFile(path.join(directory, 'bgm-60.wav'), makeBackground());
    for (const variant of variants) {
      await writeFile(path.join(directory, `${variant.label}.wav`), makeWav(variant));
      await encode(directory, commands, variant);
    }
    const mediaHashes = { 'bgm-60.wav': sha256(await readFile(path.join(directory, 'bgm-60.wav'))) };
    for (const variant of variants) {
      for (const name of [variant.file, `${variant.label}.wav`]) {
        mediaHashes[name] = sha256(await readFile(path.join(directory, name)));
      }
    }
    await writeFile(path.join(directory, 'media-sha256.json'), json(mediaHashes));
    const results = [];
    for (const variant of variants) results.push(await analyze(directory, commands, variant));
    const backgroundAudio = await analyzeBackground(directory, commands);
    const report = { scope: manifest.scope, all_calibrations_pass: results.every(result => result.calibration_pass),
      versions, source_sha256: sourceHashes, background_audio: backgroundAudio, onset_tolerance_ms: FIXTURE.toleranceMs,
      pts_rounding_tolerance_us: FIXTURE.ptsToleranceSeconds * 1e6,
      method: 'Full FFmpeg decode; native Y luma and frame PTS; 1 ms RMS bins; zero-crossing frequency plus fitted sinusoid; exact identities, schedules and slot durations before offsets',
      results, limitations: [
        'Fixture-specific analyzer, not an arbitrary-media or edited-output matcher',
        'No Moment/browser import, composition, rendering, playback or export was run',
        'Memory, application encoder, performance and resource usage are unmeasured',
        '5 ms tolerance covers AAC onset spread, 2 ms source ramps, 1 ms RMS bins and decimal PTS rounding',
        'All decoded audio is checked for finite samples; RMS analysis omits at most 47 final samples, reported explicitly',
        'AAC trailing padding is retained and reported; bounded to one 1024-sample AAC frame',
        'Invalid structure or identities suppress all offset measurements',
      ] };
    await writeFile(path.join(directory, 'analysis-report.json'), json(report));
    return report;
  } catch (error) {
    await preserveFailure(error, () => writeFile(path.join(directory, 'failure.json'),
      json({ error: error.message, suppressed: error.suppressed ?? [] })));
    throw error;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  if (process.argv.length !== 3) {
    console.error('Usage: node qa/export-calibration.mjs <new-output-directory>');
    process.exitCode = 1;
  } else {
    try {
      const report = await calibrate(process.argv[2]);
      console.log(json({ all_calibrations_pass: report.all_calibrations_pass,
        results: report.results.map(result => ({ file: result.file,
          identities_verified: result.identities_verified, sync_aligned_within_5ms: result.sync_aligned_within_5ms,
          offset_mean_ms: result.offset_mean_ms, calibration_pass: result.calibration_pass })) }));
      if (!report.all_calibrations_pass) process.exitCode = 1;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
