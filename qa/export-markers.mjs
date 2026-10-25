// Fixture-specific signal checks. No file I/O, subprocesses, or third-party packages.
export const FIXTURE = Object.freeze({ width: 640, height: 360, fps: 30,
  seconds: 12, sampleRate: 48000, backgroundGray: 16, decodedPixels: 64,
  toleranceMs: 5, ptsToleranceSeconds: 0.000002, maxAudioPaddingSamples: 1024 });
export const MARKERS = Object.freeze([
  { id: 'M1', frame: 21, frames: 4, gray: 80, hz: 600 },
  { id: 'M2', frame: 59, frames: 7, gray: 115, hz: 900 },
  { id: 'M3', frame: 127, frames: 5, gray: 150, hz: 1300 },
  { id: 'M4', frame: 202, frames: 8, gray: 185, hz: 1700 },
  { id: 'M5', frame: 301, frames: 6, gray: 220, hz: 2300 },
].map(Object.freeze));
const expectedIds = MARKERS.map(marker => marker.id);
const wrongIds = ['M1', 'M4', 'M3', 'M2', 'M5'];
const identityErrors = [
  'audio identity sequence does not exactly match expected unique IDs',
  'identity mismatch: visual M2 versus audio M4',
  'identity mismatch: visual M4 versus audio M2',
];
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const numeric = value => (typeof value === 'number' ||
  (typeof value === 'string' && value.trim() !== '')) ? Number(value) : NaN;
const near = (value, expected, tolerance) => Number.isFinite(value) && Math.abs(value - expected) <= tolerance;
const maximum = values => values.length ? Math.max(...values) : null;

function bytes(value, multiple, maximumBytes, name) {
  if (!(value instanceof Uint8Array) || !value.byteLength ||
      value.byteLength % multiple || value.byteLength > maximumBytes) {
    throw new TypeError(`${name} must be a nonempty, aligned, bounded byte buffer`);
  }
}

function groups(values, active) {
  const result = [];
  let start = null;
  for (let index = 0; index <= values.length; index++) {
    const on = index < values.length && active(values[index]);
    if (on && start === null) start = index;
    if (!on && start !== null) { result.push([start, index]); start = null; }
  }
  return result;
}

export function detectVisualMarkers(buffer, pts) {
  bytes(buffer, FIXTURE.decodedPixels, FIXTURE.decodedPixels * 361, 'gray video');
  const levels = [];
  for (let offset = 0; offset < buffer.length; offset += FIXTURE.decodedPixels) {
    let total = 0;
    for (let pixel = 0; pixel < FIXTURE.decodedPixels; pixel++) total += buffer[offset + pixel];
    levels.push(total / FIXTURE.decodedPixels);
  }
  return groups(levels, value => value > 45).map(([start, end]) => {
    const sorted = levels.slice(start, end).sort((a, b) => a - b);
    const gray = sorted[Math.floor(sorted.length / 2)];
    const marker = MARKERS.find(candidate => sorted.every(value => Math.abs(value - candidate.gray) <= 5));
    return { id: marker?.id ?? 'unknown', start_frame: start, frames: end - start,
      gray, start_s: numeric(pts?.[start]), duration_s: (end - start) / FIXTURE.fps };
  });
}

// Positive zero crossings estimate frequency. A fitted sinusoid must explain
// >=90% of core energy; simply choosing the nearest expected tone would accept
// unknown frequencies. This is calibrated for these isolated tones, not speech.
function identifyTone(samples, start, end) {
  const crossings = [];
  for (let index = start + 1; index < end; index++) {
    if (samples[index - 1] <= 0 && samples[index] > 0) {
      crossings.push(index - 1 - samples[index - 1] / (samples[index] - samples[index - 1]));
    }
  }
  if (crossings.length < 3) return { id: 'unknown', hz: null, tone_concentration: 0 };
  const hz = (crossings.length - 1) * FIXTURE.sampleRate / (crossings.at(-1) - crossings[0]);
  let cc = 0, ss = 0, cs = 0, xc = 0, xs = 0, energy = 0;
  for (let index = start; index < end; index++) {
    const phase = 2 * Math.PI * hz * (index - start) / FIXTURE.sampleRate;
    const c = Math.cos(phase), s = Math.sin(phase), sample = samples[index];
    cc += c * c; ss += s * s; cs += c * s;
    xc += sample * c; xs += sample * s; energy += sample * sample;
  }
  const determinant = cc * ss - cs * cs;
  const concentration = determinant > 0 && energy > 0 ?
    ((ss * xc - cs * xs) * xc + (cc * xs - cs * xc) * xs) / determinant / energy : 0;
  const marker = MARKERS.find(candidate => Math.abs(candidate.hz - hz) <= 15);
  return { id: marker && concentration >= 0.9 ? marker.id : 'unknown',
    hz, tone_concentration: concentration };
}

