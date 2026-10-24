import {text, message, setText} from './i18n.mjs';
import {esc} from './ui-format.mjs';

// This view grants only the controller's temporary media capability, never recovery.
export function createSessionMediaDialog({getProject, persistence, controller, query: $, modal, openModal, pause, refresh, toast, blocked}) {
    let generation = 0;
    function open() {
        if (blocked() || persistence.restorePhase !== 'failed' || !persistence.recoveryValid) return;
        const owner = ++generation, project = getProject(), contents = JSON.stringify(project);
        const needsVideo = project.kind === 'video', needsAudio = !!project.audioName;
        const fileField = (kind, name) => `<label class="panel-label" for="sessionMedia${kind}">${text('shell.sessionMedia' + kind + 'Label')} · ${esc(name)}</label><input class="panel-input" id="sessionMedia${kind}" type="file" accept="${kind.toLowerCase()}/*"><p id="sessionMedia${kind}Name" class="modal-copy"></p>`;
        openModal(message('shell.sessionMediaTitle'), `<p class="notice">${text('shell.sessionMediaNotice')}</p>${needsVideo ? fileField('Video', project.fileName) : ''}${needsAudio ? fileField('Audio', project.audioName) : ''}<label class="design-check"><input type="checkbox" id="sessionMediaConfirmed">${text('shell.sessionMediaConfirmLabel')}</label><p id="sessionMediaStatus" role="status" aria-live="polite"></p>`, `<div class="modal-foot"><button class="button" id="cancelSessionMedia">${text('shell.cancel')}</button><button class="button primary" id="connectSessionMedia">${text('shell.sessionMediaConnect')}</button></div>`);
        const button = $('#connectSessionMedia'), status = $('#sessionMediaStatus'), check = $('#sessionMediaConfirmed');
        const files = {};
        let request = 0, pending = false;
        const owns = () => owner === generation && modal.open && $('#connectSessionMedia') === button;
        function cancel() { request++; pending = false; controller.cancel(); button.disabled = false; }
        const replaced = () => { if (owner === generation) { generation++; cancel(); } };
        modal.onreplace = replaced;
        modal.onclose = () => { if (!modal.open) replaced(); };
        $('#cancelSessionMedia').onclick = () => { if (owns()) { cancel(); generation++; modal.close(); } };
        for (const [kind, needed] of [['Video', needsVideo], ['Audio', needsAudio]]) if (needed) {
            const input = $('#sessionMedia' + kind);
            input.onchange = event => {
                if (!owns()) return;
                const file = event.target.files?.[0]; event.target.value = '';
                if (!file) return;
                cancel(); files[kind.toLowerCase()] = file; check.checked = false;
                $('#sessionMedia' + kind + 'Name').textContent = file.name;
                setText(status, 'shell.sessionMediaSelected');
            };
        }
        check.onchange = () => { if (owns() && pending) cancel(); };
        button.onclick = async event => {
            if (!owns() || pending || blocked() || event?.isComposing || event?.keyCode === 229) return;
            if (getProject() !== project || JSON.stringify(getProject()) !== contents) { setText(status, 'shell.sessionMediaStale'); return; }
            if (!check.checked) { setText(status, 'shell.sessionMediaConfirmation'); return; }
            if ((needsVideo && !files.video) || (needsAudio && !files.audio)) { setText(status, 'shell.sessionMediaChooseAll'); return; }
            const attempt = ++request;
            pending = true; button.disabled = true; pause(); setText(status, 'shell.sessionMediaConnecting');
            const result = await controller.connect(files, {confirmed:true});
            if (!owns() || attempt !== request) return;
            pending = false; button.disabled = false;
            if (!result.ok) { setText(status, result.error?.messageKey || 'shell.sessionMediaFailed', result.error?.messageParams); return; }
            generation++; modal.close(); refresh(); toast(message('shell.sessionMediaConnected'));
        };
        (needsVideo ? $('#sessionMediaVideo') : needsAudio ? $('#sessionMediaAudio') : check).focus();
    }
    return {open};
}
