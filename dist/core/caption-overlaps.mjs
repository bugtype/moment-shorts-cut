import { captionOccurrences } from '../captions.mjs';
import { message as msg } from '../i18n.mjs';
import { fail } from './validation.mjs';

// Report affected output occurrences, not every pair or a change to renderer priority.
export function inspectCaptionOverlaps(project, { limit = 20 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        fail(msg('errors.inspectionLimit'), 'arguments.limit');
    const occurrences = captionOccurrences(project.captions, project.clips, project.speed);
    const representatives = captionOverlapWitnesses(occurrences);
    const issues = [];
    for (let index = 0; index < occurrences.length && issues.length < limit; index++) {
        if (!representatives.has(index)) continue;
        const otherIndex = representatives.get(index), current = occurrences[index], other = occurrences[otherIndex];
        issues.push({
            occurrenceIndex: index, captionIndex: current.captionIndex,
            ...(current.clipIndex === undefined ? {} : { clipIndex: current.clipIndex }),
            start: current.start, end: current.end,
            otherOccurrenceIndex: otherIndex, otherCaptionIndex: other.captionIndex,
            ...(other.clipIndex === undefined ? {} : { otherClipIndex: other.clipIndex }),
            otherStart: other.start, otherEnd: other.end,
            overlapStart: Math.max(current.start, other.start), overlapEnd: Math.min(current.end, other.end),
        });
    }
    return {
        metric: 'output-time-overlap', totalOccurrences: occurrences.length,
        flaggedOccurrences: representatives.size, omittedOccurrences: Math.max(0, representatives.size - issues.length), issues,
    };
}

// Shared deterministic witnesses; no pair expansion or output truncation.
export function captionOverlapWitnesses(occurrences) {
    const representatives = new Map();
    let longest = -1;
    for (let index = 0; index < occurrences.length; index++) {
        const current = occurrences[index];
        if (!Number.isFinite(current.start) || !Number.isFinite(current.end) || !(current.end > current.start))
            fail(msg('errors.inspectionPrecision', { index: index + 1 }), `project.captions[${current.captionIndex}]`);
        if (longest >= 0 && current.start < occurrences[longest].end) {
            // Earliest prior maximum-end witness (ties retain occurrence order).
            representatives.set(index, longest);
            if (!representatives.has(longest)) representatives.set(longest, index);
        }
        if (longest < 0 || current.end > occurrences[longest].end) longest = index;
    }
    return representatives;
}
