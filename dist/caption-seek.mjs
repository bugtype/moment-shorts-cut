import {buildTimelineEntries, locateTimelineEntry} from './timeline-index.mjs';

// UI navigation only: preserve authored/exported times and renderer priority.
// A rounded output-to-timeline or timeline-to-source boundary can precede a cue.
export function captionSeekTime(project, occurrence, preferred) {
    const targets = [{captionIndex:occurrence.captionIndex, clipIndex:occurrence.clipIndex}];
    if (occurrence.otherCaptionIndex !== undefined)
        targets.push({captionIndex:occurrence.otherCaptionIndex, clipIndex:occurrence.otherClipIndex});
    const captions = targets.map(target => project.captions[target.captionIndex]);
    if (captions.some(caption => !caption)) return null;
    const {entries, total} = buildTimelineEntries(project.clips);
    if (!entries.length || !(total > 0)) return null;
    let clipIndex;
    for (const [index, caption] of captions.entries()) if (caption.basis !== 'timeline') {
        const requested = targets[index].clipIndex;
        if (!Number.isInteger(requested) || !entries[requested] ||
            (clipIndex !== undefined && clipIndex !== requested)) return null;
        clipIndex = requested;
    }
    function clocks(t) {
        const position = locateTimelineEntry(entries, t);
        return {position, times:captions.map(caption => caption.basis === 'timeline'
            ? t / project.speed * project.speed : position.source)};
    }
    function valid(t) {
        if (!Number.isFinite(t) || t < 0 || t >= total) return false;
        const {position, times} = clocks(t);
        if (clipIndex !== undefined && (position.index !== clipIndex ||
            position.source >= entries[clipIndex].clip.end)) return false;
        return captions.every((caption, index) => times[index] >= caption.start &&
            times[index] < caption.end && (caption.basis !== 'timeline' || times[index] < total));
    }
    if (valid(preferred)) return preferred;
    // This lower-bound predicate is monotone, including outside the chosen clip.
    function reached(t) {
        const {position, times} = clocks(t);
        if (clipIndex !== undefined && position.index !== clipIndex) return position.index > clipIndex;
        return captions.every((caption, index) => times[index] >= caption.start);
    }
    if (reached(0)) return valid(0) ? 0 : null;
    let low = 0, high = total;
    if (!reached(high)) return null;
    // Stop at adjacent representable values, not an epsilon that could skip a
    // short cue. Normal targets take the fast path; this search never edits them.
    while (true) {
        const middle = low + (high - low) / 2;
        if (middle === low || middle === high) break;
        if (reached(middle)) high = middle;
        else low = middle;
    }
    return valid(high) ? high : null;
}
