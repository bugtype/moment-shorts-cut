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
        templateLibraryError = '저장된 템플릿·즐겨찾기를 읽을 수 없습니다. 원본 저장값은 유지되며 이번 세션의 템플릿 저장·삭제·즐겨찾기 변경은 차단됩니다. 기본 템플릿과 프로젝트 편집은 사용할 수 있습니다. 새로고침은 읽기를 다시 시도합니다.';
    }
    function templateLibraryBlocked() {
        if (!templateLibraryError)
            return false;
        toast(templateLibraryError);
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
            toast('템플릿·즐겨찾기를 저장하지 못했습니다. 설정과 브라우저 저장 공간을 확인하세요.');
            return false;
        }
    }
    async function importTemplate(file) {
        const request = ++importRequest;
        if (templateLibraryBlocked())
            return;
        try {
            if (file.size > MAX_TEMPLATE_FILE_BYTES)
                throw new Error('템플릿 파일은 256 KiB 이하만 불러올 수 있습니다.');
            const bytes = await file.arrayBuffer();
            if (request !== importRequest)
                return;
            if (bytes.byteLength > MAX_TEMPLATE_FILE_BYTES)
                throw new Error('템플릿 파일은 256 KiB 이하만 불러올 수 있습니다.');
            let text;
            try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
            catch { throw new Error('템플릿 파일을 UTF-8로 저장한 뒤 다시 불러오세요.'); }
            const template = readTemplateDocument(JSON.parse(text));
            if (savedTemplates.length >= 20)
                throw new Error('내 템플릿은 20개까지 저장할 수 있습니다.');
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
            toast('내 템플릿으로 불러왔습니다.');
        }
        catch (error) {
            if (request === importRequest)
                toast(error.message || '템플릿 파일을 확인하세요.');
        }
    }
    function exportTemplate(id) {
        try {
            const template = savedTemplates.find(item => item.id === id);
            if (!template)
                throw new Error('내보낼 템플릿을 찾을 수 없습니다.');
            const text = JSON.stringify(createTemplateDocument(template), null, 2);
            const blob = new Blob([text], { type: 'application/json' });
            if (blob.size > MAX_TEMPLATE_FILE_BYTES)
                throw new Error('템플릿 파일은 256 KiB 이하만 저장할 수 있습니다.');
            download(blob, `${template.name}.moment-template.json`);
        }
        catch (error) {
            toast(error.message || '템플릿을 저장하지 못했습니다.');
        }
    }
    function updateTemplate(id) {
        if (templateLibraryBlocked()) return;
        const item = savedTemplates.find(template => template.id === id);
        if (!item) {
            toast('업데이트할 템플릿을 찾을 수 없습니다.');
            return;
        }
        modalOpen('현재 구성으로 업데이트할까요?', `<p class="modal-copy">${esc(item.name)}의 저장된 스타일과 문구·장면 카드를 덮어씁니다. 이전 버전이 필요하면 먼저 파일로 저장하세요. 현재 프로젝트와 미디어는 바뀌지 않습니다.</p>`, '<div class="modal-foot"><button class="button" id="cancelUpdateTemplate">취소</button><button class="button primary" id="confirmUpdateTemplate">업데이트</button></div>');
        const confirm = $('#confirmUpdateTemplate'), generation = dialogGeneration;
        let active = true;
        $('#cancelUpdateTemplate').onclick = () => { active = false; modal.close(); };
        confirm.onclick = () => {
            if (!active || generation !== dialogGeneration || modal.open === false || $('#confirmUpdateTemplate') !== confirm || templateLibraryBlocked()) return;
            const current = savedTemplates.find(template => template.id === id);
            if (!current) {
                toast('업데이트할 템플릿을 찾을 수 없습니다.');
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
                toast('현재 구성으로 템플릿을 업데이트했습니다.');
            }
            catch (error) {
                toast(error.message || '템플릿을 업데이트하지 못했습니다.');
            }
        };
    }
    function renameTemplate(id) {
        if (templateLibraryBlocked()) return;
        const item = savedTemplates.find(template => template.id === id);
        if (!item) {
            toast('이름을 바꿀 템플릿을 찾을 수 없습니다.');
            return;
        }
        modalOpen('템플릿 이름 변경', `<label class="panel-label" for="renameTemplateName">템플릿 이름</label><input class="panel-input" id="renameTemplateName" maxlength="40" value="${esc(item.name)}">`, '<div class="modal-foot"><button class="button" id="cancelRenameTemplate">취소</button><button class="button primary" id="confirmRenameTemplate">이름 변경</button></div>');
        $('#cancelRenameTemplate').onclick = () => modal.close();
        $('#confirmRenameTemplate').onclick = () => {
            if (templateLibraryBlocked()) return;
            const current = savedTemplates.find(template => template.id === id);
            if (!current) {
                toast('이름을 바꿀 템플릿을 찾을 수 없습니다.');
                return;
            }
            const name = $('#renameTemplateName').value.trim();
            if (!name || name.length > 40) {
                toast('템플릿 이름은 1~40자로 입력하세요.');
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
            toast('템플릿 이름을 바꿨습니다.');
        };
    }
    function renderGallery(target) {
        mount(target, {
            ui: galleryUI,
            active: getProject().templateId,
            custom: savedTemplates,
            favorites: favoriteTemplates,
            error: templateLibraryError,
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
                modalOpen('내 템플릿을 삭제할까요?', '<p class="modal-copy">현재 편집 중인 영상은 그대로 유지됩니다.</p>', '<div class="modal-foot"><button class="button" id="cancelRemoveTemplate">취소</button><button class="button primary" id="confirmRemoveTemplate">템플릿 삭제</button></div>');
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
            toast('내 템플릿은 20개까지 저장할 수 있습니다.');
            return;
        }
        modalOpen('나만의 구성으로 저장', `<p class="modal-copy">타이틀 스타일·자막 스타일·효과·구간별 문구를 저장합니다. 영상과 오디오는 포함하지 않습니다.</p><label class="panel-label" for="customTemplateName">템플릿 이름</label><input class="panel-input" id="customTemplateName" maxlength="40" value="${esc(getProject().name)} 스타일">`, '<div class="modal-foot"><button class="button primary" id="saveCustomTemplate">이 브라우저에 저장</button></div>');
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
            toast('내 템플릿을 저장했습니다.');
        };
    }
    return { render: renderGallery };
}
