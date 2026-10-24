import { replaceCaptionText } from './core/caption-text.mjs';
import { MAX_CAPTIONS } from './captions.mjs';
import { splitCaptionText } from './effects.mjs';
import { captionsPanelMarkup } from './panel-markup.mjs';

export function createCaptionPanel({
    query: $, queryAll: $$, getProject, getDuration, sourceTime, edit, refresh, toast,
}) {
    const replacementFields = { find: '', replacement: '' };
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
        edit(() => getProject().captions = captions, true);
        $('#splitLongCaptions').focus();
        toast('긴 자막을 나눴습니다. 시간은 글자 수 기준으로 배분했으니 음성과 확인해 주세요.');
    }
    function render(target, status, actions) {
        const toolsOpen = target.querySelector('#captionTools')?.open;
        target.innerHTML = captionsPanelMarkup(getProject(), { toolsOpen, ...status });
        for (const [id, key] of [['captionFind', 'find'], ['captionReplacement', 'replacement']]) {
            const field = $('#' + id);
            field.value = replacementFields[key];
            field.oninput = () => {
                replacementFields[key] = field.value;
                previewReplacement();
            };
        }
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
            edit(() => {
                const t = Math.min(sourceTime(), Math.max(0, getProject().duration - .1));
                getProject().captions.push({ start: t, end: Math.min(getProject().duration, t + 3), text: '새로운 자막을 입력하세요' });
            }, true);
            focusCaption(getProject().captions.length - 1);
        };
        $('#importSrt').onclick = () => $('#srtInput').click();
        $('#downloadSrt').onclick = () => actions.download('srt');
        $('#downloadVtt').onclick = () => actions.download('vtt');
        $$('[data-delete-caption]').forEach(b => b.onclick = () => {
            const index = +b.dataset.deleteCaption;
            edit(() => getProject().captions.splice(index, 1), true);
            focusCaption(Math.min(index, getProject().captions.length - 1));
        });
        $$('[data-caption-text]').forEach(el => el.onchange = () => edit(() => getProject().captions[+el.dataset.captionText].text = el.value));
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
    }
    function focusCaption(index) {
        const field = (index < 0 ? null : $('[data-caption-text="' + index + '"]')) || $('#addCaption');
        field.focus({ preventScroll: true });
        field.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }
    return { render, focus: focusCaption };
}
