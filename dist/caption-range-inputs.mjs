import { setValidity } from './i18n.mjs';

// Read one-based authored caption rows; each dialog owns lifecycle and actions.
export function readCaptionRangeInputs(first, last, project) {
    const start = first.value.trim() === '' ? NaN : Number(first.value);
    const end = last.value.trim() === '' ? NaN : Number(last.value);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > project.captions.length) {
        setValidity(first, 'panels.captionRangeInvalid', { total: project.captions.length });
        first.reportValidity?.();
        first.focus();
        return;
    }
    return { start, end };
}
