import { t, text, formatError, message } from './i18n.mjs';
import { readTemplateLibrary, validateTemplateLibrary, createTemplateDocument, readTemplateDocument, MAX_TEMPLATE_FILE_BYTES } from './template-library.mjs';
import { saveCustomTemplate } from './template-catalog.mjs';
import { mountTemplateGallery } from './template-gallery.mjs';
import { esc } from './ui-format.mjs';

const templateError = key => Object.assign(new Error(), message(key));
const errorMessage = (error, fallback) => error?.messageKey ? error : (formatError(error) || message(fallback));

// Own the template library independently of project state and project persistence.
export function createTemplateWorkspace({
    getProject, query: $, modal, openModal,
    thumbnail, preview, refresh, navigate, toast, download,
}, {
    readStorage = key => localStorage.getItem(key),
    writeStorage = (key, value) => localStorage.setItem(key, value),
    mount = mountTemplateGallery,
    makeId = () => `custom-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
} = {}) {
    let importRequest = 0, dialogGeneration = 0;
    function modalOpen(...args) { dialogGeneration++; openModal(...args); }
    const galleryUI = { query: '', category: '전체' };
    let savedTemplates = [], favoriteTemplates = [], templateLibraryError = '';
    try {
        const library = readTemplateLibrary(readStorage('moment-templates-v1'), readStorage('moment-favorites-v1'));
        savedTemplates = library.templates;
        favoriteTemplates = library.favorites;
    }
    catch {
        templateLibraryError = t('templates.libraryError');
    }
    function templateLibraryBlocked() {
        if (!templateLibraryError)
            return false;
        toast(message('templates.libraryError'));
        return true;
    }
    function persistTemplateLibrary(key, items) {
        if (templateLibraryBlocked())
            return false;
        try {
            validateTemplateLibrary(savedTemplates, favoriteTemplates);
            // Each action changes one collection; avoid a second write that could partially fail.
            writeStorage(key, JSON.stringify(items));
            return true;
        }
        catch {
            toast(message('templates.saveError'));
            return false;
        }
    }
    async function importTemplate(file) {
        const request = ++importRequest;
        if (templateLibraryBlocked())
            return;
        try {
            if (file.size > MAX_TEMPLATE_FILE_BYTES)
                throw templateError('templates.importSize');
            const bytes = await file.arrayBuffer();
            if (request !== importRequest)
                return;
            if (bytes.byteLength > MAX_TEMPLATE_FILE_BYTES)
                throw templateError('templates.importSize');
            let text;
            try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
            catch { throw templateError('templates.utf8'); }
            const template = readTemplateDocument(JSON.parse(text));
            if (savedTemplates.length >= 20)
                throw templateError('templates.capacity');
            template.id = makeId();
            template.category = '내 템플릿';
            const next = [...savedTemplates, template];
            validateTemplateLibrary(next, favoriteTemplates);
            const previous = savedTemplates;
            savedTemplates = next;
            if (!persistTemplateLibrary('moment-templates-v1', next)) {
                savedTemplates = previous;
                return;
            }
            galleryUI.category = '내 템플릿';
            refresh();
            toast(message('templates.imported'));
        }
        catch (error) {
            if (request === importRequest)
                toast(errorMessage(error, 'templates.invalidFile'));
        }
    }
    function exportTemplate(id) {
        try {
            const template = savedTemplates.find(item => item.id === id);
            if (!template)
                throw templateError('templates.exportMissing');
            const text = JSON.stringify(createTemplateDocument(template), null, 2);
            const blob = new Blob([text], { type: 'application/json' });
            if (blob.size > MAX_TEMPLATE_FILE_BYTES)
                throw templateError('templates.exportSize');
            download(blob, `${template.name}.moment-template.json`);
        }
        catch (error) {
            toast(errorMessage(error, 'templates.exportError'));
        }
    }
    function updateTemplate(id) {
        if (templateLibraryBlocked()) return;
        const item = savedTemplates.find(template => template.id === id);
        if (!item) {
            toast(message('templates.updateMissing'));
            return;
        }
        modalOpen(message('templates.updateTitle'), `<p class="modal-copy">${text('templates.updateWarning',{name:item.name})}</p>`, `<div class="modal-foot"><button class="button" id="cancelUpdateTemplate">${text('templates.cancel')}</button><button class="button primary" id="confirmUpdateTemplate">${text('templates.confirmUpdate')}</button></div>`);
        const confirm = $('#confirmUpdateTemplate'), generation = dialogGeneration;
        let active = true;
        $('#cancelUpdateTemplate').onclick = () => { active = false; modal.close(); };
        confirm.onclick = () => {
            if (!active || generation !== dialogGeneration || modal.open === false || $('#confirmUpdateTemplate') !== confirm || templateLibraryBlocked()) return;
            const current = savedTemplates.find(template => template.id === id);
            if (!current) {
                toast(message('templates.updateMissing'));
                return;
            }
            try {
                // Capture at confirmation, keeping the saved identity and descriptive metadata.
                const captured = saveCustomTemplate(current.name, getProject());
                const replacement = readTemplateDocument(createTemplateDocument({
                    ...current, settings: captured.settings, cards: captured.cards,
                    title: captured.title, accent: captured.accent, relativeTiming: captured.relativeTiming,
                }));
                const previous = savedTemplates;
                savedTemplates = savedTemplates.map(template => template.id === id ? replacement : template);
                if (!persistTemplateLibrary('moment-templates-v1', savedTemplates)) {
                    savedTemplates = previous;
                    return;
                }
                active = false;
                modal.close();
                refresh();
                toast(message('templates.updated'));
            }
            catch (error) {
                toast(errorMessage(error, 'templates.updateError'));
            }
        };
    }
    function renameTemplate(id) {
        if (templateLibraryBlocked()) return;
        const item = savedTemplates.find(template => template.id === id);
        if (!item) {
            toast(message('templates.renameMissing'));
            return;
        }
        modalOpen(message('templates.renameTitle'), `<label class="panel-label" for="renameTemplateName">${text('templates.name')}</label><input class="panel-input" id="renameTemplateName" maxlength="40" value="${esc(item.name)}">`, `<div class="modal-foot"><button class="button" id="cancelRenameTemplate">${text('templates.cancel')}</button><button class="button primary" id="confirmRenameTemplate">${text('templates.rename')}</button></div>`);
        $('#cancelRenameTemplate').onclick = () => modal.close();
        $('#confirmRenameTemplate').onclick = () => {
            if (templateLibraryBlocked()) return;
            const current = savedTemplates.find(template => template.id === id);
            if (!current) {
                toast(message('templates.renameMissing'));
                return;
            }
            const name = $('#renameTemplateName').value.trim();
            if (!name || name.length > 40) {
                toast(message('templates.nameLength'));
                $('#renameTemplateName').focus();
                return;
            }
            if (name === current.name) {
                modal.close();
                return;
            }
            const previous = savedTemplates;
            savedTemplates = savedTemplates.map(template => template.id === id ? { ...template, name } : template);
            if (!persistTemplateLibrary('moment-templates-v1', savedTemplates)) {
                savedTemplates = previous;
                return;
            }
            modal.close();
            refresh();
            toast(message('templates.renamed'));
        };
    }
    function renderGallery(target) {
        mount(target, {
            ui: galleryUI,
            active: getProject().templateId,
            custom: savedTemplates,
            favorites: favoriteTemplates,
            error: templateLibraryError,
            errorKey: templateLibraryError ? 'templates.libraryError' : null,
            thumbnail, preview,
            save: saveTemplateDialog,
            import: importTemplate,
            export: exportTemplate,
            rename: renameTemplate,
            update: updateTemplate,
            favorite(id) {
                if (templateLibraryBlocked())
                    return;
                const previous = [...favoriteTemplates], i = favoriteTemplates.indexOf(id);
                if (i < 0)
                    favoriteTemplates.push(id);
                else
                    favoriteTemplates.splice(i, 1);
                if (!persistTemplateLibrary('moment-favorites-v1', favoriteTemplates))
                    favoriteTemplates.splice(0, favoriteTemplates.length, ...previous);
            },
            remove(id) {
                if (templateLibraryBlocked())
                    return;
                modalOpen(message('templates.removeTitle'), `<p class="modal-copy">${text('templates.removeWarning')}</p>`, `<div class="modal-foot"><button class="button" id="cancelRemoveTemplate">${text('templates.cancel')}</button><button class="button primary" id="confirmRemoveTemplate">${text('templates.removeConfirm')}</button></div>`);
                $('#cancelRemoveTemplate').onclick = () => modal.close();
                $('#confirmRemoveTemplate').onclick = () => {
                    const previous = savedTemplates;
                    savedTemplates = savedTemplates.filter(t => t.id !== id);
                    if (!persistTemplateLibrary('moment-templates-v1', savedTemplates)) {
                        savedTemplates = previous;
                        return;
                    }
                    modal.close();
                    refresh();
                };
            }
        });
    }
    function saveTemplateDialog() {
        if (templateLibraryBlocked())
            return;
        if (savedTemplates.length >= 20) {
            toast(message('templates.capacity'));
            return;
        }
        modalOpen(message('templates.saveTitle'), `<p class="modal-copy">${text('templates.saveWarning')}</p><label class="panel-label" for="customTemplateName">${text('templates.name')}</label><input class="panel-input" id="customTemplateName" maxlength="40" value="${esc(t('templates.suggestName',{name:getProject().name}))}">`, `<div class="modal-foot"><button class="button primary" id="saveCustomTemplate">${text('templates.saveLocal')}</button></div>`);
        $('#saveCustomTemplate').onclick = () => {
            const name = $('#customTemplateName').value.trim();
            if (!name) {
                $('#customTemplateName').focus();
                return;
            }
            const item = saveCustomTemplate(name, getProject());
            savedTemplates.push(item);
            if (!persistTemplateLibrary('moment-templates-v1', savedTemplates)) {
                savedTemplates.pop();
                return;
            }
            modal.close();
            galleryUI.category = '내 템플릿';
            navigate('templates');
            toast(message('templates.saved'));
        };
    }
    return { render: renderGallery };
}
