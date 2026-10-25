import { LocalizedError } from './core/validation.mjs';
import { t, text, formatError, message } from './i18n.mjs';
import { readTemplateLibrary, validateTemplateLibrary, createTemplateDocument, readTemplateDocument, MAX_TEMPLATE_FILE_BYTES } from './template-library.mjs';
import { createTemplateCollectionDocument, readTemplateCollectionDocument, MAX_TEMPLATE_COLLECTION_BYTES } from './template-collection.mjs';
import { saveCustomTemplate, TEMPLATES } from './template-catalog.mjs';
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
    let importRequest = 0, dialogGeneration = 0, galleryGeneration = 0, galleryView;
    function modalOpen(...args) { dialogGeneration++; openModal(...args); }
    const galleryUI = { query: '', category: '전체' };
    let savedTemplates = [], favoriteTemplates = [], templateLibraryError = '';
    function renderAndFocusTemplate(id, render = refresh) {
        const previous = galleryGeneration, dialog = dialogGeneration;
        const query = galleryUI.query, category = galleryUI.category;
        render();
        // A newer modal, filter or gallery render owns its own focus.
        if (galleryGeneration !== previous + 1 || dialogGeneration !== dialog || modal.open ||
            galleryUI.query !== query || galleryUI.category !== category) return;
        galleryView?.focusTemplate(id);
    }
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
            if (file.size > MAX_TEMPLATE_COLLECTION_BYTES)
                throw templateError('templates.collectionSize');
            const bytes = await file.arrayBuffer();
            if (request !== importRequest)
                return;
            if (bytes.byteLength > MAX_TEMPLATE_COLLECTION_BYTES)
                throw templateError('templates.collectionSize');
            let text;
            try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
            catch { throw templateError('templates.utf8'); }
            let document;
            try { document = JSON.parse(text); }
            catch (error) {
                if (error instanceof SyntaxError) throw new LocalizedError(message('templates.invalidFile'));
                throw error;
            }
            const collection = document?.format === 'moment-template-collection';
            if (!collection && (file.size > MAX_TEMPLATE_FILE_BYTES || bytes.byteLength > MAX_TEMPLATE_FILE_BYTES))
                throw templateError('templates.importSize');
            const imported = collection ? readTemplateCollectionDocument(document) : [readTemplateDocument(document)];
            if (!imported.length) {
                toast(message('templates.collectionEmpty'));
                return;
            }
            if (savedTemplates.length + imported.length > 20)
                throw templateError('templates.capacity');
            // Reserve IDs across the current library and this entire incoming batch.
            const ids = new Set([...TEMPLATES, ...savedTemplates, ...imported].map(item => item.id));
            for (const template of imported) {
                let id;
                for (let attempt = 0; attempt < 20; attempt++) {
                    const candidate = makeId();
                    if (typeof candidate === 'string' && candidate.trim() && candidate.length <= 200 && !ids.has(candidate)) {
                        id = candidate;
                        break;
                    }
                }
                if (!id) throw templateError('templates.collectionIdentity');
                ids.add(id);
                template.id = id;
                template.category = '내 템플릿';
            }
            const next = [...savedTemplates, ...imported];
            validateTemplateLibrary(next, favoriteTemplates);
            const previous = savedTemplates;
            savedTemplates = next;
            if (!persistTemplateLibrary('moment-templates-v1', next)) {
                savedTemplates = previous;
                return;
            }
            galleryUI.category = '내 템플릿';
            refresh();
            toast(collection ? message('templates.collectionImported', {count: imported.length}) : message('templates.imported'));
        }
        catch (error) {
            if (request === importRequest)
                toast(errorMessage(error, 'templates.invalidFile'));
        }
    }
    function exportCollection() {
        if (templateLibraryBlocked() || !savedTemplates.length) return;
        try {
            const document = createTemplateCollectionDocument(savedTemplates);
            const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' });
            if (blob.size > MAX_TEMPLATE_COLLECTION_BYTES)
                throw templateError('templates.collectionSize');
            download(blob, 'templates.moment-template-collection.json');
        } catch (error) {
            toast(errorMessage(error, 'templates.exportError'));
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
                renderAndFocusTemplate(id);
                toast(message('templates.updated'));
            }
            catch (error) {
                toast(errorMessage(error, 'templates.updateError'));
            }
        };
    }
    function duplicateTemplate(id) {
        if (templateLibraryBlocked()) return;
        const source = savedTemplates.find(item => item.id === id);
        if (!source) { toast(message('templates.duplicateMissing')); return; }
        if (savedTemplates.length >= 20) { toast(message('templates.capacity')); return; }
        const signature = JSON.stringify(source), suffix = t('templates.copySuffix');
        let base = '';
        for (const character of source.name) {
            if (base.length + character.length + suffix.length > 40) break;
            base += character;
        }
        modalOpen(message('templates.duplicateTitle'), `<label class="panel-label" for="duplicateTemplateName">${text('templates.name')}</label><input class="panel-input" id="duplicateTemplateName" maxlength="40" value="${esc(base + suffix)}">`, `<div class="modal-foot"><button class="button" id="cancelDuplicateTemplate">${text('templates.cancel')}</button><button class="button primary" id="confirmDuplicateTemplate">${text('templates.duplicate')}</button></div>`);
        const input = $('#duplicateTemplateName'), confirm = $('#confirmDuplicateTemplate'), generation = dialogGeneration;
        let active = true, composing = false;
        input.oncompositionstart = () => { composing = true; };
        input.oncompositionend = () => { composing = false; };
        const owns = () => active && generation === dialogGeneration && modal.open !== false && $('#confirmDuplicateTemplate') === confirm;
        $('#cancelDuplicateTemplate').onclick = () => { if (owns()) { active = false; modal.close(); } };
        confirm.onclick = event => {
            if (!owns() || composing || event?.isComposing || event?.keyCode === 229 || templateLibraryBlocked()) return;
            const current = savedTemplates.find(item => item.id === id);
            if (current !== source || JSON.stringify(current) !== signature) { toast(message('templates.duplicateStale')); return; }
            if (savedTemplates.length >= 20) { toast(message('templates.capacity')); return; }
            const name = input.value.trim();
            if (!name || name.length > 40) { toast(message('templates.nameLength')); input.focus(); return; }
            try {
                const copy = { ...structuredClone(source), id: makeId(), name };
                const next = [...savedTemplates, copy];
                validateTemplateLibrary(next, favoriteTemplates);
                const previous = savedTemplates;
                savedTemplates = next;
                if (!persistTemplateLibrary('moment-templates-v1', next)) { savedTemplates = previous; return; }
                active = false;
                modal.close();
                galleryUI.category = '전체';
                galleryUI.query = '';
                renderAndFocusTemplate(copy.id);
                toast(message('templates.duplicated'));
            } catch (error) { toast(errorMessage(error, 'templates.duplicateError')); }
        };
        input.focus();
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
            renderAndFocusTemplate(id);
            toast(message('templates.renamed'));
        };
    }
    function renderGallery(target) {
        const owner = ++galleryGeneration;
        const view = mount(target, {
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
            exportCollection,
            rename: renameTemplate,
            duplicate: duplicateTemplate,
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
                    renderAndFocusTemplate(id);
                };
            }
        });
        if (galleryGeneration === owner) galleryView = view;
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
            renderAndFocusTemplate(item.id, () => navigate('templates'));
            toast(message('templates.saved'));
        };
    }
    return { render: renderGallery };
}
