import { message as msg } from '../i18n.mjs';
import {captionOccurrences} from '../captions.mjs';
import {fail} from './validation.mjs';

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
      let count = 0;
      for (const {segment} of segmenter.segment(text)) if (!/^\s+$/u.test(segment)) count++;
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
