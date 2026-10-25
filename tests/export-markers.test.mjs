import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeDecoded, detectAudioMarkers, detectVisualMarkers, FIXTURE, MARKERS } from '../qa/export-markers.mjs';
import { calibrate } from '../qa/export-calibration.mjs';

function putTone(buffer, marker, hz, { shift = 0, extraSamples = 0, mixture = false } = {}) {
  const start = marker.frame * 1600 + shift;
  const count = marker.frames * 1600 + extraSamples;
  for (let index = 0; index < count; index++) {
    const phase = 2 * Math.PI * hz * index / FIXTURE.sampleRate;
    const ramp = Math.min(1, index / 95, (count - 1 - index) / 95);
    const sample = mixture ? 0.3 * (Math.sin(phase) + Math.sin(phase * 1.5)) : 0.6 * Math.sin(phase);
    buffer.writeFloatLE(sample * ramp, (start + index) * 4);
  }
}

function fixture(expectedOffsetMs = 0) {
  const videoGray = Buffer.alloc(360 * 64, FIXTURE.backgroundGray);
  const audioPcm = Buffer.alloc(12 * 48000 * 4);
  const probe = { streams: [
    { codec_type: 'video', codec_name: 'h264', width: 640, height: 360,
      nb_read_frames: '360', avg_frame_rate: '30/1', r_frame_rate: '30/1' },
    { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 1 },
  ], format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '12.000000' }, frames: [] };
  for (let index = 0; index < 360; index++) {
    probe.frames.push({ media_type: 'video', best_effort_timestamp_time: (index / 30).toFixed(6) });
  }
  for (let index = 0; index < 576000; index += 1024) {
    probe.frames.push({ media_type: 'audio', best_effort_timestamp_time: (index / 48000).toFixed(6),
      nb_samples: Math.min(1024, 576000 - index) });
  }
  for (const [index, marker] of MARKERS.entries()) {
    videoGray.fill(marker.gray, marker.frame * 64, (marker.frame + marker.frames) * 64);
    const frequency = expectedOffsetMs === null ? MARKERS[{ 1: 3, 3: 1 }[index] ?? index].hz : marker.hz;
    putTone(audioPcm, marker, frequency, { shift: (expectedOffsetMs ?? 0) * 48 });
  }
  return { probe, videoGray, audioPcm, expectedOffsetMs };
}

function failed(input, pattern) {
  const report = analyzeDecoded(input);
  assert.equal(report.calibration_pass, false);
  assert.equal(report.identities_verified, false);
  assert.equal(report.sync_aligned_within_5ms, false);
  assert.equal(report.offset_mean_ms, null);
  assert.ok(report.pairing.every(pair => pair.offset_ms === null));
  if (pattern) assert.ok(report.structural_errors.some(error => pattern.test(error)), report.structural_errors.join('\n'));
  return report;
}

test('imports are inert and fixture definitions retain five distinct nonperiodic markers', () => {
  assert.equal(typeof calibrate, 'function');
  assert.deepEqual(MARKERS.map(marker => marker.frame), [21, 59, 127, 202, 301]);
  for (const field of ['id', 'frames', 'gray', 'hz']) assert.equal(new Set(MARKERS.map(marker => marker[field])).size, 5);
  assert.ok(Object.isFrozen(MARKERS) && MARKERS.every(Object.isFrozen));
});

test('baseline identifies every tone and measures aligned offsets', () => {
  const report = analyzeDecoded(fixture());
  assert.equal(report.calibration_pass, true);
  assert.equal(report.identities_verified, true);
  assert.equal(report.sync_aligned_within_5ms, true);
  assert.deepEqual(report.structural_errors, []);
  for (const [index, audio] of report.audio_markers.entries()) {
    assert.equal(audio.id, MARKERS[index].id);
    assert.ok(Math.abs(audio.hz - MARKERS[index].hz) < 0.1);
    assert.ok(audio.tone_concentration > 0.99);
  }
  assert.ok(Math.abs(report.offset_mean_ms) <= 5);
});

test('+100 ms is a successful shifted calibration and fails the sync check', () => {
  const input = fixture(100);
  const report = analyzeDecoded(input);
  assert.equal(report.calibration_pass, true);
  assert.equal(report.identities_verified, true);
  assert.equal(report.sync_aligned_within_5ms, false);
  assert.ok(Math.abs(report.offset_mean_ms - 100) <= 5);
  assert.equal(analyzeDecoded({ ...input, expectedOffsetMs: 0 }).calibration_pass, false);
});

test('only the intended identity swap passes the negative calibration; offsets stay suppressed', () => {
  const report = analyzeDecoded(fixture(null));
  assert.equal(report.calibration_pass, true);
  assert.equal(report.identities_verified, false);
  assert.equal(report.sync_aligned_within_5ms, false);
  assert.equal(report.offset_mean_ms, null);
  assert.ok(report.pairing.every(pair => pair.offset_ms === null));
  assert.deepEqual(report.audio_markers.map(marker => marker.id), ['M1', 'M4', 'M3', 'M2', 'M5']);
  assert.deepEqual(report.structural_errors, [
    'audio identity sequence does not exactly match expected unique IDs',
    'identity mismatch: visual M2 versus audio M4',
    'identity mismatch: visual M4 versus audio M2',
  ]);
  assert.equal(analyzeDecoded({ ...fixture(null), expectedOffsetMs: 0 }).calibration_pass, false);
});

test('regression: identity swap plus one-frame visual shift must fail', () => {
  const input = fixture(null);
  input.videoGray.fill(16, 21 * 64, 26 * 64);
  input.videoGray.fill(80, 22 * 64, 26 * 64);
  failed(input, /visual marker schedule mismatch for M1/);
});

