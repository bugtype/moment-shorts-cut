import { message as msg } from '../i18n.mjs';
import {captionOccurrences} from '../captions.mjs';
import { captionOverlapWitnesses } from './caption-overlaps.mjs';
import {fail} from './validation.mjs';

function countNonWhitespaceGraphemes(segmenter, text) {
  let count = 0;
  for (const { segment } of segmenter.segment(text)) if (!/^\s+$/u.test(segment)) count++;
  return count;
}

// A review metric, not a language-specific delivery standard or speech alignment.
export function inspectCaptions(project, {maxGraphemesPerSecond, limit = 20}) {
  if (!Number.isFinite(maxGraphemesPerSecond) || maxGraphemesPerSecond <= 0)
    fail(msg('errors.inspectionThreshold'), 'arguments.maxGraphemesPerSecond');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    fail(msg('errors.inspectionLimit'), 'arguments.limit');
  if (typeof globalThis.Intl?.Segmenter !== 'function')
    fail(msg('errors.graphemesUnavailable'));
  const segmenter = new Intl.Segmenter(undefined, {granularity: 'grapheme'});
  const occurrences = captionOccurrences(project.captions, project.clips, project.speed);
  const counts = new Map(), issues = [];
  for (const [occurrenceIndex, occurrence] of occurrences.entries()) {
    const {captionIndex, clipIndex, start, end, text} = occurrence;
    if (!counts.has(captionIndex)) {
      const count = countNonWhitespaceGraphemes(segmenter, text);
      counts.set(captionIndex, count);
    }
    const graphemeCount = counts.get(captionIndex), duration = end - start;
    const graphemesPerSecond = graphemeCount / duration;
    if (!(duration > 0) || !Number.isFinite(duration) || !Number.isFinite(graphemesPerSecond))
      fail(msg('errors.inspectionPrecision',{index:occurrenceIndex+1}), `project.captions[${captionIndex}]`);
    if (graphemesPerSecond > maxGraphemesPerSecond) issues.push({
      occurrenceIndex, captionIndex, ...(clipIndex === undefined ? {} : {clipIndex}),
      start, end, graphemeCount, graphemesPerSecond,
    });
  }
  issues.sort((a, b) => b.graphemesPerSecond - a.graphemesPerSecond || a.start - b.start || a.occurrenceIndex - b.occurrenceIndex);
  return {
    metric: 'non-whitespace-graphemes-per-second', maxGraphemesPerSecond,
    totalOccurrences: occurrences.length, flaggedOccurrences: issues.length,
    omittedOccurrences: Math.max(0, issues.length - limit), issues: issues.slice(0, limit),
  };
}

// Opt-in combined review. The legacy rate-only report above keeps its ordering and shape.
export function inspectCaptionReview(project, { review, limit = 20 }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    fail(msg('errors.inspectionLimit'), 'arguments.limit');
  const { maxGraphemesPerSecond, minDuration, maxDuration, includeOverlaps = true, filter = 'all' } = review;
  const thresholds = { includeOverlaps };
  for (const key of ['maxGraphemesPerSecond', 'minDuration', 'maxDuration']) {
    if (!Object.hasOwn(review, key)) continue;
    const value = review[key];
    if (!Number.isFinite(value) || value <= 0)
      fail(msg(key === 'maxGraphemesPerSecond' ? 'errors.inspectionThreshold' : 'errors.inspectionDuration'), `arguments.review.${key}`);
    thresholds[key] = value;
  }
  if (minDuration !== undefined && maxDuration !== undefined && minDuration > maxDuration)
    fail(msg('errors.inspectionDurationOrder'), 'arguments.review.maxDuration');
  if (!includeOverlaps && Object.keys(thresholds).length === 1)
    fail(msg('errors.inspectionChecks'), 'arguments.review');
  let segmenter;
  if (maxGraphemesPerSecond !== undefined) {
    if (typeof globalThis.Intl?.Segmenter !== 'function') fail(msg('errors.graphemesUnavailable'));
    segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  }
  const occurrences = captionOccurrences(project.captions, project.clips, project.speed);
  const witnesses = includeOverlaps ? captionOverlapWitnesses(occurrences) : new Map();
  const graphemes = new Map(), flagged = new Set(), issues = [];
  const counts = { readingSpeed: 0, tooShort: 0, tooLong: 0, overlap: 0 };
  let matchedFindings = 0;
  function finding(kind, countKey, base, evidence) {
    counts[countKey]++;
    flagged.add(base.occurrenceIndex);
    if (filter !== 'all' && filter !== kind) return;
    matchedFindings++;
    if (issues.length < limit) issues.push({ kind, ...base, ...evidence });
  }
  for (const [occurrenceIndex, occurrence] of occurrences.entries()) {
    const { captionIndex, clipIndex, start, end, text } = occurrence;
    const base = { occurrenceIndex, captionIndex, ...(clipIndex === undefined ? {} : { clipIndex }), start, end };
    const duration = end - start;
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(duration) || !(duration > 0))
      fail(msg('errors.inspectionPrecision', { index: occurrenceIndex + 1 }), `project.captions[${captionIndex}]`);
    if (segmenter) {
      if (!graphemes.has(captionIndex)) {
        const count = countNonWhitespaceGraphemes(segmenter, text);
        graphemes.set(captionIndex, count);
      }
      const graphemeCount = graphemes.get(captionIndex), graphemesPerSecond = graphemeCount / duration;
      if (!Number.isFinite(graphemesPerSecond))
        fail(msg('errors.inspectionPrecision', { index: occurrenceIndex + 1 }), `project.captions[${captionIndex}]`);
      if (graphemesPerSecond > maxGraphemesPerSecond)
        finding('reading-speed', 'readingSpeed', base, { graphemeCount, graphemesPerSecond });
    }
    if (minDuration !== undefined && duration < minDuration) finding('too-short', 'tooShort', base, { duration });
    if (maxDuration !== undefined && duration > maxDuration) finding('too-long', 'tooLong', base, { duration });
    if (witnesses.has(occurrenceIndex)) {
      const otherOccurrenceIndex = witnesses.get(occurrenceIndex), other = occurrences[otherOccurrenceIndex];
      finding('overlap', 'overlap', base, {
        otherOccurrenceIndex, otherCaptionIndex: other.captionIndex,
        ...(other.clipIndex === undefined ? {} : { otherClipIndex: other.clipIndex }),
        otherStart: other.start, otherEnd: other.end,
        overlapStart: Math.max(start, other.start), overlapEnd: Math.min(end, other.end),
      });
    }
  }
  return {
    metric: 'caption-review', thresholds, filter, totalOccurrences: occurrences.length,
    flaggedOccurrences: flagged.size, counts,
    totalFindings: Object.values(counts).reduce((sum, count) => sum + count, 0),
    matchedFindings, omittedFindings: Math.max(0, matchedFindings - limit), issues,
  };
}
