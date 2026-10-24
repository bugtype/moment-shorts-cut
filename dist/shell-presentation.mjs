import {text, attrs, message, formatError, setText} from './i18n.mjs';
import {icon, esc} from './ui-format.mjs';

// Own shell feedback and modal markup, not editor state, history or media jobs.
// Callbacks keep the app's public wrappers interceptable and timers injectable.
export function createShellPresentation({query: $, queryAll, document, modal,
    openDialog, downloadSettings, filesBlocked = () => false, setTimer, clearTimer}) {
    let lastSaveStatus = '', toastTimer, fileDialogGeneration = 0, pendingImportClose;
    function bindFileActions(trigger) {
        const generation = ++fileDialogGeneration;
        const importButton = $('#importProjectSettingsButton');
        const saveButton = $('#downloadProjectSettingsButton');
        const owns = () => generation === fileDialogGeneration && modal.open &&
            $('#importProjectSettingsButton') === importButton;
        const close = () => {
            if (!owns()) return;
            fileDialogGeneration++;
            modal.close();
            trigger?.focus();
        };
        importButton.onclick = () => {
            if (!owns() || filesBlocked()) return;
            pendingImportClose = close;
            $('#projectInput').click();
        };
        saveButton.onclick = () => { if (owns() && !filesBlocked()) downloadSettings(); };
        modal.onclose = () => {
            if (generation === fileDialogGeneration && !modal.open) {
                fileDialogGeneration++;
                trigger?.focus();
            }
        };
    }
    function captureImportClose() {
        const close = pendingImportClose;
        pendingImportClose = null;
        return close || (() => {});
    }
    function showProjectFiles() {
        if (filesBlocked()) return;
        openDialog(message('shell.projectFiles'), `<div class="notice">${text('shell.settingsNotice')}</div>`, `<div class="modal-foot project-file-actions"><button class="button" id="importProjectSettingsButton">${text('shell.importSettings')}</button><button class="button primary" id="downloadProjectSettingsButton">${text('shell.saveSettings')}</button></div>`);
        bindFileActions($('#projectFilesButton'));
    }
    function icons(root = document) {
        queryAll('[data-icon]', root).forEach(el => {
            if (!el.querySelector('.icon'))
                el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
        });
    }

    function showHelp() {
        openDialog(message('shell.helpTitle'), `<ol class="guide-steps"><li>${text('shell.help1')}</li><li>${text('shell.help2')}</li><li>${text('shell.help3')}</li></ol><p class="modal-copy"><span class="keyboard-key">Space</span> ${text('shell.playPause')} &nbsp; <span class="keyboard-key">Ctrl Z</span> ${text('shell.undo')} &nbsp; <span class="keyboard-key">, / .</span> ${text('shell.stepOutput')} &nbsp; <span class="keyboard-key">[ / ]</span> ${text('shell.cutNavigation')}</p><div class="notice">${text('shell.settingsNotice')}</div>`, `<div class="modal-foot"><button class="button" id="importProjectSettingsButton">${text('shell.importSettings')}</button><button class="button" id="downloadProjectSettingsButton">${text('shell.saveSettings')}</button></div>`);
        bindFileActions($('#helpButton'));
    }
    function toast(message) {
        const node = $('#toast');
        if (message?.messageKey) setText(node, message.messageKey, message.messageParams);
        else {
            node.removeAttribute('data-i18n');
            node.removeAttribute('data-i18n-params');
            node.textContent = formatError(message);
        }
        $('#toast').classList.add('visible');
        clearTimer(toastTimer);
        toastTimer = setTimer(() => $('#toast').classList.remove('visible'), 5000);
    }
    function saveStatus(text, ok = true) {
        const key = JSON.stringify(text) + ok;
        if (lastSaveStatus === key)
            return;
        lastSaveStatus = key;
        $('#saveStatus').innerHTML = `<i style="background:${ok ? '#93a88d' : '#dd9c70'}"></i> <span id="saveStatusText">${esc(formatError(text))}</span>`;
        if (text?.messageKey) setText($('#saveStatusText'), text.messageKey, text.messageParams);
        else $('#saveStatusText').textContent = formatError(text);
    }
    function modalOpen(title, body, footer = '') {
        fileDialogGeneration++;
        modal.onclose?.();
        modal.onclose = null;
        modal.className = '';
        modal.innerHTML = `<div class="modal-head"><h2>${title?.messageKey ? text(title.messageKey, title.messageParams) : esc(title)}</h2><button class="icon-button" id="closeModal" ${attrs("aria-label", "shell.close")}>${icon('close')}</button></div>${body}${footer}`;
        $('#closeModal').onclick = () => modal.close();
        modal.showModal();
    }
    return {icons, showHelp, showProjectFiles, captureImportClose, toast, saveStatus, modalOpen};
}
