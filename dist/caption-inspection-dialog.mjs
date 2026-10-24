import {text, attrs, message} from './i18n.mjs';
import {prepareCommand} from './core/commands.mjs';

// Own report presentation and navigation, never project edits or persistent settings.
export function createCaptionInspectionDialog({getProject, query: $, modal, openModal, blocked, pause, seek, focusCaption, toast}) {
    let generation = 0;
    function open() {
        const owner = ++generation;
        let reportGeneration = 0;
        openModal(message("shell.inspectTitle"),
            `<label class="panel-label" for="captionInspectionThreshold">${text("shell.inspectThreshold")}</label><div class="panel-actions"><input class="panel-input" id="captionInspectionThreshold" type="number" min="0" step="any" required><button class="button primary" id="runCaptionInspection">${text("shell.inspectRun")}</button></div><p class="modal-copy">${text("shell.inspectNotice")}</p><div id="captionInspectionResults" aria-live="polite"></div>`);
        const input = $('#captionInspectionThreshold'), run = $('#runCaptionInspection'), results = $('#captionInspectionResults');
        const owns = () => generation === owner && modal.open && $('#runCaptionInspection') === run;
        modal.onclose = () => { if (generation === owner && !modal.open) generation++; };
        input.oninput = () => { if (owns()) { reportGeneration++; results.innerHTML = ''; } };
        run.onclick = () => {
            if (!owns()) return;
            const reportOwner = ++reportGeneration;
            results.innerHTML = '';
            try {
                const threshold = input.value.trim() === '' ? NaN : Number(input.value);
                const project = getProject(), contents = JSON.stringify(project);
                const report = prepareCommand(project, 'captions.inspect', {maxGraphemesPerSecond: threshold, limit: 20}).data;
                results.innerHTML = `<p role="status">${text("shell.inspectCounts", {total: report.totalOccurrences, flagged: report.flaggedOccurrences, omitted: report.omittedOccurrences})}</p>` +
                    (report.issues.length ? `<div class="caption-inspection-table"><table><thead><tr><th scope="col">${text("shell.outputSeconds")}</th><th scope="col">${text("shell.rate")}</th><th scope="col">${text("shell.inspectCheck")}</th></tr></thead><tbody>` + report.issues.map((issue, index) =>
                        `<tr><td>${issue.start.toFixed(2)}–${issue.end.toFixed(2)}</td><td title="${issue.graphemesPerSecond}">${issue.graphemesPerSecond.toFixed(2)}</td><td><div class="panel-actions"><button class="button" id="inspectCaption${index}" ${attrs("aria-label", "shell.editCaption", {index: issue.captionIndex + 1})}>${text("shell.captions")}</button><button class="button" id="inspectOccurrence${index}" ${attrs("aria-label", "shell.viewOccurrence", {index: issue.occurrenceIndex + 1})}>${text("shell.viewRange")}</button></div></td></tr>`
                    ).join('') + '</tbody></table></div>' : '');
                report.issues.forEach((issue, index) => {
                    for (const [prefix, move] of [['inspectCaption', false], ['inspectOccurrence', true]]) {
                        const selector = `#${prefix}${index}`, button = $(selector);
                        button.onclick = () => {
                            if (!owns() || reportOwner !== reportGeneration || $(selector) !== button) return;
                            if (getProject() !== project || JSON.stringify(getProject()) !== contents) {
                                reportGeneration++;
                                results.innerHTML = `<p role="status">${text("shell.inspectStale")}</p>`;
                                return;
                            }
                            if (blocked()) { toast(message("shell.inspectBusy")); return; }
                            generation++;
                            modal.close();
                            if (move) { pause(); seek(issue.start * project.speed); }
                            focusCaption(issue.captionIndex);
                        };
                    }
                });
            } catch (error) {
                toast(error?.messageKey ? error : error.message || message("shell.inspectFailed"));
                input.focus();
            }
        };
        input.focus();
    }
    return {open};
}
