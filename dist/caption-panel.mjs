import { setText, setValidity, formatError, message } from './i18n.mjs';
import { shiftCaptionTiming } from './core/caption-timing.mjs';
import { createCaptionSearch } from './caption-search.mjs';
import { MAX_CAPTIONS } from './captions.mjs';
import { splitCaptionText } from './effects.mjs';
import { CAPTION_PAGE_SIZE, captionsPanelMarkup } from './panel-markup.mjs';

export function createCaptionPanel({
    query: $, queryAll: $$, getProject, getDuration, sourceTime, edit, refresh, toast, execute, inspect, view, overlaps, removeRange, shiftRange, splitRange, speakerRange, replaceRange, exportRange, importFile, blocked = () => false,
}) {
    const timingFields = { basis: 'source', delta: '0' };
    let exportFormat = 'srt', exportScope = 'all';
    let page = 0, composing = false, renderGeneration = 0;
    const lastPage = () => Math.max(0, Math.ceil(getProject().captions.length / CAPTION_PAGE_SIZE) - 1);
    const search = createCaptionSearch({query:$,getProject,focusCaption,edit,execute,toast,
        blocked: () => composing || blocked(),
        replaceRange: options => replaceRange?.({...options,index:options.index ?? page * CAPTION_PAGE_SIZE})});
    function shiftTiming() {
        if (composing) return;
        try {
            if (!timingFields.delta.trim()) throw Object.assign(new Error(), message('panels.enterShift'));
            const project = getProject(), basis = timingFields.basis;
            const result = shiftCaptionTiming(project.captions, { basis, delta: Number(timingFields.delta) },
                basis === 'source' ? project.duration : getDuration());
            if (!result.shiftedCaptions) return;
            let applied = false;
            edit(() => { getProject().captions = result.captions; applied = true; }, true);
            if (!applied) return;
            $('#shiftCaptionTiming').focus({ preventScroll: true });
            toast(message('panels.shifted', {count:result.shiftedCaptions}));
        } catch (error) { toast(error.messageKey ? error : formatError(error)); }
    }
    function splitLongCaptions() {
        const limit = Number($('#captionChunkSize').value), captions = [];
        try {
            for (const caption of getProject().captions) {
                const parts = splitCaptionText(caption, limit);
                if (captions.length + parts.length > MAX_CAPTIONS) {
                    toast(message('panels.captionLimit'));
                    return;
                }
                captions.push(...parts);
            }
        }
        catch (error) {
            toast(error.messageKey ? error : formatError(error));
            return;
        }
        const original = getProject().captions;
        const unchanged = captions.length === original.length && captions.every((caption, i) =>
            caption === original[i] || JSON.stringify(caption) === JSON.stringify(original[i]));
        if (unchanged) {
            toast(message('panels.nothingToSplit'));
            return;
        }
        let applied = false;
        edit(() => { getProject().captions = captions; applied = true; }, true);
        if (!applied) return;
        $('#splitLongCaptions').focus();
        toast(message('panels.splitComplete'));
    }
    function render(target, status, actions) {
        const generation = ++renderGeneration;
        composing = false; // External replacement detaches the previous composition owner.
        const toolsOpen = target.querySelector('#captionTools')?.open;
        page = Math.min(page, lastPage());
        target.innerHTML = captionsPanelMarkup(getProject(), { toolsOpen, ...status, page });
        // Click follows the native blur/change boundary; never replace rows on mousedown.
        for (const [id, delta] of [['previousCaptionPage', -1], ['nextCaptionPage', 1]]) {
            $('#' + id).onclick = () => {
                if (composing) return;
                const next = Math.max(0, Math.min(lastPage(), page + delta));
                if (next === page) return;
                page = next;
                refresh();
                const preferred = $('#' + id);
                const alternate = $('#' + (delta > 0 ? 'previousCaptionPage' : 'nextCaptionPage'));
                const focusTarget = getProject().captions.length <= CAPTION_PAGE_SIZE
                    ? ($('#captionRows') || $('#addCaption'))
                    : (!preferred.disabled ? preferred : alternate);
                focusTarget.focus({ preventScroll: true });
            };
        }
        const pageInput = $('#captionPageNumber');
        pageInput.value = String(page + 1);
        const jumpPage = () => {
            if (composing || getProject().captions.length <= CAPTION_PAGE_SIZE) return;
            const value = pageInput.value.trim(), number = Number(value), total = lastPage() + 1;
            if (!value || !Number.isInteger(number) || number < 1 || number > total) {
                setValidity(pageInput, 'panels.pageInvalid', { total });
                pageInput.reportValidity?.();
                pageInput.focus({ preventScroll: true });
                return;
            }
            setValidity(pageInput, '');
            focusCaption((number - 1) * CAPTION_PAGE_SIZE);
        };
        pageInput.oninput = () => setValidity(pageInput, '');
        pageInput.onkeydown = event => {
            if (event.key !== 'Enter' || composing || event.isComposing || event.keyCode === 229 ||
                event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
                getProject().captions.length <= CAPTION_PAGE_SIZE) return;
            event.preventDefault();
            jumpPage();
        };
        $('#goCaptionPage').onclick = jumpPage;
        $('#removeCaptionRange').onclick = event => {
            if (!composing && !event?.isComposing && event?.keyCode !== 229) removeRange?.(page * CAPTION_PAGE_SIZE);
        };
        target.oncompositionstart = () => { if (generation === renderGeneration) composing = true; };
        target.oncompositionend = () => { if (generation === renderGeneration) composing = false; };
        search.bind();
        for (const [id, key] of [['captionShiftBasis', 'basis'], ['captionShiftDelta', 'delta']]) {
            const field = $('#' + id);
            field.value = timingFields[key];
            field.onchange = () => { timingFields[key] = field.value; };
        }
        $('#shiftCaptionTiming').onclick = shiftTiming;
        $('#shiftCaptionRange').onclick = event => {
            if (!composing && !event?.isComposing && event?.keyCode !== 229) shiftRange?.(page * CAPTION_PAGE_SIZE);
        };
        $('#assignSpeakerRange').onclick = event => {
            if (!composing && !event?.isComposing && event?.keyCode !== 229) speakerRange?.(page * CAPTION_PAGE_SIZE);
        };
        $('#captionDesignShortcut').onclick = actions.design;
        $('#inspectCaptionOverlaps').onclick = event => { if (!composing && !event?.isComposing && event?.keyCode !== 229) overlaps(); };
        $('#inspectCaptions').onclick = () => { if (!composing) inspect(); };
        $('#splitLongCaptions').onclick = splitLongCaptions;
        const splitRangeButton = $('#splitCaptionRange');
        splitRangeButton.onclick = event => {
            if (!composing && !blocked() && !event?.isComposing && event?.keyCode !== 229 &&
                $('#splitCaptionRange') === splitRangeButton)
                splitRange?.(page * CAPTION_PAGE_SIZE, Number($('#captionChunkSize').value));
        };
        $$('[data-caption-keywords]').forEach(el => el.onchange = () => edit(() => getProject().captions[+el.dataset.captionKeywords].keywords = el.value));
        $$('[data-caption-speaker]').forEach(el => el.onchange = () => edit(() => getProject().captions[+el.dataset.captionSpeaker].speaker = el.value));
        $('#generateCaptions').onclick = actions.generate;
        $('#addCaption').onclick = () => {
            if (composing) return;
            if (getProject().captions.length >= MAX_CAPTIONS) {
                toast(message('panels.captionLimit'));
                return;
            }
            const project = getProject(), captionIndex = project.captions.length;
            const captionTime = Math.min(sourceTime(), Math.max(0, project.duration - .1));
            const caption = { start: captionTime, end: Math.min(project.duration, captionTime + 3), text: '새로운 자막을 입력하세요' };
            if (execute('captions.insert', { captionIndex, caption })) focusCaption(captionIndex);
        };
        $('#importSrt').onclick = event => {
            if (!composing && !event?.isComposing && event?.keyCode !== 229) importFile?.();
        };
        $('#captionExportFormat').value = exportFormat;
        $('#captionExportFormat').onchange = () => {
            const value = $('#captionExportFormat').value;
            if (['srt', 'vtt', 'txt', 'review-txt'].includes(value)) exportFormat = value;
        };
        $('#captionExportScope').value = exportScope;
        $('#captionExportScope').onchange = () => {
            const value = $('#captionExportScope').value;
            if (['all', 'range'].includes(value)) exportScope = value;
        };
        $('#downloadCaptions').onclick = event => {
            if (exportScope === 'all') return actions.download(exportFormat);
            if (!composing && !event?.isComposing && event?.keyCode !== 229)
                exportRange?.(exportFormat, page * CAPTION_PAGE_SIZE);
        };
        $$('[data-view-caption]').forEach(button => button.onclick = event => {
            if (!composing && !event?.isComposing && event?.keyCode !== 229 &&
                $(`[data-view-caption="${button.dataset.viewCaption}"]`) === button)
                view(+button.dataset.viewCaption);
        });
        $$('[data-split-caption]').forEach(button => button.onclick = () => {
            if (composing) return;
            const index = +button.dataset.splitCaption, input = $(`[data-caption-text="${index}"]`);
            if (!input || input.selectionStart !== input.selectionEnd) {
                toast(message('panels.chooseCaret'));
                return;
            }
            if (input.value !== getProject().captions[index]?.text) {
                toast(message('panels.finishTyping'));
                return;
            }
            if (execute('captions.split', { captionIndex: index, textOffset: input.selectionStart }))
                focusCaption(index + 1);
        });
        $$('[data-merge-caption]').forEach(button => button.onclick = () => {
            if (composing) return;
            const index = +button.dataset.mergeCaption;
            const result = execute('captions.merge', { captionIndex: index });
            if (result) focusCaption(index);
        });
        $$('[data-delete-caption]').forEach(b => b.onclick = () => {
            if (composing) return;
            const index = +b.dataset.deleteCaption;
            if (execute('captions.remove', { captionIndex: index }))
                focusCaption(Math.min(index, getProject().captions.length - 1));
        });
        $$('[data-caption-text]').forEach(el => el.onchange = () => {
            edit(() => getProject().captions[+el.dataset.captionText].text = el.value);
            search.update();
        });
        for (const side of ['start', 'end'])
            $$(`[data-caption-${side}]`).forEach(el => el.onchange = () => {
                const i = +el.dataset[side === 'start' ? 'captionStart' : 'captionEnd'];
                const c = getProject().captions[i], value = +el.value;
                if (!el.value.trim() || !Number.isFinite(value) || value < 0 ||
                    value > (c.basis === 'timeline' ? getDuration() : getProject().duration) ||
                    (side === 'start' ? value >= c.end : value <= c.start)) {
                    toast(message('panels.captionTimingInvalid'));
                    refresh();
                    return;
                }
                edit(() => c[side] = value);
            });
        // Detached controls no longer own the rendered row indices or pager state.
        const controls = [
            ...$$('[data-caption-text]'), ...$$('[data-caption-start]'), ...$$('[data-caption-end]'),
            ...$$('[data-view-caption]'), ...$$('[data-split-caption]'), ...$$('[data-merge-caption]'), ...$$('[data-caption-keywords]'), ...$$('[data-caption-speaker]'), ...$$('[data-delete-caption]'),
            ...['captionFind', 'captionReplacement', 'previousCaptionPage', 'nextCaptionPage',
                'captionPageNumber', 'goCaptionPage', 'previousCaptionMatch', 'nextCaptionMatch', 'replaceCaptionMatch', 'replaceAllCaptions', 'replaceCaptionRange', 'splitLongCaptions', 'splitCaptionRange',
                'addCaption', 'removeCaptionRange', 'importSrt', 'captionExportFormat', 'captionExportScope', 'downloadCaptions', 'generateCaptions',
                'inspectCaptionOverlaps', 'inspectCaptions', 'captionDesignShortcut', 'captionShiftBasis', 'captionShiftDelta', 'shiftCaptionTiming', 'shiftCaptionRange', 'assignSpeakerRange'].map(id => $('#' + id)),
        ];
        for (const control of controls) for (const event of ['onclick', 'onchange', 'oninput', 'onkeydown']) {
            const handler = control?.[event];
            if (handler) control[event] = (...args) => {
                if (generation === renderGeneration) return handler(...args);
            };
        }
    }
    function focusCaption(index) {
        if (composing) return;
        index = Math.min(index, getProject().captions.length - 1);
        const next = index < 0 ? 0 : Math.floor(index / CAPTION_PAGE_SIZE);
        if (next !== page) {
            page = next;
            refresh();
        }
        const field = (index < 0 ? null : $('[data-caption-text="' + index + '"]')) || $('#addCaption');
        field.focus({ preventScroll: true });
        field.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }
    return { render, focus: focusCaption };
}
