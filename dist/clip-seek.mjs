import { buildTimelineEntries, locateTimelineEntry } from './timeline-index.mjs';

// UI navigation only: keep authored times and the historical lookup arithmetic.
// Different floating-point prefix sums can land in the preceding occurrence.
export function clipSeekTime(clips, index, preferred) {
    if (!Number.isInteger(index) || index < 0 || index >= clips.length) return null;
    const { entries, total } = buildTimelineEntries(clips);
    const entry = entries[index], clip = entry.clip;
    const valid = time => {
        if (!Number.isFinite(time) || time < 0 || time >= total) return false;
        const position = locateTimelineEntry(entries, time);
        return position.index === index && position.source >= clip.start && position.source < clip.end;
    };
    const target = preferred === undefined ? entry.offset : preferred;
    if (valid(target)) return target;
    // Match the locator's threshold, rather than adding an arbitrary epsilon.
    const previous = entries[index - 1];
    const boundary = previous ? previous.offset + previous.clip.end - previous.clip.start : 0;
    return valid(boundary) ? boundary : null;
}
