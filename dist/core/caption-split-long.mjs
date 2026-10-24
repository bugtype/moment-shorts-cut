import { splitCaptionText } from '../effects.mjs';
import { MAX_CAPTIONS } from '../captions.mjs';
import { message as msg } from '../i18n.mjs';
import { fail } from './validation.mjs';

// Split the original authored range, not indices shifted by earlier splits.
export function splitLongCaptions(captions, options = {}) {
  const limit = Object.hasOwn(options, 'limit') ? options.limit : 18;
  if (![12, 18, 24].includes(limit))
    fail(msg('errors.longSplitLimit'), 'arguments.limit');
  const hasIndex = Object.hasOwn(options, 'captionIndex');
  const hasCount = Object.hasOwn(options, 'count');
  const first = hasIndex ? options.captionIndex : 0;
  if (hasIndex && (!Number.isInteger(first) || first < 0 || first >= MAX_CAPTIONS || first >= captions.length))
    fail(msg('errors.replaceCaptionIndex'), 'arguments.captionIndex');
  const count = hasCount ? options.count : captions.length - first;
  if (hasCount && (!Number.isInteger(count) || count < 1 || count > MAX_CAPTIONS || first + count > captions.length))
    fail(msg('errors.replaceCaptionCount'), 'arguments.count');

  let next, changedCaptions = 0, addedCaptions = 0;
  for (let index = first; index < first + count; index++) {
    const caption = captions[index];
    let parts;
    try {
      parts = splitCaptionText(caption, limit);
    } catch (error) {
      fail(error.messageKey ? error : error.message, `project.captions[${index}]`);
    }
    addedCaptions += parts.length - 1;
    if (captions.length + addedCaptions > MAX_CAPTIONS)
      fail(msg('errors.captionLimit'), 'project.captions');
    if (parts.some(part => !Number.isFinite(part.start) || !Number.isFinite(part.end) || part.end <= part.start))
      fail(msg('errors.splitPrecision'), `project.captions[${index}]`);
    const changed = parts.length !== 1 ||
      (parts[0] !== caption && JSON.stringify(parts[0]) !== JSON.stringify(caption));
    if (changed) {
      next ||= captions.slice(0, index);
      next.push(...parts);
      changedCaptions++;
    } else if (next) {
      next.push(caption);
    }
  }
  if (next) next.push(...captions.slice(first + count));
  return { captions: next || captions, changedCaptions, addedCaptions };
}
