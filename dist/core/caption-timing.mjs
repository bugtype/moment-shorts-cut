import { message as msg } from '../i18n.mjs';
import { fail } from './validation.mjs';

// Shift authored cue times in one explicit pre-speed clock; never move media.
export function shiftCaptionTiming(captions, { basis, delta }, duration) {
  if (!['source', 'timeline'].includes(basis)) fail(msg('errors.captionBasis'), 'arguments.basis');
  if (!Number.isFinite(delta)) fail(msg('errors.shiftNumber'), 'arguments.delta');
  if (!Number.isFinite(duration) || duration < 0) fail(msg('errors.captionDuration'), 'project.duration');
  duration = Math.min(duration, 86400); // Existing caption schema ceiling, even on repeated timelines.
  if (delta === 0) return { captions, shiftedCaptions: 0 };
  let shiftedCaptions = 0;
  const next = captions.map((caption, index) => {
    if ((caption.basis || 'source') !== basis) return caption;
    const shiftedStart = caption.start + delta, shiftedEnd = caption.end + delta;
    const startTolerance = Number.EPSILON * Math.max(1, Math.abs(caption.start), Math.abs(delta)) * 4;
    const endTolerance = Number.EPSILON * Math.max(1, Math.abs(caption.end), Math.abs(delta), duration) * 4;
    // Correct only arithmetic roundoff at boundaries, never crop an actual cue.
    const start = shiftedStart < 0 && shiftedStart >= -startTolerance ? 0 : shiftedStart;
    const end = shiftedEnd > duration && shiftedEnd <= duration + endTolerance ? duration : shiftedEnd;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration || end <= start)
      fail(msg('errors.shiftRange'), `project.captions[${index}]`);
    if (start === caption.start && end === caption.end) return caption;
    shiftedCaptions++;
    return { ...caption, start, end };
  });
  return { captions: shiftedCaptions ? next : captions, shiftedCaptions };
}
