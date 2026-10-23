import { readTemplateLibrary, validateTemplateLibrary } from './template-library.mjs';
import { saveCustomTemplate } from './template-catalog.mjs';
import { mountTemplateGallery } from './template-gallery.mjs';
import { esc } from './ui-format.mjs';

// Own the template library independently of project state and project persistence.
export function createTemplateWorkspace({
    getProject, query: $, modal, openModal: modalOpen,
    thumbnail, preview, refresh, navigate, toast,
}, {
    readStorage = key => localStorage.getItem(key),
    writeStorage = (key, value) => localStorage.setItem(key, value),
    mount = mountTemplateGallery,
} = {}) {
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
    function persistTemplateLibrary() {
        if (templateLibraryBlocked())
            return false;
        try {
            validateTemplateLibrary(savedTemplates, favoriteTemplates);
            writeStorage('moment-templates-v1', JSON.stringify(savedTemplates));
            writeStorage('moment-favorites-v1', JSON.stringify(favoriteTemplates));
            return true;
        }
        catch {
            toast('템플릿·즐겨찾기를 저장하지 못했습니다. 설정과 브라우저 저장 공간을 확인하세요.');
            return false;
        }
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
            favorite(id) {
                if (templateLibraryBlocked())
                    return;
                const previous = [...favoriteTemplates], i = favoriteTemplates.indexOf(id);
                if (i < 0)
                    favoriteTemplates.push(id);
                else
                    favoriteTemplates.splice(i, 1);
                if (!persistTemplateLibrary())
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
                    if (!persistTemplateLibrary()) {
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
            if (!persistTemplateLibrary()) {
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
