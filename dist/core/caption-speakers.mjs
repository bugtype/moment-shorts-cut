import { message } from '../i18n.mjs';
import { fail } from './validation.mjs';

// Assign existing speaker slots to an exact authored range, without changing
// cue clocks or interpreting speaker labels as diarization results.
export function assignCaptionSpeaker(captions, { captionIndex, count, speaker }) {
  if (!Number.isInteger(captionIndex) || captionIndex < 0 || captionIndex > 9999 || captionIndex >= captions.length)
    fail(message('errors.updateCaptionIndex'), 'arguments.captionIndex');
  if (!Number.isInteger(count) || count < 1 || count > 10000 || captionIndex + count > captions.length)
    fail(message('errors.speakerCaptionCount'), 'arguments.count');
  if (!['', '0', '1'].includes(speaker)) fail(message('errors.value'), 'arguments.speaker');
  let next, changedCaptions = 0;
  for (let index = captionIndex; index < captionIndex + count; index++) {
    const caption = captions[index];
    if ((caption.speaker || '') === speaker) continue;
    next ||= captions.slice();
    next[index] = { ...caption, speaker };
    changedCaptions++;
  }
  return { captions: next || captions, changedCaptions };
}
