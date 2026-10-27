// Pure pre-speed timeline mapping. The app owns cache identity and invalidation.
// Entries retain authored clip references; no validation, rounding or clock conversion.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function buildTimelineEntries(clips) {
    let total = 0;
    const entries = clips.map((clip, index) => {
        const entry = { clip, index, offset: total };
        total += clip.end - clip.start;
        return entry;
    });
    return { entries, total };
}

export function locateTimelineEntry(entries, t) {
    let low = 0, high = entries.length - 1;
    while (low < high) {
        const middle = (low + high) >> 1, entry = entries[middle];
        if (t < entry.offset + entry.clip.end - entry.clip.start)
            high = middle;
        else
            low = middle + 1;
    }
    const entry = entries[low];
    return {
        index: entry.index,
        source: entry.clip.start + clamp(t - entry.offset, 0, entry.clip.end - entry.clip.start),
        offset: entry.offset,
    };
}
