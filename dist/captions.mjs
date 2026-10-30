import { LocalizedError } from './core/validation.mjs';
import { message as msg } from './i18n.mjs';
import { CommandError } from './core/validation.mjs';

export const MAX_CAPTIONS = 10000;
export const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;
const encoder = new TextEncoder();
export function captionOutputLimit(message) {
  throw new CommandError('CAPTION_OUTPUT_LIMIT', message, 'project.captions');
}

// Source speech follows clips; added narration follows the edited audio timeline.
// Both clocks are stored before playback speed, so retiming stays reversible.
export function captionClock(caption, sourceTime, timelineTime) {
  return caption.basis === 'timeline' ? timelineTime : sourceTime;
}
export function findCaption(captions, sourceTime, timelineTime) {
  return captions.find(caption => {
    const time = captionClock(caption, sourceTime, timelineTime);
    return time >= caption.start && time < caption.end;
  });
}
// Narrow overlap checks without caching mutable project data. Candidate order is
// restored before append so equal-time ties and output-limit failures stay stable.
function sourceCaptionLookup(sourceCaptions, clipCount) {
  if (clipCount < 2 || sourceCaptions.some(([, cap]) =>
    !Number.isFinite(cap.start) || !Number.isFinite(cap.end)))
    return () => sourceCaptions;
  const sorted = [...sourceCaptions].sort((a, b) => a[1].start - b[1].start || a[0] - b[0]);
  const authoredOrder = sorted.every(([index], position) => index === sourceCaptions[position][0]);
  const blockSize = 32;
  let blockEnds, maximumEnd = -Infinity;
  const ends = sorted.map(([, cap]) => maximumEnd = Math.max(maximumEnd, cap.end));
  function firstMatch(predicate) {
    let low = 0, high = sorted.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (predicate(middle)) high = middle;
      else low = middle + 1;
    }
    return low;
  }
  return clip => {
    // Raw helper callers historically use Math.min/max coercion. Keep that path
    // for non-finite/non-number bounds instead of changing their behavior.
    if (!Number.isFinite(clip.start) || !Number.isFinite(clip.end)) return sourceCaptions;
    const first = firstMatch(index => ends[index] > clip.start);
    const last = firstMatch(index => sorted[index][1].start >= clip.end);
    const count = Math.max(0, last - first);
    let candidates;
    if (count > blockSize) {
      // Build only for broad windows, and only within this projection call.
      // A later edit must never reuse metadata by mutable array identity.
      if (!blockEnds) {
        blockEnds = [];
        for (let index = 0; index < sorted.length; index++) {
          const block = Math.floor(index / blockSize);
          blockEnds[block] = Math.max(blockEnds[block] ?? -Infinity, sorted[index][1].end);
        }
      }
      const ranges = []; let candidateCount = 0;
      for (let index = first; index < last;) {
        const block = Math.floor(index / blockSize), end = Math.min(last, (block + 1) * blockSize);
        // Ended blocks cannot contain a cue overlapping this clip.
        if (blockEnds[block] > clip.start) { ranges.push([index, end]); candidateCount += end - index; }
        index = end;
      }
      if (candidateCount !== count) {
        if (!authoredOrder && candidateCount * Math.log2(Math.max(2, candidateCount)) >= sourceCaptions.length)
          return sourceCaptions;
        candidates = [];
        for (const [start, end] of ranges) for (let index = start; index < end; index++) candidates.push(sorted[index]);
      }
    }
    if (!candidates) {
      // Keep the original cheap slice/linear path when blocks did not narrow it.
      if (!authoredOrder && count * Math.log2(Math.max(2, count)) >= sourceCaptions.length)
        return sourceCaptions;
      candidates = sorted.slice(first, last);
    }
    return authoredOrder ? candidates : candidates.sort((a, b) => a[0] - b[0]);
  };
}

export function captionOccurrences(captions, clips, speed = 1) {
  const out = []; let offset = 0, bytes = 0;
  const textBytes = new Map();
  function append(cap, captionIndex, start, end, clipIndex) {
    if (out.length >= MAX_CAPTIONS) captionOutputLimit(msg('errors.derivedCount'));
    if (!textBytes.has(captionIndex)) {
      if (cap.text.length > MAX_SUBTITLE_BYTES) captionOutputLimit(msg('errors.derivedBytes'));
      textBytes.set(captionIndex, encoder.encode(cap.text).byteLength);
    }
    bytes += textBytes.get(captionIndex);
    if (bytes > MAX_SUBTITLE_BYTES) captionOutputLimit(msg('errors.derivedBytes'));
    out.push({start:start/speed,end:end/speed,text:cap.text,captionIndex,...(clipIndex === undefined ? {} : {clipIndex})});
  }
  const sourceCaptions = [...captions.entries()].filter(([, cap]) => cap.basis !== 'timeline');
  const candidates = sourceCaptionLookup(sourceCaptions, clips.length);
  for (const [clipIndex, clip] of clips.entries()) {
    for (const [captionIndex, cap] of candidates(clip)) {
      const start = Math.max(clip.start, cap.start), end = Math.min(clip.end, cap.end);
      if (end > start) append(cap,captionIndex,offset+start-clip.start,offset+end-clip.start,clipIndex);
    }
    offset += clip.end - clip.start;
  }
  for (const [captionIndex, cap] of captions.entries()) if (cap.basis === 'timeline') {
    const start = Math.max(0, cap.start), end = Math.min(offset, cap.end);
    if (end > start) append(cap,captionIndex,start,end);
  }
  return out.sort((a,b) => a.start-b.start);
}
export function editedCaptions(captions, clips, speed = 1) {
  return captionOccurrences(captions, clips, speed).map(({start,end,text}) => ({start,end,text}));
}
export function mapAudioCaptions(captions, offset, total) {
  return captions.map(cap => ({...cap,basis:'timeline',start:Math.max(0,cap.start+offset),end:Math.min(total,cap.end+offset)}))
    .filter(cap => cap.end>cap.start);
}

