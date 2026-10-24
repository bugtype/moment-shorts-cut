import {text, attrs, message} from './i18n.mjs';
import {prepareCommand} from './core/commands.mjs';
import {decimalTime} from './ui-format.mjs';

// Bounded timing evidence only: no text, visibility prediction, edits or all-pairs table.
export function createCaptionOverlapDialog({getProject, getMedia, query: $, modal, openModal, blocked, seekBlocked, pause, seek, focusCaption, toast}) {
    let generation = 0;
    function open() {
        if (blocked() || modal.open) return;
        const project = getProject(), contents = JSON.stringify(project), media = getMedia();
        let report;
        try { report = prepareCommand(project, 'captions.overlaps', {limit:20}).data; }
        catch (error) { toast(error?.messageKey ? error : error.message || message('shell.inspectFailed')); return; }
        const owner = ++generation;
        openModal(message('panels.captionOverlaps'), `<p class="modal-copy">${text('panels.overlapNotice')}</p><div id="captionOverlapResults" aria-live="polite"></div>`);
        const results = $('#captionOverlapResults');
        const owns = () => owner === generation && modal.open && $('#captionOverlapResults') === results;
        modal.onclose = () => { if (owner === generation && !modal.open) generation++; };
        results.innerHTML = `<p role="status">${text('panels.overlapCounts', {total:report.totalOccurrences, flagged:report.flaggedOccurrences, omitted:report.omittedOccurrences})}</p>` +
            (report.issues.length ? `<div class="caption-inspection-table"><table><thead><tr><th scope="col">${text('panels.overlapOutputRange')}</th><th scope="col">${text('panels.overlapCaptions')}</th><th scope="col">${text('panels.viewInVideo')}</th></tr></thead><tbody>` + report.issues.map((issue, index) =>
                `<tr><td title="${decimalTime(issue.overlapStart)}–${decimalTime(issue.overlapEnd)}">${issue.overlapStart.toFixed(2)}–${issue.overlapEnd.toFixed(2)}</td><td><div class="panel-actions"><button class="button" id="overlapCaption${index}" ${attrs('aria-label','shell.editCaption',{index:issue.captionIndex+1})}>${text('panels.overlapCaptionIndex',{index:issue.captionIndex+1})}</button><button class="button" id="overlapOtherCaption${index}" ${attrs('aria-label','shell.editCaption',{index:issue.otherCaptionIndex+1})}>${text('panels.overlapCaptionIndex',{index:issue.otherCaptionIndex+1})}</button></div></td><td><button class="button" id="overlapOccurrence${index}" ${attrs('aria-label','panels.viewOverlap',{index:issue.occurrenceIndex+1})}>${text('shell.viewRange')}</button></td></tr>`
            ).join('') + '</tbody></table></div>' : `<p>${text('panels.noCaptionOverlaps')}</p>`);
        report.issues.forEach((issue,index) => {
            for (const [prefix, captionIndex, move] of [['overlapCaption',issue.captionIndex,false],['overlapOtherCaption',issue.otherCaptionIndex,false],['overlapOccurrence',issue.captionIndex,true]]) {
                const selector = '#' + prefix + index, button = $(selector);
                button.onclick = event => {
                    if (!owns() || $(selector) !== button || event?.isComposing || event?.keyCode === 229) return;
                    if (getProject() !== project || JSON.stringify(getProject()) !== contents ||
                        getMedia().length !== media.length || getMedia().some((file,i) => file !== media[i])) {
                        generation++; results.innerHTML = `<p role="status">${text('panels.overlapStale')}</p>`; return;
                    }
                    if (blocked() || (move && seekBlocked())) { toast(message('shell.inspectBusy')); return; }
                    generation++; modal.close();
                    if (move) { pause(); seek(issue.overlapStart * project.speed); }
                    focusCaption(captionIndex);
                };
            }
        });
        if (report.issues.length) $('#overlapCaption0').focus();
    }
    return {open};
}
