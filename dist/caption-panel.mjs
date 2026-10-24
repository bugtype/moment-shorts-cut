import { replaceCaptionText } from './core/caption-text.mjs';
import { MAX_CAPTIONS } from './captions.mjs';
import { splitCaptionText } from './effects.mjs';
import { CAPTION_PAGE_SIZE, captionsPanelMarkup } from './panel-markup.mjs';

export function createCaptionPanel({
    query: $, queryAll: $$, getProject, getDuration, sourceTime, edit, refresh, toast,
}) {
    let exportFormat = 'srt';
    let page = 0, composing = false, renderGeneration = 0;
    const lastPage = () => Math.max(0, Math.ceil(getProject().captions.length / CAPTION_PAGE_SIZE) - 1);
    const replacementFields = { find: '', replacement: '' };
    let searchProject = null, searchQuery = '', selectedSearchCaption = null;
    function searchResults() {
        const project = getProject(), query = replacementFields.find;
        if (project !== searchProject || query !== searchQuery) {
            selectedSearchCaption = null;
            searchProject = project;
            searchQuery = query;
        }
        const rows = [];
        if (query) project.captions.forEach((caption, index) => {
            const start = caption.text.indexOf(query);
            if (start >= 0) rows.push({ caption, index, start });
        });
        const current = rows.findIndex(row => row.caption === selectedSearchCaption);
        if (current < 0) selectedSearchCaption = null;
        $('#captionSearchStatus').textContent = `자막 ${current + 1} / ${rows.length}`;
        $('#previousCaptionMatch').disabled = !rows.length;
        $('#nextCaptionMatch').disabled = !rows.length;
        return { rows, current };
    }
    function navigateSearch(direction) {
        if (composing) return;
        const { rows, current } = searchResults();
        if (!rows.length) return;
        const index = current < 0 ? (direction > 0 ? 0 : rows.length - 1)
            : (current + direction + rows.length) % rows.length;
        const row = rows[index];
        selectedSearchCaption = row.caption;
        searchResults();
        focusCaption(row.index);
        $('[data-caption-text="' + row.index + '"]')?.setSelectionRange(row.start, row.start + searchQuery.length);
    }
    function previewReplacement() {
        const button = $('#replaceAllCaptions');
        button.textContent = '모두 바꾸기';
        button.disabled = !replacementFields.find;
        if (!replacementFields.find)
            return;
        try {
            const result = replaceCaptionText(getProject().captions, replacementFields);
            button.textContent = `모두 바꾸기 · ${result.matches}곳`;
            button.disabled = !result.changedCaptions;
        }
        catch {
            // Keep the action available so validation can explain the rejected edit.
            button.disabled = false;
        }
    }
    function replaceAllCaptions() {
        try {
            const result = replaceCaptionText(getProject().captions, replacementFields);
            if (!result.changedCaptions) {
                previewReplacement();
                return;
            }
            let applied = false;
            edit(() => {
                getProject().captions = result.captions;
                applied = true;
            }, true);
            if (!applied)
                return;
            previewReplacement();
            $('#captionFind').focus({ preventScroll: true });
            toast(`${result.changedCaptions}개 자막을 바꿨습니다.`);
        }
        catch (error) {
            toast(error.message);
        }
    }
    function splitLongCaptions() {
        const limit = Number($('#captionChunkSize').value), captions = [];
        try {
            for (const caption of getProject().captions) {
                const parts = splitCaptionText(caption, limit);
                if (captions.length + parts.length > MAX_CAPTIONS) {
                    toast('자막은 10,000개 이하만 지원합니다.');
                    return;
                }
                captions.push(...parts);
            }
        }
        catch (error) {
            toast(error.message);
            return;
        }
        const original = getProject().captions;
        const unchanged = captions.length === original.length && captions.every((caption, i) =>
            caption === original[i] || JSON.stringify(caption) === JSON.stringify(original[i]));
        if (unchanged) {
            toast('나눌 긴 자막이 없습니다.');
            return;
        }
        let applied = false;
        edit(() => { getProject().captions = captions; applied = true; }, true);
        if (!applied) return;
        $('#splitLongCaptions').focus();
        toast('긴 자막을 나눴습니다. 시간은 글자 수 기준으로 배분했으니 음성과 확인해 주세요.');
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
        target.oncompositionstart = () => { if (generation === renderGeneration) composing = true; };
        target.oncompositionend = () => { if (generation === renderGeneration) composing = false; };
        for (const [id, key] of [['captionFind', 'find'], ['captionReplacement', 'replacement']]) {
            const field = $('#' + id);
            field.value = replacementFields[key];
            field.oninput = () => {
                replacementFields[key] = field.value;
                previewReplacement();
                searchResults();
            };
        }
        $('#previousCaptionMatch').onclick = () => navigateSearch(-1);
        $('#nextCaptionMatch').onclick = () => navigateSearch(1);
        searchResults();
        $('#replaceAllCaptions').onclick = replaceAllCaptions;
        previewReplacement();
        $('#captionDesignShortcut').onclick = actions.design;
        $('#splitLongCaptions').onclick = splitLongCaptions;
        $$('[data-caption-keywords]').forEach(el => el.onchange = () => edit(() => getProject().captions[+el.dataset.captionKeywords].keywords = el.value));
        $$('[data-caption-speaker]').forEach(el => el.onchange = () => edit(() => getProject().captions[+el.dataset.captionSpeaker].speaker = el.value));
        $('#generateCaptions').onclick = actions.generate;
        $('#addCaption').onclick = () => {
            if (getProject().captions.length >= MAX_CAPTIONS) {
                toast('자막은 10,000개 이하만 지원합니다.');
                return;
            }
            let applied = false;
            edit(() => {
                const t = Math.min(sourceTime(), Math.max(0, getProject().duration - .1));
                getProject().captions.push({ start: t, end: Math.min(getProject().duration, t + 3), text: '새로운 자막을 입력하세요' });
                applied = true;
            }, true);
            if (applied) focusCaption(getProject().captions.length - 1);
        };
        $('#importSrt').onclick = () => $('#srtInput').click();
        $('#captionExportFormat').value = exportFormat;
        $('#captionExportFormat').onchange = () => {
            const value = $('#captionExportFormat').value;
            if (['srt', 'vtt', 'txt'].includes(value)) exportFormat = value;
        };
        $('#downloadCaptions').onclick = () => actions.download(exportFormat);
        $$('[data-delete-caption]').forEach(b => b.onclick = () => {
            const index = +b.dataset.deleteCaption;
            let applied = false;
            edit(() => { getProject().captions.splice(index, 1); applied = true; }, true);
            if (applied) focusCaption(Math.min(index, getProject().captions.length - 1));
        });
        $$('[data-caption-text]').forEach(el => el.onchange = () => {
            edit(() => getProject().captions[+el.dataset.captionText].text = el.value);
            searchResults();
            previewReplacement();
        });
        for (const side of ['start', 'end'])
            $$(`[data-caption-${side}]`).forEach(el => el.onchange = () => {
                const i = +el.dataset[side === 'start' ? 'captionStart' : 'captionEnd'];
                const c = getProject().captions[i], value = +el.value;
                if (!Number.isFinite(value) || value < 0 ||
                    value > (c.basis === 'timeline' ? getDuration() : getProject().duration) ||
                    (side === 'start' ? value >= c.end : value <= c.start)) {
                    toast('시작은 끝보다 작고, 영상 길이 안에 있어야 합니다.');
                    refresh();
                    return;
                }
                edit(() => c[side] = value);
            });
        // Detached controls no longer own the rendered row indices or pager state.
        const controls = [
            ...$$('[data-caption-text]'), ...$$('[data-caption-start]'), ...$$('[data-caption-end]'),
            ...$$('[data-caption-keywords]'), ...$$('[data-caption-speaker]'), ...$$('[data-delete-caption]'),
            ...['captionFind', 'captionReplacement', 'previousCaptionPage', 'nextCaptionPage',
                'previousCaptionMatch', 'nextCaptionMatch', 'replaceAllCaptions', 'splitLongCaptions',
                'addCaption', 'importSrt', 'captionExportFormat', 'downloadCaptions', 'generateCaptions',
                'captionDesignShortcut'].map(id => $('#' + id)),
        ];
        for (const control of controls) for (const event of ['onclick', 'onchange', 'oninput']) {
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