export function detectAudioMarkers(buffer, origin = 0) {
  const expectedSamples = FIXTURE.sampleRate * FIXTURE.seconds;
  bytes(buffer, 4, (expectedSamples + FIXTURE.maxAudioPaddingSamples) * 4, 'f32 audio');
  if (!Number.isFinite(origin)) throw new TypeError('audio origin must be finite');
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const samples = new Float32Array(buffer.byteLength / 4);
  for (let index = 0; index < samples.length; index++) {
    samples[index] = view.getFloat32(index * 4, true);
    if (!Number.isFinite(samples[index])) throw new TypeError('audio contains non-finite samples');
  }
  const rms = [];
  const bin = FIXTURE.sampleRate / 1000;
  for (let start = 0; start + bin <= samples.length; start += bin) {
    let power = 0;
    for (let index = start; index < start + bin; index++) power += samples[index] ** 2;
    rms.push(Math.sqrt(power / bin));
  }
  return groups(rms, value => value > 0.12).map(([start, end]) => ({
    ...identifyTone(samples, start * bin + 480, end * bin - 480),
    start_s: origin + start / 1000, duration_s: (end - start) / 1000,
  }));
}

function inspectMedia(probe, videoGray, audioPcm) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const frames = Array.isArray(probe?.frames) ? probe.frames : [];
  const videos = streams.filter(stream => stream?.codec_type === 'video');
  const audios = streams.filter(stream => stream?.codec_type === 'audio');
  const video = videos[0] ?? {}, audio = audios[0] ?? {};
  const vf = frames.filter(frame => frame?.media_type === 'video');
  const af = frames.filter(frame => frame?.media_type === 'audio');
  const pts = vf.map(frame => numeric(frame.best_effort_timestamp_time));
  const apts = af.map(frame => numeric(frame.best_effort_timestamp_time));
  const counts = af.map(frame => numeric(frame.nb_samples));
  const videoErrors = pts.map((value, index) => Math.abs(value - index / FIXTURE.fps));
  const audioErrors = apts.slice(1).map((value, index) =>
    Math.abs(value - apts[index] - counts[index] / FIXTURE.sampleRate));
  const rawFrames = videoGray instanceof Uint8Array ? videoGray.byteLength / 64 : NaN;
  const samples = audioPcm instanceof Uint8Array ? audioPcm.byteLength / 4 : NaN;
  const sumSamples = counts.reduce((sum, value) => sum + value, 0);
  const duration = numeric(probe?.format?.duration);
  const ptsTolerance = FIXTURE.ptsToleranceSeconds;
  const checks = {
    actual_raw_decoded_video_frames: rawFrames, ffprobe_video_frames: vf.length,
    ffprobe_nb_read_frames: video.nb_read_frames ?? null,
    video_pts_first_s: pts[0] ?? null, video_pts_last_s: pts.at(-1) ?? null,
    video_pts_max_error_s: maximum(videoErrors),
    video_codec: video.codec_name ?? null, audio_codec: audio.codec_name ?? null,
    width: video.width ?? null, height: video.height ?? null,
    avg_frame_rate: video.avg_frame_rate ?? null, r_frame_rate: video.r_frame_rate ?? null,
    container: probe?.format?.format_name ?? null, container_duration_s: duration,
    audio_sample_rate: audio.sample_rate ?? null, audio_channels: audio.channels ?? null,
    audio_first_decoded_pts_s: apts[0] ?? null, audio_frame_count: af.length,
    audio_pts_continuity_max_error_s: maximum(audioErrors),
    audio_samples_sum_from_ffprobe: sumSamples, decoded_audio_samples: samples,
    decoded_audio_duration_s: samples / FIXTURE.sampleRate,
    decoded_audio_trailing_padding_ms: (samples / FIXTURE.sampleRate - FIXTURE.seconds) * 1000,
    analyzed_audio_samples: Math.floor(samples / 48) * 48,
    unanalyzed_audio_tail_samples: samples % 48,
  };
  const ok = streams.length === 2 && videos.length === 1 && audios.length === 1 &&
    frames.length === vf.length + af.length && rawFrames === 360 && vf.length === 360 &&
    numeric(video.nb_read_frames) === 360 && videoErrors.every(error => near(error, 0, ptsTolerance)) &&
    video.codec_name === 'h264' && video.width === 640 && video.height === 360 &&
    video.avg_frame_rate === '30/1' && video.r_frame_rate === '30/1' &&
    typeof probe?.format?.format_name === 'string' && probe.format.format_name.split(',').includes('mp4') &&
    near(duration, FIXTURE.seconds, 0.001) && audio.codec_name === 'aac' &&
    numeric(audio.sample_rate) === FIXTURE.sampleRate && audio.channels === 1 &&
    af.length > 1 && counts.every(count => Number.isInteger(count) && count > 0 && count <= 1024) &&
    near(apts[0], 0, ptsTolerance) && audioErrors.every(error => near(error, 0, ptsTolerance)) &&
    samples === sumSamples && samples >= FIXTURE.sampleRate * FIXTURE.seconds &&
    samples <= FIXTURE.sampleRate * FIXTURE.seconds + FIXTURE.maxAudioPaddingSamples;
  return { ok, checks, pts, origin: apts[0] };
}