test('regression: identity swap plus one-frame visual extension must fail', () => {
  const input = fixture(null);
  input.videoGray.fill(80, 25 * 64, 26 * 64);
  failed(input, /visual marker schedule mismatch for M1/);
});

test('regression: identity swap still checks swapped-slot audio duration', () => {
  const input = fixture(null);
  putTone(input.audioPcm, MARKERS[1], 1700, { extraSamples: 960 });
  failed(input, /duration mismatch for M2/);
});

test('identity swap plus audio timing shift is an additional defect', () => {
  const input = fixture(null);
  input.audioPcm.fill(0);
  for (const [index, marker] of MARKERS.entries()) {
    putTone(input.audioPcm, marker, MARKERS[{ 1: 3, 3: 1 }[index] ?? index].hz, { shift: 4800 });
  }
  failed(input, /audio marker schedule mismatch/);
});

test('missing, duplicate, extra and unknown markers fail closed', () => {
  const missing = fixture();
  missing.videoGray.fill(16, 127 * 64, 132 * 64);
  failed(missing, /visual identity sequence/);
  const duplicate = fixture();
  duplicate.videoGray.fill(80, 59 * 64, 66 * 64);
  failed(duplicate, /visual identity sequence/);
  const extra = fixture();
  extra.videoGray.fill(80, 340 * 64, 344 * 64);
  failed(extra, /visual identity sequence/);
  const unknownVisual = fixture();
  unknownVisual.videoGray.fill(100, 21 * 64, 25 * 64);
  failed(unknownVisual, /visual identity sequence/);
  const missingAudio = fixture();
  missingAudio.audioPcm.fill(0, 21 * 1600 * 4, 25 * 1600 * 4);
  failed(missingAudio, /audio identity sequence/);
});

test('off-catalog frequency and mixed tones are unknown, not nearest-ID matches', () => {
  for (const [hz, mixture] of [[1100, false], [600, true]]) {
    const input = fixture();
    putTone(input.audioPcm, MARKERS[0], hz, { mixture });
    const report = failed(input, /audio identity sequence/);
    assert.equal(report.audio_markers[0].id, 'unknown');
  }
});

test('empty, misaligned, oversized and nonfinite decoded buffers fail closed', () => {
  for (const videoGray of [undefined, [], Buffer.alloc(0), Buffer.alloc(63), Buffer.alloc(64 * 362)]) {
    failed({ ...fixture(), videoGray }, /visual decode/);
  }
  for (const audioPcm of [undefined, [], Buffer.alloc(0), Buffer.alloc(3), Buffer.alloc(4 * 577025)]) {
    failed({ ...fixture(), audioPcm }, /audio decode/);
  }
  for (const value of [NaN, Infinity, -Infinity]) {
    const input = fixture();
    input.audioPcm.writeFloatLE(value, 0);
    failed(input, /non-finite samples/);
  }
  assert.throws(() => detectVisualMarkers(Buffer.alloc(0), []));
  assert.throws(() => detectAudioMarkers(Buffer.alloc(4), NaN));
  assert.throws(() => analyzeDecoded({ expectedOffsetMs: NaN }));
});

test('wrong, missing and nonfinite PTS fail before any offsets are emitted', () => {
  for (const value of ['0.800000', undefined, '', 'NaN', Infinity]) {
    const input = fixture(null);
    input.probe.frames[21].best_effort_timestamp_time = value;
    failed(input, /media structure or PTS/);
  }
  const audioGap = fixture();
  audioGap.probe.frames[361].best_effort_timestamp_time = '0.100000';
  failed(audioGap, /media structure or PTS/);
  const shiftedOrigin = fixture();
  shiftedOrigin.probe.frames[360].best_effort_timestamp_time = '0.001000';
  failed(shiftedOrigin, /media structure or PTS/);
});

test('stream count, frame count, audio accounting and container mismatches fail', () => {
  const mutations = [
    input => input.probe.streams.push({ codec_type: 'audio' }),
    input => input.probe.streams[0].width = 1280,
    input => input.probe.streams[1].channels = 2,
    input => input.probe.streams[1].sample_rate = '44100',
    input => input.probe.streams[0].codec_name = 'vp9',
    input => input.probe.streams[0].nb_read_frames = '359',
    input => input.probe.frames.splice(0, 1),
    input => input.probe.frames[360].nb_samples = 1023,
    input => input.probe.format.duration = '',
    input => input.probe.format.format_name = 'matroska',
    input => input.audioPcm = input.audioPcm.subarray(0, input.audioPcm.length - 4),
    input => input.videoGray = input.videoGray.subarray(0, input.videoGray.length - 64),
  ];
  for (const mutate of mutations) {
    const input = fixture(null);
    mutate(input);
    failed(input, /media structure or PTS/);
  }
  failed({ probe: null }, /media structure or PTS/);
  failed({ ...fixture(), probe: { frames: Array(1001) } }, /probe exceeds fixture limits/);
});

test('AAC padding and the partial RMS tail are retained and accounted for', () => {
  const input = fixture();
  input.audioPcm = Buffer.concat([input.audioPcm, Buffer.alloc(512 * 4)]);
  input.probe.frames.at(-1).nb_samples = 1024;
  const report = analyzeDecoded(input);
  assert.equal(report.calibration_pass, true);
  assert.equal(report.streams.decoded_audio_samples, 576512);
  assert.equal(report.streams.audio_samples_sum_from_ffprobe, 576512);
  assert.ok(Math.abs(report.streams.decoded_audio_trailing_padding_ms - 10.6666666667) < 1e-7);
  assert.equal(report.streams.unanalyzed_audio_tail_samples, 32);
  assert.equal(report.streams.analyzed_audio_samples, 576480);
});
