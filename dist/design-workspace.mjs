import { createCardTimingDialog } from './card-timing-dialog.mjs';
import { setText, setAttr, message } from './i18n.mjs';
import { mountDesignPanel } from './design-panel.mjs';
import { mountEffectsPanel } from './effects-panel.mjs';
import { activeSceneLayers, defaultEnhancements, newCard, sceneBounds } from './effects.mjs';

// Design and effect panels own their controls; this workspace supplies the project
// context, selection guides and the shared preview/undo callbacks.
export function createDesignWorkspace(app) {
    const { query: $ } = app;
    const appearanceKeys = ['color', 'accent', 'background', 'size', 'stroke', 'backgroundOpacity', 'presentation', 'animation'];
    let copiedAppearance = null;
    const cardTiming = createCardTimingDialog(app);

    function selectedSceneLayer() {
        const active = activeSceneLayers(app.state, app.current / app.state.speed);
        if (app.panel === 'effects' && app.effectTab === 'cards')
            return active.find(card => card.id === (app.selectedCard || app.state.overlays[0]?.id));
        if (app.panel === 'text' && app.textLayer === 'title')
            return active.find(card => (card.role || 'headline') === 'headline');
        return null;
    }

    function updateLayerGuide() {
        const guide = $('#layerSelection');
        if (!guide)
            return;
        const state = app.state, textLayer = app.textLayer;
        const scene = selectedSceneLayer(), isText = app.panel === 'text' && textLayer !== 'frame';
        const layer = textLayer === 'caption' ? { x: state.captionX, y: state.captionY, enabled: true } : state.design[textLayer];
        guide.hidden = !scene && (!isText || !layer?.enabled);
        if (scene) {
            const box = sceneBounds(scene, app.canvas.width, app.canvas.height);
            guide.style.left = `${box.x / app.canvas.width * 100}%`;
            guide.style.top = `${box.y / app.canvas.height * 100}%`;
            guide.style.width = `${box.width / app.canvas.width * 100}%`;
            guide.style.height = `${box.height / app.canvas.height * 100}%`;
            setAttr(guide, 'data-label', 'panels.timedTitle');
        }
        else if (!guide.hidden) {
            guide.style.width = '84%';
            guide.style.left = `${layer.x * 100}%`;
            guide.style.top = `${layer.y * 100}%`;
            setAttr(guide, 'data-label', {title:'panels.title',caption:'panels.dialogue',credit:'panels.credit'}[textLayer]);
            guide.style.height = textLayer === 'title' ? '16%' : textLayer === 'credit' ? '7%' : '12%';
        }
        setText($('#moveHint'), scene || isText ? 'panels.dragText' : 'panels.dragVideo');
    }

    function previewDesign(change) {
        change(app.state);
        app.timelineView.renderLayers(app.state, app.duration());
        updateLayerGuide();
        app.requestDraw();
        app.scheduleSave();
        $('#undoButton').disabled = !app.history.length;
        $('#redoButton').disabled = !app.future.length;
    }

    function renderDesignPanel(target) {
        mountDesignPanel(target, {
            state: app.state,
            layer: app.textLayer,
            time: app.current / app.state.speed,
            total: app.duration() / app.state.speed,
            snapshot: app.snapshot,
            input: app.inputHistory.bind,
            update: previewDesign,
            navigate: app.switchPanel,
            timedTitle(id) {
                app.selectedCard = id;
                app.effectTab = 'cards';
                app.switchPanel('effects');
            },
            select(layer) {
                app.textLayer = layer;
                app.renderPanel();
                updateLayerGuide();
            },
            preset(preset) {
                if (!app.runEditorCommand('template.apply', { templateId: preset }))
                    return;
                app.toast(message('panels.layoutApplied'));
            },
            captionStyle(style) {
                app.edit(() => {
                    app.state.style = style;
                    app.state.captionItalic = style !== 'minimal';
                    app.state.captionStroke = style === 'minimal' ? 2 : 3;
                }, true);
            }
        });
    }

    function renderEffects(target) {
        const project = app.state;
        mountEffectsPanel(target, {
            state: app.state,
            total: app.duration() / app.state.speed,
            tab: app.effectTab,
            selected: app.selectedCard,
            current: () => app.state === project,
            moveTime: id => { if (app.state === project && (app.selectedCard || app.state.overlays[0]?.id) === id) cardTiming.open(id); },
            hasCopiedAppearance: copiedAppearance !== null,
            copyAppearance(id) {
                if (app.state !== project) return false;
                const card = app.state.overlays.find(item => item.id === id);
                if (!card) return false;
                copiedAppearance = structuredClone(Object.fromEntries(appearanceKeys.filter(key => Object.hasOwn(card, key)).map(key => [key, card[key]])));
                app.renderPanel();
                app.toast(message('panels.styleCopied'));
                return true;
            },
            pasteAppearance(id) {
                if (app.state !== project) return false;
                const card = app.state.overlays.find(item => item.id === id);
                if (!card || !copiedAppearance) return false;
                if (Object.entries(copiedAppearance).every(([key, value]) => card[key] === value)) {
                    app.toast(message('panels.sameStyle'));
                    return false;
                }
                return app.runEditorCommand('overlays.update', { id, patch: structuredClone(copiedAppearance) });
            },
            snapshot: app.snapshot,
            input: app.inputHistory.bind,
            update: previewDesign,
            changeTab(tab) {
                app.effectTab = tab;
                app.renderPanel();
            },
            toggleAll() {
                const visible = app.state.overlays.some(card => card.enabled !== false);
                app.edit(() => app.state.overlays.forEach(card => card.enabled = !visible), true);
            },
            reset() {
                app.edit(() => app.state.effects = defaultEnhancements().effects, true);
            },
            add() {
                if (app.state.overlays.length >= 12)
                    return;
                app.edit(() => {
                    const card = newCard(app.duration() / app.state.speed, app.current / app.state.speed);
                    app.selectedCard = card.id;
                    app.state.overlays.push(card);
                }, true);
            },
            select(id) {
                app.selectedCard = id;
                const card = app.state.overlays.find(item => item.id === id);
                app.pause();
                if (card)
                    app.seekTo(Math.min(card.end - .001, card.start + .2) * app.state.speed);
                app.renderPanel();
            },
            move: (id, toIndex) => app.runEditorCommand('overlays.move', { id, toIndex }),
            remove(id) {
                app.edit(() => {
                    app.state.overlays = app.state.overlays.filter(card => card.id !== id);
                    app.selectedCard = app.state.overlays[0]?.id;
                }, true);
            },
            duplicate(id) {
                if (app.state.overlays.length >= 12) {
                    app.toast(message('panels.cardLimit'));
                    return;
                }
                app.edit(() => {
                    const card = structuredClone(app.state.overlays.find(item => item.id === id));
                    card.id = newCard(app.duration() / app.state.speed).id;
                    app.selectedCard = card.id;
                    app.state.overlays.push(card);
                }, true);
            },
            play(start) {
                const card = app.state.overlays.find(item => item.id === app.selectedCard) || app.state.overlays[0];
                app.pause();
                app.seekTo(start * app.state.speed);
                app.cardPlaybackEnd = card?.end ?? null;
                app.play();
            }
        });
    }

    return { selectedSceneLayer, updateLayerGuide, previewDesign, renderDesignPanel, renderEffects };
}
