import {t, text, attrs, mark, message} from './i18n.mjs';
import {prepareCommand} from './core/commands.mjs';
import {decimalTime} from './ui-format.mjs';

const kinds = ['all', 'reading-speed', 'too-short', 'too-long', 'overlap'];

// Own reviewer inputs, bounded findings and navigation; never edit or save projects.
export function createCaptionInspectionDialog({getProject, getMedia = () => [], isCurrentPanel = () => true,
    query: $, modal, openModal, blocked, pause, seek, focusCaption, toast}) {
    let generation = 0;
    function open() {
        const owner = ++generation;
        let reportGeneration = 0, snapshot;
        const field = (id, key) => `<label class="panel-label" for="${id}">${text(key)}</label><input class="panel-input" id="${id}" type="number" min="0" step="any">`;
        openModal(message('advisory.title'),
            `<div class="caption-review-fields">` +
            `<div class="caption-review-speed">${field('captionInspectionThreshold','advisory.speed')}</div>` +
            `<div>${field('captionInspectionMin','advisory.min')}</div><div>${field('captionInspectionMax','advisory.max')}</div></div>` +
            `<label class="panel-label"><input type="checkbox" id="captionInspectionOverlaps" checked> ${text('advisory.overlaps')}</label>` +
            `<button class="button full" id="runCaptionInspection">${text('shell.inspectRun')}</button>` +
            `<p class="modal-copy">${text('advisory.notice')}</p>` +
            `<label class="panel-label" for="captionInspectionFilter">${text('advisory.filter')}</label>` +
            `<select class="panel-select" id="captionInspectionFilter">${kinds.map(kind => `<option value="${kind}" ${mark('advisory.'+kind)}>${t('advisory.'+kind)}</option>`).join('')}</select>` +
            `<div id="captionInspectionResults" aria-live="polite"></div>`);
        const input = $('#captionInspectionThreshold'), minimum = $('#captionInspectionMin'), maximum = $('#captionInspectionMax');
        const overlaps = $('#captionInspectionOverlaps'), filter = $('#captionInspectionFilter');
        const run = $('#runCaptionInspection'), results = $('#captionInspectionResults');
        overlaps.checked = true; filter.value = 'all';
        const owns = () => generation === owner && modal.open && $('#runCaptionInspection') === run;
        const composingControls = new Set();
        const composing = event => composingControls.size > 0 || event?.isComposing || event?.keyCode === 229;
        const criteria = () => JSON.stringify([input.value,minimum.value,maximum.value,overlaps.checked,filter.value]);
        const unchanged = captured => getProject() === captured.project && JSON.stringify(getProject()) === captured.contents &&
            getMedia().length === captured.media.length && getMedia().every((file,index) => file === captured.media[index]);
        const stale = () => { reportGeneration++; snapshot = null; results.innerHTML = `<p role="status">${text('advisory.stale')}</p>`; };
        modal.onclose = () => { if (generation === owner && !modal.open) generation++; };
        function invalidate() {
            if (!owns()) return;
            reportGeneration++; snapshot = null; results.innerHTML = '';
        }
        for (const control of [input, minimum, maximum, overlaps]) {
            control.oninput = invalidate; control.onchange = invalidate;
        }
        for (const control of [input,minimum,maximum,overlaps,filter]) {
            control.oncompositionstart = () => { composingControls.add(control); invalidate(); };
            control.oncompositionend = () => composingControls.delete(control);
        }
        function inspect(event) {
            if (!owns() || composing(event) || !isCurrentPanel()) return;
            const reportOwner = ++reportGeneration;
            snapshot = null; results.innerHTML = '';
            try {
                const review = {includeOverlaps: overlaps.checked, filter: filter.value};
                for (const [control,key] of [[input,'maxGraphemesPerSecond'],[minimum,'minDuration'],[maximum,'maxDuration']]) {
                    if (control.value.trim() !== '') review[key] = Number(control.value);
                }
                const project = getProject(), captured = {project, contents: JSON.stringify(project), media: [...getMedia()], criteria: criteria()};
                const report = prepareCommand(project, 'captions.inspect', {review, limit:20}).data;
                snapshot = captured;
                results.innerHTML = `<p role="status">${text('advisory.counts', {total:report.totalOccurrences,flagged:report.flaggedOccurrences,findings:report.totalFindings})}</p>` +
                    `<p>${text('advisory.summary',{speed:report.counts.readingSpeed,short:report.counts.tooShort,long:report.counts.tooLong,overlap:report.counts.overlap})}</p>` +
                    `<p>${text('advisory.filtered',{matched:report.matchedFindings,shown:report.issues.length,omitted:report.omittedFindings})}</p>` +
                    (report.issues.length ? `<div class="caption-inspection-table"><table><thead><tr><th scope="col">${text('shell.outputSeconds')}</th><th scope="col">${text('advisory.filter')}</th><th scope="col">${text('shell.inspectCheck')}</th></tr></thead><tbody>` + report.issues.map((issue,index) => {
                        const value = issue.kind === 'reading-speed' ? issue.graphemesPerSecond : issue.kind === 'overlap' ? issue.overlapEnd - issue.overlapStart : issue.duration;
                        const evidence = text(issue.kind === 'reading-speed' ? 'advisory.rate' : 'advisory.duration', {value:String(Number(value.toPrecision(6)))});
                        return `<tr><td title="${decimalTime(issue.start)}–${decimalTime(issue.end)}">${String(Number(issue.start.toPrecision(6)))}–${String(Number(issue.end.toPrecision(6)))}</td><td title="${decimalTime(value)}">${text('advisory.'+issue.kind)}<br>${evidence}</td><td><div class="panel-actions">` +
                            `<button class="button" id="inspectCaption${index}" ${attrs('aria-label','shell.editCaption',{index:issue.captionIndex+1})}>${text('shell.captions')}</button>` +
                            `<button class="button" id="inspectOccurrence${index}" ${attrs('aria-label','shell.viewOccurrence',{index:issue.occurrenceIndex+1})}>${text('shell.viewRange')}</button></div>` +
                            (issue.kind === 'overlap' ? `<button class="button full" id="inspectOther${index}">${text('advisory.related',{index:issue.otherCaptionIndex+1})}</button>` : '') + '</td></tr>';
                    }).join('') + '</tbody></table></div>' : `<p>${text('advisory.empty')}</p>`);
                report.issues.forEach((issue,index) => {
                    const actions = [['inspectCaption',false,issue.captionIndex],['inspectOccurrence',true,issue.captionIndex]];
                    if (issue.kind === 'overlap') actions.push(['inspectOther',false,issue.otherCaptionIndex]);
                    for (const [prefix,move,captionIndex] of actions) {
                        const selector = `#${prefix}${index}`, button = $(selector);
                        button.onclick = event => {
                            if (!owns() || reportOwner !== reportGeneration || $(selector) !== button || composing(event) || !isCurrentPanel()) return;
                            if (criteria() !== captured.criteria) { invalidate(); return; }
                            if (!unchanged(captured)) { stale(); return; }
                            if (blocked()) { toast(message('shell.inspectBusy')); return; }
                            generation++; modal.close();
                            if (move) { pause(); seek((issue.kind === 'overlap' ? issue.overlapStart : issue.start) * project.speed); }
                            focusCaption(captionIndex);
                        };
                    }
                });
            } catch (error) {
                toast(error?.messageKey ? error : error.message || message('shell.inspectFailed'));
                input.focus();
            }
        }
        run.onclick = inspect;
        filter.onchange = event => {
            if (!owns()) return;
            const previous = snapshot;
            invalidate();
            if (!previous || composing(event) || !isCurrentPanel()) return;
            if (!unchanged(previous)) { stale(); return; }
            inspect(event);
        };
        input.focus();
    }
    return {open};
}