// File size is checked before reading in the UI; keep the parser bounded for callers too.
const subtitleReferences = {amp:'&',lt:'<',gt:'>',lrm:'\u200e',rlm:'\u200f',nbsp:'\u00a0'};
function decodeSubtitleReference(literal, reference) {
  if (reference[0] !== '#') return subtitleReferences[reference];
  const hex = reference[1] === 'x' || reference[1] === 'X';
  const code = Number.parseInt(reference.slice(hex ? 2 : 1), hex ? 16 : 10);
  // A conservative scalar subset, not HTML error repair or control remapping.
  // Keep unsupported spellings literal rather than introducing line structure.
  if (code < 0x20 || code > 0x10ffff || (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 || code === 0x2029 || (code >= 0xd800 && code <= 0xdfff) ||
      (code >= 0xfdd0 && code <= 0xfdef) || (code & 0xffff) >= 0xfffe) return literal;
  return String.fromCodePoint(code);
}
export function parseSubtitles(text, duration) {
  return parseSubtitlesWithReport(text, duration).captions;
}

// Counts describe this permissive parser’s recognized entries, not all file cues.
export function parseSubtitlesWithReport(text, duration) {
  if (typeof text !== 'string' || text.length > MAX_SUBTITLE_BYTES || encoder.encode(text).byteLength > MAX_SUBTITLE_BYTES) throw new LocalizedError(msg('errors.subtitleFileLimit'));
  if (!Number.isFinite(duration) || duration <= 0) throw new LocalizedError(msg('errors.videoDuration'));
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  // An empty first payload line ends the cue; never absorb the next cue's timing.
  // End fractions must be complete: never truncate a fourth digit as settings.
  const pattern = /^(?:(\d+):)?([0-5]\d):([0-5]\d)[,.](\d{3})[ \t]*-->[ \t]*(?:(\d+):)?([0-5]\d):([0-5]\d)[,.](\d{3})(?!\d)[^\n]*\n(?![ \t]*(?:\n|$))([\s\S]*?)(?=\n[ \t]*\n|(?![\s\S]))/gm;
  const captions = [];
  let clippedCaptions = 0, discardedRecognizedEntries = 0;
  for (const match of normalized.matchAll(pattern)) {
    const start = (+match[1] || 0) * 3600 + (+match[2]) * 60 + (+match[3]) + (+match[4]) / 1000;
    const rawEnd = (+match[5] || 0) * 3600 + (+match[6]) * 60 + (+match[7]) + (+match[8]) / 1000;
    const end = Math.min(rawEnd, duration);
    // Remove structural/boundary blank lines, not spacing on nonblank text lines.
    // Markup-only wrapping lines retain their existing normalization. Check empty
    // payloads before decoding so an explicit &nbsp; keeps its existing meaning.
    // Consume an unclosed tail once but retain it literally, instead of retrying
    // the tag scan at every remaining '<' before the cue-length check.
    const lines = match[9].replace(/<[^>]*(?:>|$)/g,
      tag => tag.endsWith('>') ? '' : tag).split('\n');
    let first = 0, last = lines.length;
    while (first < last && !lines[first].trim()) first++;
    while (last > first && !lines[last - 1].trim()) last--;
    if (first === last || !Number.isFinite(start) || !Number.isFinite(rawEnd) || end <= start) {
      discardedRecognizedEntries++;
      continue;
    }
    // Decode once after removing markup, so escaped literal tags remain text.
    const text = lines.slice(first, last).join('\n')
      .replace(/&(amp|lt|gt|lrm|rlm|nbsp|#\d+|#[xX][\da-fA-F]+);/g, decodeSubtitleReference);
    if (text.length > 2000) throw new LocalizedError(msg('errors.cueLength'));
    if (captions.length >= MAX_CAPTIONS) throw new LocalizedError(msg('errors.captionLimit'));
    captions.push({start, end, text});
    if (rawEnd > duration) clippedCaptions++;
  }
  if (!captions.length) throw new LocalizedError(msg('errors.noSubtitles'));
  return {captions, report: {acceptedCaptions: captions.length, clippedCaptions, discardedRecognizedEntries}};
}
