import { message as msg } from '../i18n.mjs';
import { fail } from './validation.mjs';

// Preview and application share validation, but preview never builds a caption
// array or copies caption objects. Matches are literal and nonoverlapping.
function inspectReplacement(captions, { find, replacement }, change) {
  if (typeof find !== 'string' || !find.length || find.length > 2000)
    fail(msg('errors.findLength'), 'arguments.find');
  if (typeof replacement !== 'string' || replacement.length > 2000)
    fail(msg('errors.replacementLength'), 'arguments.replacement');
  let matches = 0, changedCaptions = 0;
  for (const [index, caption] of captions.entries()) {
    // Application needs the pieces for joining; reuse them instead of scanning
    // the same text twice. Inspection counts without an array allocation.
    const parts = change ? caption.text.split(find) : null;
    let count = parts ? parts.length - 1 : 0;
    if (!parts) for (let start = caption.text.indexOf(find); start >= 0;
      start = caption.text.indexOf(find, start + find.length)) count++;
    matches += count;
    if (!count || find === replacement) continue;
    // Check size before constructing the bounded text needed for whitespace
    // validation. Split/join preserves literal replacement tokens and avoids
    // a callback invocation per occurrence during actual text construction.
    const length = caption.text.length + count * (replacement.length - find.length);
    if (length > 2000) fail(msg('errors.replacedTooLong'), `project.captions[${index}].text`);
    const text = (parts || caption.text.split(find)).join(replacement);
    if (!text.trim()) fail(msg('errors.replacedEmpty'), `project.captions[${index}].text`);
    changedCaptions++;
    change?.(caption, index, text);
  }
  return { matches, changedCaptions };
}

export function inspectCaptionTextReplacement(captions, options) {
  return inspectReplacement(captions, options);
}

// Correct authored text only: timing, ownership and metadata remain untouched.
export function replaceCaptionText(captions, options) {
  let next;
  const result = inspectReplacement(captions, options, (caption, index, text) => {
    next ||= captions.slice();
    next[index] = { ...caption, text };
  });
  return { captions: next || captions, ...result };
}
