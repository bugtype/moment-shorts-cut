import { t, text, formatError } from './i18n.mjs';
import { readTemplateLibrary, validateTemplateLibrary, createTemplateDocument, readTemplateDocument, MAX_TEMPLATE_FILE_BYTES } from './template-library.mjs';
import { saveCustomTemplate } from './template-catalog.mjs';
import { mountTemplateGallery } from './template-gallery.mjs';
import { esc } from './ui-format.mjs';

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
        toast(t('templates.libraryError'));
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
            toast(t('templates.saveError'));
            return false;
        }
    }
    async function importTemplate(file) {
        const request = ++importRequest;
        if (templateLibraryBlocked())
            return;
        try {
            if (file.size > MAX_TEMPLATE_FILE_BYTES)
                throw new Error(t('templates.importSize'));
            const bytes = await file.arrayBuffer();
            if (request !== importRequest)
                return;
            if (bytes.byteLength > MAX_TEMPLATE_FILE_BYTES)
                throw new Error(t('templates.importSize'));
            let text;
            try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
            catch { throw new Error(t('templates.utf8')); }
            const template = readTemplateDocument(JSON.parse(text));
            if (savedTemplates.length >= 20)
                throw new Error(t('templates.capacity'));
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
            toast(t('templates.imported'));
        }
        catch (error) {
            if (request === importRequest)
                toast(formatError(error) || t('templates.invalidFile'));
        }
    }
    function exportTemplate(id) {
        try {
            const template = savedTemplates.find(item => item.id === id);
            if (!template)
                throw new Error(t('templates.exportMissing'));
            const text = JSON.stringify(createTemplateDocument(template), null, 2);
            const blob = new Blob([text], { type: 'application/json' });
            if (blob.size > MAX_TEMPLATE_FILE_BYTES)
                throw new Error(t('templates.exportSize'));
            download(blob, `${template.name}.moment-template.json`);
        }
        catch (error) {
            toast(formatError(error) || t('templates.exportError'));
        }
    }
    function updateTemplate(id) {
        if (templateLibraryBlocked()) return;
        const item = savedTemplates.find(template => template.id === id);
        if (!item) {
            toast(t('templates.updateMissing'));
            return;
        }
        modalOpen(text('templates.updateTitle'), `<p class="modal-copy">${text('templates.updateWarning',{name:item.name})}</p>`, `<div class="modal-foot"><button class="button" id="cancelUpdateTemplate">${text('templates.cancel')}</button><button class="button primary" id="confirmUpdateTemplate">${text('templates.confirmUpdate')}</button></div>`);
        const confirm = $('#confirmUpdateTemplate'), generation = dialogGeneration;
        let active = true;
        $('#cancelUpdateTemplate').onclick = () => { active = false; modal.close(); };
        confirm.onclick = () => {
            if (!active || generation !== dialogGeneration || modal.open === false || $('#confirmUpdateTemplate') !== confirm || templateLibraryBlocked()) return;
            const current = savedTemplates.find(template => template.id === id);
            if (!current) {
                toast(t('templates.updateMissing'));
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
                toast(t('templates.updated'));
            }
            catch (error) {
                toast(formatError(error) || t('templates.updateError'));
            }
        };
    }
    function renameTemplate(id) {
        if (templateLibraryBlocked()) return;
        const item = savedTemplates.find(template => template.id === id);
        if (!item) {
            toast(t('templates.renameMissing'));
            return;
        }
        modalOpen(text('templates.renameTitle'), `<label class="panel-label" for="renameTemplateName">${text('templates.name')}</label><input class="panel-input" id="renameTemplateName" maxlength="40" value="${esc(item.name)}">`, `<div class="modal-foot"><button class="button" id="cancelRenameTemplate">${text('templates.cancel')}</button><button class="button primary" id="confirmRenameTemplate">${text('templates.rename')}</button></div>`);
        $('#cancelRenameTemplate').onclick = () => modal.close();
        $('#confirmRenameTemplate').onclick = () => {
            if (templateLibraryBlocked()) return;
            const current = savedTemplates.find(template => template.id === id);
            if (!current) {
                toast(t('templates.renameMissing'));
                return;
            }
            const name = $('#renameTemplateName').value.trim();
            if (!name || name.length > 40) {
                toast(t('templates.nameLength'));
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
            toast(t('templates.renamed'));
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
                modalOpen(text('templates.removeTitle'), `<p class="modal-copy">${text('templates.removeWarning')}</p>`, `<div class="modal-foot"><button class="button" id="cancelRemoveTemplate">${text('templates.cancel')}</button><button class="button primary" id="confirmRemoveTemplate">${text('templates.removeConfirm')}</button></div>`);
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
            toast(t('templates.capacity'));
            return;
        }
        modalOpen(text('templates.saveTitle'), `<p class="modal-copy">${text('templates.saveWarning')}</p><label class="panel-label" for="customTemplateName">${text('templates.name')}</label><input class="panel-input" id="customTemplateName" maxlength="40" value="${esc(t('templates.suggestName',{name:getProject().name}))}">`, `<div class="modal-foot"><button class="button primary" id="saveCustomTemplate">${text('templates.saveLocal')}</button></div>`);
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
            toast(t('templates.saved'));
        };
    }
    return { render: renderGallery };
}
