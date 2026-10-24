import {text, attrs, message, formatError, setText} from './i18n.mjs';
import {icon, esc} from './ui-format.mjs';

// Own shell feedback and modal markup, not editor state, history or media jobs.
// Callbacks keep the app's public wrappers interceptable and timers injectable.
export function createShellPresentation({query: $, queryAll, document, modal,
    openDialog, downloadSettings, setTimer, clearTimer}) {
    let lastSaveStatus = '', toastTimer;
    function icons(root = document) {
        queryAll('[data-icon]', root).forEach(el => {
            if (!el.querySelector('.icon'))
                el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
        });
    }

    function showHelp() {
        openDialog(message('shell.helpTitle'), `<ol class="guide-steps"><li>${text('shell.help1')}</li><li>${text('shell.help2')}</li><li>${text('shell.help3')}</li></ol><p class="modal-copy"><span class="keyboard-key">Space</span> ${text('shell.playPause')} &nbsp; <span class="keyboard-key">Ctrl Z</span> ${text('shell.undo')} &nbsp; <span class="keyboard-key">, / .</span> ${text('shell.stepOutput')}</p><div class="notice">${text('shell.settingsNotice')}</div>`, `<div class="modal-foot"><button class="button" id="importProjectSettingsButton">${text('shell.importSettings')}</button><button class="button" id="downloadProjectSettingsButton">${text('shell.saveSettings')}</button></div>`);
        $('#importProjectSettingsButton').onclick = () => $('#projectInput').click();
        $('#downloadProjectSettingsButton').onclick = downloadSettings;
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
        modal.onclose?.();
        modal.onclose = null;
        modal.className = '';
        modal.innerHTML = `<div class="modal-head"><h2>${title?.messageKey ? text(title.messageKey, title.messageParams) : esc(title)}</h2><button class="icon-button" id="closeModal" ${attrs("aria-label", "shell.close")}>${icon('close')}</button></div>${body}${footer}`;
        $('#closeModal').onclick = () => modal.close();
        modal.showModal();
    }
    return {icons, showHelp, toast, saveStatus, modalOpen};
}
