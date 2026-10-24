import { message as msg } from '../i18n.mjs';
import { fail } from './validation.mjs';

// Correct authored text only: timing, ownership and metadata remain untouched.
// String splitting is intentional: regex and replacement-token syntax are not used.
export function replaceCaptionText(captions, { find, replacement }) {
  if (typeof find !== 'string' || !find.length || find.length > 2000)
    fail(msg('errors.findLength'), 'arguments.find');
  if (typeof replacement !== 'string' || replacement.length > 2000)
    fail(msg('errors.replacementLength'), 'arguments.replacement');
  let matches = 0, changedCaptions = 0;
  const next = captions.map((caption, index) => {
    const parts = caption.text.split(find), count = parts.length - 1;
    matches += count;
    if (!count || find === replacement) return caption;
    // Check size before joining to avoid allocating an oversized replacement.
    const length = caption.text.length + count * (replacement.length - find.length);
    if (length > 2000) fail(msg('errors.replacedTooLong'), `project.captions[${index}].text`);
    const text = parts.join(replacement);
    if (!text.trim()) fail(msg('errors.replacedEmpty'), `project.captions[${index}].text`);
    changedCaptions++;
    return { ...caption, text };
  });
  return { captions: changedCaptions ? next : captions, matches, changedCaptions };
}
