import { assertUnicodeText } from './unicode-text.mjs';
import { t, message } from '../i18n.mjs';
import { captionOccurrences, MAX_SUBTITLE_BYTES, captionOutputLimit } from '../captions.mjs';
import { fail } from './validation.mjs';

// A human-readable inventory of edited occurrences, not a subtitle import format
// or a claim about which overlapping cue the renderer displays.
export function projectCaptionReview(project, { bom = false, captionIndexOffset = 0 } = {}) {
  const occurrences = captionOccurrences(project.captions, project.clips, project.speed);
  if (!occurrences.length) return '';
  const encoder = new TextEncoder();
  const chunks = [];
  let bytes = bom ? 3 : 0;
  function append(text) {
    bytes += encoder.encode(text).byteLength;
    if (bytes > MAX_SUBTITLE_BYTES) captionOutputLimit(message('review.limit'));
    chunks.push(text);
  }
  append(`${t('review.heading')}\n${t('review.clock')}\n${t('review.occurrences')}\n`);
  for (const [index, occurrence] of occurrences.entries()) {
    const caption = project.captions[occurrence.captionIndex];
    const label = ['0', '1'].includes(caption.speaker) ? project.speakerLabels[Number(caption.speaker)] : '';
    const text = occurrence.text.replace(/\r\n?/g, '\n');
    const name = label.replace(/\r\n?/g, '\n');
    if (text.includes('\0') || name.includes('\0')) fail(message('review.nul', { index: index + 1 }));
    // The exporter may select a contiguous authored range before projection.
    assertUnicodeText(text, `project.captions[${captionIndexOffset + occurrence.captionIndex}].text`);
    assertUnicodeText(name, `project.speakerLabels[${caption.speaker}]`);
    const lines = [`[${index + 1}]`, t('review.time', {
      start: String(occurrence.start), end: String(occurrence.end),
    })];
    if (name.length) lines.push(t('review.speaker', { name }));
    lines.push(text);
    append(`\n${lines.join('\n')}\n`);
  }
  return (bom ? '\ufeff' : '') + chunks.join('');
}
