import { LocalizedError } from './core/validation.mjs';
import { message as msg } from './i18n.mjs';
const captionSegmenter=typeof globalThis.Intl?.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
function trimGraphemes(parts) {
  let start=0,end=parts.length;
  while(start<end&&/^\s+$/u.test(parts[start]))start++;
  while(end>start&&/^\s+$/u.test(parts[end-1]))end--;
  return parts.slice(start,end);
}
// Text offsets use textarea UTF-16 positions; time estimates use whole graphemes.
export function splitCaptionAtOffset(caption, textOffset) {
  if (!captionSegmenter) throw new LocalizedError(msg('errors.safeSplit'));
  if (!Number.isInteger(textOffset) || textOffset <= 0 || textOffset >= caption.text.length)
    throw new LocalizedError(msg('errors.splitCaret'));
  const segments = Array.from(captionSegmenter.segment(caption.text));
  const index = segments.findIndex(segment => segment.index === textOffset);
  if (index < 1) throw new LocalizedError(msg('errors.splitBoundary'));
  const left = caption.text.slice(0, textOffset), right = caption.text.slice(textOffset);
  if (!left.trim() || !right.trim()) throw new LocalizedError(msg('errors.splitEmpty'));
  const split = caption.start + (caption.end - caption.start) * index / segments.length;
  if (!(split > caption.start && split < caption.end)) throw new LocalizedError(msg('errors.splitPrecision'));
  return [{ ...caption, text: left, end: split, timing: 'estimated' },
    { ...caption, text: right, start: split, timing: 'estimated' }];
}
export function splitCaptionText(caption, limit = 18) {
  if(!captionSegmenter)throw new LocalizedError(msg('errors.safeSplit'));
  limit = Math.max(1, Math.floor(Number(limit) || 18));
  const text = trimGraphemes(Array.from(captionSegmenter.segment(caption.text),item=>item.segment));
  if (!text.length || text.length <= limit) return [caption];
  const pieces = []; let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf(' ', limit);
    if (cut < limit * .45) cut = limit;
    const part=trimGraphemes(rest.slice(0,cut));
    if(part.length)pieces.push(part);
    rest=trimGraphemes(rest.slice(cut));
  }
  if (rest.length) pieces.push(rest);
  const weight = pieces.reduce((n, part) => n + part.length, 0);
  let cursor = caption.start;
  return pieces.map((part, index) => {
    const end = index === pieces.length - 1 ? caption.end : cursor + (caption.end - caption.start) * part.length / weight;
    const result = { ...caption, text: part.join(''), start: cursor, end, timing: 'estimated' }; cursor = end; return result;
  });
}