export function analyzeDecoded({ probe, videoGray, audioPcm, expectedOffsetMs = 0 } = {}) {
  if (expectedOffsetMs !== null && !Number.isFinite(expectedOffsetMs)) {
    throw new TypeError('expectedOffsetMs must be finite, or null for the identity-swap control');
  }
  const structuralErrors = [];
  // Bound probe arrays before mapping/spreading; raw buffers are bounded by detectors.
  if ((probe?.frames?.length ?? 0) > 1000 || (probe?.streams?.length ?? 0) > 10) {
    probe = null;
    structuralErrors.push('probe exceeds fixture limits');
  }
  const media = inspectMedia(probe, videoGray, audioPcm);
  let visual = [], audio = [];
  try { visual = detectVisualMarkers(videoGray, media.pts); }
  catch (error) { structuralErrors.push(`visual decode: ${error.message}`); }
  try { audio = detectAudioMarkers(audioPcm, media.origin); }
  catch (error) { structuralErrors.push(`audio decode: ${error.message}`); }
  if (!same(visual.map(marker => marker.id), expectedIds)) {
    structuralErrors.push('visual identity sequence does not exactly match expected unique IDs');
  }
  if (!same(audio.map(marker => marker.id), expectedIds)) {
    structuralErrors.push(identityErrors[0]);
  }
  const pairing = visual.map((v, index) => {
    const a = audio[index];
    const match = !!a && v.id === a.id && v.id !== 'unknown';
    if (!match) structuralErrors.push(`identity mismatch: visual ${v.id} versus audio ${a?.id ?? 'missing'}`);
    if (!a || !near(a.duration_s, v.duration_s, FIXTURE.toleranceMs / 1000)) {
      structuralErrors.push(`duration mismatch for ${v.id}`);
    }
    return { visual_id: v.id, audio_id: a?.id ?? null, identity_match: match, offset_ms: null };
  });
  for (const [index, v] of visual.entries()) {
    const expected = MARKERS[index];
    if (!expected || v.start_frame !== expected.frame || v.frames !== expected.frames) {
      structuralErrors.push(`visual marker schedule mismatch for ${v.id}`);
    }
  }
  // The negative control may differ ONLY in tone identity, including its timing.
  if (expectedOffsetMs === null) {
    for (const [index, a] of audio.entries()) {
      if (!MARKERS[index] || !near(a.start_s, MARKERS[index].frame / FIXTURE.fps, FIXTURE.toleranceMs / 1000)) {
        structuralErrors.push(`audio marker schedule mismatch at slot ${index + 1}`);
      }
    }
  }
  if (!media.ok) structuralErrors.push('media structure or PTS check failed');
  const verified = structuralErrors.length === 0;
  const offsets = verified ? pairing.map((pair, index) => {
    pair.offset_ms = (audio[index].start_s - visual[index].start_s) * 1000;
    return pair.offset_ms;
  }) : [];
  const calibrationPass = expectedOffsetMs === null ? media.ok &&
    same(visual.map(marker => marker.id), expectedIds) && same(audio.map(marker => marker.id), wrongIds) &&
    same(structuralErrors, identityErrors) : verified &&
    offsets.every(offset => near(offset, expectedOffsetMs, FIXTURE.toleranceMs));
  return { streams: media.checks, visual_markers: visual, audio_markers: audio, pairing,
    identities_verified: verified, structural_errors: structuralErrors,
    sync_aligned_within_5ms: verified && offsets.every(offset => near(offset, 0, FIXTURE.toleranceMs)),
    expected_offset_ms: expectedOffsetMs,
    offset_mean_ms: offsets.length ? offsets.reduce((sum, offset) => sum + offset, 0) / offsets.length : null,
    offset_max_error_vs_expected_ms: offsets.length && expectedOffsetMs !== null ?
      maximum(offsets.map(offset => Math.abs(offset - expectedOffsetMs))) : null,
    calibration_pass: calibrationPass };
}
