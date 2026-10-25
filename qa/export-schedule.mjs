// QA-only frame schedule. Not imported by the editor; no encoder or audio path.
export function silentFrameSchedule(outputDuration, { fps = 30, limit = 12 } = {}) {
  if (!Number.isFinite(outputDuration) || outputDuration <= 0)
    throw new RangeError('Output duration must be finite and positive.');
  if (fps !== 30 || limit !== 12)
    throw new RangeError('This experiment is bounded to 30 fps and at most 12 seconds.');
  if (outputDuration > limit)
    throw new RangeError('An explicit output range of at most 12 seconds is required.');
  const duration = outputDuration;
  const endUs = Math.round(duration * 1_000_000);
  if (!endUs) throw new RangeError('Duration is below the microsecond clock resolution.');
  const frames = [];
  // Compose at the rational frame index, never at an accumulated rounded clock.
  for (let index = 0; index < 360; index++) {
    const timestampUs = Math.round(index * 1_000_000 / fps);
    if (timestampUs >= endUs) break;
    const nextUs = Math.round((index + 1) * 1_000_000 / fps);
    frames.push({ index, time: index / fps, timestampUs, durationUs: Math.min(nextUs, endUs) - timestampUs });
  }
  return { rendered: false, audioTracks: 0, duration, endUs, frameCount: frames.length,
    policy: 'half-open output interval; final duration clipped at rounded end microsecond', frames };
}
