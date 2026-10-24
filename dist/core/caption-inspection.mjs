import {captionOccurrences} from '../captions.mjs';
import {fail} from './validation.mjs';

// A review metric, not a language-specific delivery standard or speech alignment.
export function inspectCaptions(project, {maxGraphemesPerSecond, limit = 20}) {
  if (!Number.isFinite(maxGraphemesPerSecond) || maxGraphemesPerSecond <= 0)
    fail('검사 기준은 0보다 큰 유한한 숫자로 입력하세요.', 'arguments.maxGraphemesPerSecond');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    fail('결과 개수는 1~100 사이 정수로 입력하세요.', 'arguments.limit');
  if (typeof globalThis.Intl?.Segmenter !== 'function')
    fail('이 환경은 안전한 문자 수 검사를 지원하지 않습니다. 최신 실행 환경에서 다시 시도하세요.');
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
      fail(`출력 자막 ${occurrenceIndex + 1}의 표시 시간이 너무 작아 읽기 속도를 계산할 수 없습니다.`, `project.captions[${captionIndex}]`);
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
