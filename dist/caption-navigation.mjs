import {captionOccurrences} from './captions.mjs';
import {text, attrs, message} from './i18n.mjs';

const PAGE_SIZE = 20;

// Read-only navigation: retain the authored index while projecting just one cue.
export function createCaptionNavigation({getProject, getMedia, query: $, modal, openModal, blocked, pause, seek, toast}) {
    let generation = 0;
    function open(captionIndex) {
        if (blocked() || modal.open) return;
        const project = getProject(), caption = project.captions[captionIndex];
        if (!caption) return;
        // With at most one clip, this cue cannot open a delayed chooser.
        const owner = ++generation, contents = project.clips.length > 1 ? JSON.stringify(project) : null, media = getMedia();
        // Navigation needs timing only; repeated long text must not hit subtitle export limits.
        const occurrences = captionOccurrences([{...caption, text: ''}], project.clips, project.speed);
        if (!occurrences.length) { toast(message('panels.noCaptionOccurrence')); return; }
        const unchanged = () => getProject() === project && JSON.stringify(project) === contents &&
            getMedia().every((file, index) => file === media[index]);
        const move = occurrence => { pause(); seek(occurrence.start * project.speed); };
        if (occurrences.length === 1) { move(occurrences[0]); return; }
        openModal(message('panels.captionOccurrences', {index: captionIndex + 1}), '<div id="captionOccurrences"></div>');
        const root = $('#captionOccurrences');
        let page = 0, renderGeneration = 0;
        const owns = () => generation === owner && modal.open && $('#captionOccurrences') === root;
        modal.onclose = () => { if (generation === owner && !modal.open) generation++; };
        function valid() {
            if (!owns()) return false;
            if (!unchanged()) {
                renderGeneration++;
                root.innerHTML = `<p role="status">${text('panels.captionOccurrenceStale')}</p>`;
                return false;
            }
            if (blocked()) { toast(message('shell.inspectBusy')); return false; }
            return true;
        }
        function render() {
            const renderOwner = ++renderGeneration, start = page * PAGE_SIZE;
            const rows = occurrences.slice(start, start + PAGE_SIZE), lastPage = Math.ceil(occurrences.length / PAGE_SIZE) - 1;
            root.innerHTML = `<div class="caption-inspection-table"><table><thead><tr><th scope="col">${text('shell.outputSeconds')}</th><th scope="col">${text('panels.occurrenceClip')}</th><th scope="col">${text('panels.viewInVideo')}</th></tr></thead><tbody>` + rows.map((occurrence, index) =>
                `<tr><td title="${occurrence.start}–${occurrence.end}">${occurrence.start.toFixed(2)}–${occurrence.end.toFixed(2)}</td><td>${occurrence.clipIndex + 1}</td><td><button class="button" id="captionOccurrence${index}" ${attrs('aria-label', 'panels.viewCaptionOccurrence', {index: start + index + 1})}>${text('panels.viewInVideo')}</button></td></tr>`
            ).join('') + `</tbody></table></div><div class="panel-actions"><button class="button" id="previousCaptionOccurrencePage" ${page === 0 ? 'disabled' : ''}>${text('panels.previous')}</button><span role="status">${text('panels.occurrencePage', {current: page + 1, total: lastPage + 1})}</span><button class="button" id="nextCaptionOccurrencePage" ${page === lastPage ? 'disabled' : ''}>${text('panels.next')}</button></div>`;
            const bind = (selector, action) => {
                const button = $(selector);
                button.onclick = event => {
                    if (event?.isComposing || event?.keyCode === 229 || renderOwner !== renderGeneration || $(selector) !== button || !valid()) return;
                    action();
                };
            };
            rows.forEach((occurrence, index) => bind(`#captionOccurrence${index}`, () => {
                generation++;
                modal.close();
                move(occurrence);
            }));
            for (const [id, delta] of [['previousCaptionOccurrencePage', -1], ['nextCaptionOccurrencePage', 1]]) bind('#' + id, () => {
                const next = Math.max(0, Math.min(lastPage, page + delta));
                if (next === page) return;
                page = next;
                render();
                const preferred = $('#' + id);
                (preferred.disabled ? $('#captionOccurrence0') : preferred).focus();
            });
        }
        render();
        $('#captionOccurrence0').focus();
    }
    return {open};
}
