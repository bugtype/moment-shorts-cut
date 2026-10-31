import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { applyTemplate, saveCustomTemplate, TEMPLATES } from '../dist/template-catalog.mjs';
import { createDemoProject } from '../dist/core/project.mjs';
import { prepareCommand } from '../dist/core/commands.mjs';
import { setLocale, initLocale, translateFor } from '../dist/i18n.mjs';

async function fixture() {
    const f = await createAppFixture();
    f.context.draws = [];
    vm.runInContext('state=initial();current=2;selected=0;sample.complete=true;sampleRaster={width:540,height:960};composition.draw=(...args)=>draws.push(args);',f.context);
    f.open = () => vm.runInContext('pause();templatePreview.open(TEMPLATES[1]);',f.context);
    f.current = () => { f.element('#templatePreviewMode').value='current'; f.element('#templatePreviewMode').onchange({}); };
    return f;
}

function trackFrames(f, copy = () => {}) {
    const frames = [], create = f.doc.createElement;
    f.doc.createElement = tag => {
        const frame = create(tag);
        if (tag === 'canvas') {
            const events = new Map();
            frame.addEventListener = (type, callback) => events.set(type, callback);
            frame.removeEventListener = (type, callback) => { if (events.get(type) === callback) events.delete(type); };
            frame.getContext = () => ({drawImage() { frame.bitmap = 'captured'; copy(frame); }});
            frame.events = events;
            // Model the standard's cleared backing store before loss, not native GPU behavior.
            frame.fire = type => {
                if (type === 'contextlost') frame.bitmap = 'empty';
                events.get(type)?.({preventDefault() { assert.fail('native restoration must remain allowed'); }});
            };
            frames.push(frame);
        }
        return frame;
    };
    return frames;
}

test('current scene compares detached styles on the same bounded raw source frame and exact output clock', async () => {
    const f = await fixture();
    vm.runInContext("state.kind='video';state.ratio='16:9';state.speed=4;state.clips=[{start:5,end:9},{start:5,end:9}];current=5;selected=1;video.videoWidth=7680;video.videoHeight=4320;",f.context);
    const before=f.evaluate('state'), history=f.evaluate('history'), clock=f.evaluate('current');
    f.open();f.current();
    const styled=f.context.draws.at(-1), expected=structuredClone(before);applyTemplate(expected,TEMPLATES[1],false);
    assert.deepEqual(JSON.parse(JSON.stringify(styled[3])),expected);
    assert.equal(styled[4].sourceTime,6);assert.equal(styled[4].time,1.25);assert.equal(styled[4].total,2);
    assert.equal(styled[4].sw,1920);assert.equal(styled[4].sh,1080);
    assert.notEqual(styled[4].source,f.element('#video'));
    f.element('#templateCurrentStyle').onclick({});const baseline=f.context.draws.at(-1);
    assert.deepEqual(JSON.parse(JSON.stringify(baseline[3])),before);assert.equal(baseline[4].source,styled[4].source);
    assert.deepEqual([styled[1],styled[2]],[432,243]);
    assert.deepEqual(f.evaluate('state'),before);assert.deepEqual(f.evaluate('history'),history);assert.equal(f.evaluate('current'),clock);
    f.element('#modal').open=false;f.element('#modal').onclose();assert.equal(styled[4].source.width,0);
});

test('sample remains available when current capture is unready; stale, busy and IME actions do not apply', async () => {
    for(const change of ["state.name='changed'","current=3","selected=1","sources.audioFile={name:'new'}","video.src='new'","loadingMedia=true"]){
        const f=await fixture();f.open();const before=f.evaluate('history');
        vm.runInContext(change,f.context);const project=f.evaluate('state');f.current();
        assert.match(f.element('#templateSceneStatus').textContent,/변경|불러올/);
        f.element('#applyTemplateStyle').onclick({});assert.deepEqual(f.evaluate('state'),project);assert.deepEqual(f.evaluate('history'),before);
    }
    const f=await fixture();vm.runInContext("state.kind='video';video.seeking=true;",f.context);f.open();
    const count=f.context.draws.length;f.current();assert.equal(f.context.draws.length,count);
    f.element('#templatePreviewMode').value='sample';f.element('#templatePreviewMode').onchange({});assert.equal(f.context.draws.length,count+1);
    f.element('#applyTemplateStyle').onclick({isComposing:true});assert.equal(f.evaluate('history.length'),0);
});

test('replacement and retained RAF callbacks cannot repaint or apply into the new template dialog', async () => {
    const f=await fixture();f.open();
    const oldApply=f.element('#applyTemplateStyle').onclick;
    f.element('#toggleTemplateDemo').onclick({});const callbacks=[...f.pendingFrames.values()];
    f.open();const count=f.context.draws.length;
    for(const callback of callbacks)callback(500);
    assert.equal(f.context.draws.length,count);oldApply({});assert.equal(f.evaluate('history.length'),0);
    f.current();f.element('#applyTemplateStyle').onclick({});assert.equal(f.evaluate('history.length'),1);
});

test('all three locales expose current comparison labels without translating authored content', async () => {
    const expected={ko:'현재 장면',en:'Current scene','zh-CN':'当前场景'};
    try { for(const locale of Object.keys(expected)){
        const f=await fixture();setLocale(locale);f.open();assert.ok(f.element('#modal').innerHTML.includes(expected[locale]));
        f.current();assert.deepEqual(f.evaluate('state.captions'),JSON.parse(JSON.stringify(f.context.draws.at(-1)[3].captions)));
    }}finally{initLocale();}
});

test('raw-frame copy failure preserves demo and closing/reopening disposes the captured frame', async()=>{
    const f=await fixture(), create=f.doc.createElement, error=new Error('copy failed');
    const failedFrames=trackFrames(f,()=>{throw error;});
    f.open();f.current();assert.match(f.element('#templateSceneStatus').textContent,/불러올/);
    assert.equal(failedFrames.length,1);assert.equal(failedFrames[0].width,0);assert.equal(failedFrames[0].height,0);
    assert.equal(failedFrames[0].events.size,0);
    assert.throws(()=>vm.runInContext('createTemplateScene(app).capture()',f.context),value=>value===error);
    assert.equal(failedFrames[1].events.size,0);assert.equal(failedFrames[1].width,0);
    f.element('#templatePreviewMode').value='sample';f.element('#templatePreviewMode').onchange({});
    f.doc.createElement=create;trackFrames(f);f.open();f.current();const snapshot=f.context.draws.at(-1)[4].source;
    const oldCompare=f.element('#templateCurrentStyle').onclick;
    vm.runInContext("modalOpen('Other','Other','');",f.context);assert.equal(snapshot.width,0);assert.equal(snapshot.events.size,0);
    const count=f.context.draws.length;oldCompare({});assert.equal(f.context.draws.length,count);
    f.open();f.current();const replacement=f.context.draws.at(-1)[4].source;
    f.element('#modal').onclose();assert.ok(replacement.width>0,'queued old close does not dispose open replacement');
    f.element('#modal').close();f.element('#modal').onclose();assert.equal(replacement.events.size,0);
});

test('lost comparison frames refuse once, release, and recapture only on an explicit retry', async () => {
    for (const restored of [false, true]) {
        const f = await fixture(), frames = trackFrames(f);
        vm.runInContext("state.kind='video';video.videoWidth=1920;video.videoHeight=1080;", f.context);
        f.open(); f.current();
        const before = f.evaluate('({state,history,future,current,selected,timer:persistence.saveTimer})');
        const frame = frames[0], lost = frame.events.get('contextlost');
        const button = f.element('#templateCurrentStyle'), status = f.element('#templateSceneStatus');
        button.focus(); const count = f.context.draws.length;
        frame.fire('contextlost'); if (restored) frame.fire('contextrestored');
        assert.equal(f.context.draws.length, count); assert.equal(frames.length, 1);
        assert.equal(status.textContent, ''); assert.equal(f.doc.activeElement, button);
        button.onclick({});
        assert.equal(f.context.draws.length, count, 'never compose from the cleared historical bitmap');
        assert.equal(frames.length, 1, 'failure does not silently capture a different frame');
        assert.equal(status.getAttribute('data-i18n'), 'templates.sceneUnavailable');
        assert.deepEqual([frame.width, frame.height, frame.events.size], [0, 0, 0]);
        assert.equal(f.doc.activeElement, button);
        assert.deepEqual(f.evaluate('({state,history,future,current,selected,timer:persistence.saveTimer})'), before);
        f.element('#templateSelectedStyle').onclick({});
        const fresh = frames[1]; assert.equal(frames.length, 2);
        assert.equal(f.context.draws.at(-1)[4].source, fresh); assert.equal(fresh.bitmap, 'captured');
        assert.equal(status.textContent, ''); assert.equal(status.getAttribute('data-i18n'), null);
        lost(); button.onclick({});
        assert.equal(frames.length, 2); assert.equal(f.context.draws.at(-1)[4].source, fresh);
        assert.equal(status.textContent, '', 'retired listener cannot invalidate the replacement');
        fresh.fire('contextlost');
        f.element('#templatePreviewMode').value = 'sample'; f.element('#templatePreviewMode').onchange({});
        assert.equal(frames.length, 2, 'sample mode never recaptures the comparison frame');
        assert.equal(f.pendingFrames.size, 0);
        const expected = structuredClone(before.state); applyTemplate(expected, TEMPLATES[1], false);
        f.element('#applyTemplateStyle').onclick({});
        assert.deepEqual(f.evaluate('state'), expected); assert.equal(f.evaluate('history.length'), 1);
        assert.equal(f.element('#modal').open, false); f.element('#modal').onclose();
        assert.deepEqual([fresh.width, fresh.height, fresh.events.size], [0, 0, 0]);
    }
    const f = await fixture(), frames = trackFrames(f, frame => frame.fire('contextlost'));
    f.open(); const count = f.context.draws.length; f.current();
    assert.equal(f.context.draws.length, count, 'a loss during capture is also rejected before drawing');
    assert.equal(f.element('#templateSceneStatus').getAttribute('data-i18n'), 'templates.sceneUnavailable');
    assert.deepEqual([frames.length, frames[0].width, frames[0].events.size], [1, 0, 0]);
});

test('failed-invalid and restoring metadata never apply a template',async()=>{
    for(const phase of ['failed','restoring']){
        const f=await fixture();vm.runInContext(`persistence.restorePhase='${phase}';persistence.recoveryValid=false;`,f.context);
        f.open();const before=f.evaluate('state');f.element('#applyTemplateStyle').onclick({});
        assert.deepEqual(f.evaluate('state'),before);assert.equal(f.evaluate('history.length'),0);
    }
});


test('stale sample playback shows stopped status after delayed raster load and can reopen cleanly', async () => {
    const f = await createAppFixture(), app = vm.runInContext('app', f.context);
    assert.equal(app.sampleRaster, null);
    vm.runInContext('pause();templatePreview.open(TEMPLATES[0]);', f.context);
    const before = f.evaluate('({state,history,future,current,selected,timer:persistence.saveTimer})');
    const button = f.element('#toggleTemplateDemo'), status = f.element('#templateSceneStatus');
    button.focus(); const focus = f.doc.activeElement;
    button.onclick({});
    assert.equal(button.getAttribute('data-i18n'), 'templates.pause');
    const [id, callback] = [...f.pendingFrames][0];
    app.sample.complete = true; app.sample.onload();
    assert.ok(app.sampleRaster);
    f.pendingFrames.delete(id); callback(performance.now());
    for (const [frame, draw] of [...f.pendingFrames]) { f.pendingFrames.delete(frame); draw(performance.now()); }
    assert.equal(f.pendingFrames.size, 0);
    assert.equal(button.getAttribute('data-i18n'), 'templates.play');
    assert.equal(status.getAttribute('data-i18n'), 'templates.sceneStale');
    assert.equal(f.doc.activeElement, focus);
    try {
        for (const locale of ['ko', 'en', 'zh-CN']) {
            setLocale(locale, {persist:false});
            assert.equal(button.textContent, translateFor(locale, 'templates.play'));
            assert.equal(status.textContent, translateFor(locale, 'templates.sceneStale'));
        }
    } finally { initLocale(); }
    button.onclick({});
    assert.equal(f.pendingFrames.size, 0, 'stale Play refuses before scheduling a doomed frame');
    vm.runInContext('templatePreview.open(TEMPLATES[0]);', f.context);
    button.onclick({}); assert.equal(f.pendingFrames.size, 1, 'freshly reopened scene plays');
    const [, freshCallback] = [...f.pendingFrames][0];
    const freshLabel = button.textContent, freshStatus = status.textContent;
    callback(performance.now());
    assert.equal(button.textContent, freshLabel); assert.equal(status.textContent, freshStatus);
    assert.equal(f.pendingFrames.size, 1, 'old callback cannot stop or repaint the replacement');
    button.onclick({}); assert.equal(f.pendingFrames.size, 0);
    const pausedStatus = status.textContent;
    freshCallback(performance.now());
    assert.equal(button.getAttribute('data-i18n'), 'templates.play');
    assert.equal(status.textContent, pausedStatus, 'retained valid callback after Pause is not a stale scene');
    assert.equal(f.pendingFrames.size, 0);
    f.element('#modal').close(); f.element('#modal').onclose();
    const closedLabel = button.textContent; freshCallback(performance.now());
    assert.equal(button.textContent, closedLabel);
    assert.deepEqual(f.evaluate('({state,history,future,current,selected,timer:persistence.saveTimer})'), before);
});


async function galleryFixture({custom = false} = {}) {
    const mounts = [];
    let buttons = [], favorites = [], nodes, markup = '', generation = 0, cardGeneration = 0;
    let modalNodes = new Map(), modalMarkup = '', modalGeneration = 0, invoker;
    const f = await createAppFixture({beforeInit({context, doc, element}) {
        const root = element('#panelContent'), modal = element('#modal');
        if (custom) {
            const saved = saveCustomTemplate('Saved focus', createDemoProject()); saved.id = 'custom-focus';
            context.localStorage.getItem = key => key === 'moment-templates-v1' ? JSON.stringify([saved]) : null;
        }
        function detach(items) {
            for (const node of items) {
                node.isConnected = false;
                if (doc.activeElement === node) doc.activeElement = doc.body;
            }
        }
        function connected(key) {
            const node = element(key); node.isConnected = true;
            const focus = node.focus;
            node.focus = options => { if (node.isConnected) focus.call(node, options); };
            return node;
        }
        // Model replacement/return ownership, not native browser focus timing.
        const query = doc.querySelector;
        doc.querySelector = selector => modalNodes.get(selector) || query(selector);
        doc.hasFocus = () => true;
        Object.defineProperty(modal, 'innerHTML', {get: () => modalMarkup, set(value) {
            detach(modalNodes.values()); modalMarkup = value; modalNodes = new Map(); modalGeneration++;
            for (const [, id] of value.matchAll(/id="([^"]+)"/g))
                modalNodes.set('#' + id, connected(`modal-${modalGeneration}-${id}`));
        }});
        modal.contains = node => node === modal || [...modalNodes.values()].includes(node);
        modal.showModal = () => {
            invoker = doc.activeElement; modal.open = true;
            modalNodes.get('#applyTemplateStyle')?.focus();
        };
        modal.close = () => {
            modal.open = false;
            if (invoker?.isConnected) invoker.focus();
            else if (modal.contains(doc.activeElement)) doc.activeElement = doc.body;
            invoker = null;
        };
        Object.defineProperty(root, 'innerHTML', {get: () => markup, set(value) {
            detach([...buttons, ...favorites, ...(nodes?.values() || [])]);
            markup = value; nodes = new Map(); generation++;
        }});
        root.querySelector = selector => {
            if (!nodes.has(selector)) {
                const node = connected(`gallery-${generation}-${selector}`);
                if (selector === '#templateGrid') Object.defineProperty(node, 'innerHTML', {
                    get: () => node.markup || '', set(value) {
                        detach([...buttons, ...favorites]); node.markup = value; cardGeneration++;
                        buttons = [...value.matchAll(/<button class="([^"]+)" data-preview-template="([^"]+)"/g)].map(([, cls, id], i) =>
                            Object.assign(connected(`gallery-${generation}-${cardGeneration}-preview-${i}`), {className:cls, dataset:{previewTemplate:id}}));
                        favorites = [...value.matchAll(/data-favorite="([^"]+)"/g)].map(([, id], i) =>
                            Object.assign(connected(`gallery-${generation}-${cardGeneration}-favorite-${i}`), {dataset:{favorite:id}}));
                    },
                });
                nodes.set(selector, node);
            }
            return nodes.get(selector);
        };
        root.querySelectorAll = selector => selector === '[data-preview-template]' ? buttons :
            selector === '.template-name' ? buttons.filter(b => b.className === 'template-name') :
            selector === '[data-favorite]' ? favorites : [];
        const mount = context.mountTemplateGallery;
        context.mountTemplateGallery = (target, options) => {
            const view = mount(target, options);
            mounts.push({active:options.active, query:options.ui.query, html:target.innerHTML + target.querySelector('#templateGrid').innerHTML, modalOpen:modal.open});
            return view;
        };
    }});
    vm.runInContext('current=3;', f.context);
    const element = f.element;
    return Object.assign(f, {mounts, element: selector => modalNodes.get(selector) || element(selector),
        preview: id => buttons.find(b => b.dataset.previewTemplate === id && b.className === 'template-name'),
        favorite: id => favorites.find(b => b.dataset.favorite === id)});
}

test('built-in gallery Apply keeps one refreshed gallery and its live controls', async () => {
    for (const withContent of [false, true]) {
        const f = await galleryFixture(), root = f.element('#panelContent');
        const search = root.querySelector('#templateSearch'); search.value = '브이로그'; search.oninput({target:search});
        const oldFavorite = f.favorite('clean').onclick;
        f.preview('clean').onclick();
        const apply = f.element(withContent ? '#applyTemplateStructure' : '#applyTemplateStyle').onclick;
        const before = f.evaluate('state'), expected = prepareCommand(before, 'template.apply', {templateId:'clean', withContent}).project;
        const outside = f.element('#projectName'); outside.focus(); const focusCount = f.focusEvents.length;
        f.mounts.length = 0; apply({});
        assert.equal(f.mounts.length, 1, 'shared command already refreshed the gallery');
        assert.equal(f.mounts[0].modalOpen, true, 'refresh still precedes modal close');
        assert.equal(f.mounts[0].active, 'clean'); assert.equal(f.mounts[0].query, '브이로그');
        assert.match(f.mounts[0].html, /template-card is-applied/);
        assert.deepEqual(f.evaluate('state'), expected);
        assert.equal(f.evaluate('history.length'), 1); assert.equal(f.evaluate('future.length'), 0);
        assert.equal(f.evaluate('current'), 0); assert.equal(f.evaluate('selectedCard ?? null'), expected.overlays[0]?.id ?? null);
        assert.equal(f.evaluate('modal.open'), false);
        assert.equal(f.doc.activeElement, outside); assert.equal(f.focusEvents.length, focusCount);
        const writes = []; f.context.localStorage.setItem = (...args) => writes.push(args);
        oldFavorite(); assert.deepEqual(writes, [], 'old guarded gallery control stays inert');
        f.preview('clean').onclick(); assert.equal(f.evaluate('modal.open'), true, 'retained refreshed gallery opens a new preview');
        apply({}); assert.equal(f.evaluate('history.length'), 1, 'old dialog Apply cannot mutate the replacement');
        f.mounts.length = 0; f.element('#applyTemplateStyle').onclick({});
        assert.equal(f.mounts.length, 1); assert.equal(f.evaluate('history.length'), 2);
    }
});

test('range duplication keeps the shared command gallery refresh and its current controls', async () => {
    const f = await galleryFixture();
    vm.runInContext('state.clips=[{start:0,end:2},{start:3,end:6},{start:8,end:12},{start:0,end:2}];timelineCache=null;selected=1;current=3;', f.context);
    const trigger = f.element('#duplicateClipRangeButton'); trigger.id = 'duplicateClipRangeButton';
    const before = f.evaluate('state'), expected = prepareCommand(before, 'timeline.duplicate', {clipIndex:1,count:2}).project;
    const oldFavorite = f.favorite('clean').onclick;
    trigger.focus(); trigger.onclick();
    f.element('#duplicateRangeFirst').value = '2'; f.element('#duplicateRangeLast').value = '3';
    f.mounts.length = 0; f.element('#confirmDuplicateRange').onclick({});
    assert.equal(f.mounts.length, 1, 'shared command already refreshed the gallery');
    assert.equal(f.mounts[0].modalOpen, true, 'refresh still precedes modal close');
    assert.deepEqual(f.evaluate('state'), expected);
    assert.deepEqual(f.evaluate('({history:history.length,future:future.length,selected,current,open:modal.open})'),
        {history:1,future:0,selected:3,current:9,open:false});
    assert.equal(f.doc.activeElement, trigger);
    const saved = [];
    f.context.saved = saved; vm.runInContext('download=blob=>saved.push(blob);', f.context);
    f.context.window.moment.downloadProject();
    assert.deepEqual(JSON.parse(await saved[0].text()).project, expected);
    const writes = []; f.context.localStorage.setItem = (...args) => writes.push(args);
    oldFavorite(); assert.deepEqual(writes, [], 'pre-command gallery callbacks remain stale');
    f.preview('clean').onclick(); assert.equal(f.evaluate('modal.open'), true, 'retained refreshed controls remain live');
});

test('range duplication retains other-panel refreshes, close-time panel changes and command refusal', async () => {
    for (const [initial, next] of [['effects','effects'], ['templates','effects'], ['effects','templates']]) {
        const f = await fixture();
        f.context.refreshes = [];
        vm.runInContext(`panel=${JSON.stringify(initial)};const originalPanelRender=renderPanel;renderPanel=()=>{refreshes.push({panel,open:modal.open});originalPanelRender();};`, f.context);
        const trigger = f.element('#duplicateClipRangeButton'); trigger.id = 'duplicateClipRangeButton';
        trigger.onclick();
        const close = f.element('#modal').close.bind(f.element('#modal'));
        f.element('#modal').close = () => { close(); vm.runInContext(`panel=${JSON.stringify(next)};`, f.context); };
        f.element('#confirmDuplicateRange').onclick({});
        assert.deepEqual(f.evaluate('refreshes'), [{panel:initial,open:true},{panel:next,open:false}]);
        assert.equal(f.evaluate('history.length'), 1);
        if (initial === next) assert.equal(f.doc.activeElement, trigger);
    }
    const f = await fixture(), trigger = f.element('#duplicateClipRangeButton'); trigger.id = 'duplicateClipRangeButton';
    trigger.onclick(); const before = f.evaluate('({state,history,future,selected,current})');
    vm.runInContext("runEditorCommand=()=>false;renderPanel=renderTimeline=renderInspector=seekTo=()=>{throw new Error('unexpected caller refresh');};", f.context);
    f.element('#confirmDuplicateRange').onclick({});
    assert.deepEqual(f.evaluate('({state,history,future,selected,current})'), before);
    assert.equal(f.evaluate('modal.open'), true);
});

test('Apply retains custom, other-panel and public command refreshes and command failure order', async () => {
    const f = await fixture();
    f.context.refreshes = [];
    vm.runInContext("const originalPanelRender=renderPanel;renderPanel=()=>{refreshes.push({panel,open:modal.open});originalPanelRender();};", f.context);
    f.context.custom = saveCustomTemplate('Saved style', f.evaluate('state'));
    vm.runInContext('templatePreview.open(custom);', f.context);
    f.element('#applyTemplateStyle').onclick({});
    assert.deepEqual(f.evaluate('refreshes'), [{panel:'templates',open:false}]);
    vm.runInContext("panel='effects';refreshes=[];templatePreview.open(TEMPLATES[1]);", f.context);
    f.element('#applyTemplateStyle').onclick({});
    assert.deepEqual(f.evaluate('refreshes'), [{panel:'effects',open:true},{panel:'effects',open:false}]);
    vm.runInContext("panel='templates';refreshes=[];", f.context);
    assert.equal((await f.context.window.moment.execute('template.apply', {templateId:'clean'})).ok, true);
    assert.deepEqual(f.evaluate('refreshes'), [{panel:'templates',open:false}]);
    vm.runInContext("current=3;templatePreview.open(TEMPLATES[1]);renderPanel=()=>{throw new Error('gallery failed');};", f.context);
    const history = f.evaluate('history.length');
    f.element('#applyTemplateStyle').onclick({});
    assert.equal(f.evaluate('history.length'), history + 1, 'existing command has committed before its render fails');
    assert.equal(f.evaluate('modal.open'), true); assert.equal(f.evaluate('current'), 3);
    assert.equal(f.element('#toast').textContent, 'gallery failed');
});


test('gallery Apply returns owned focus to the replacement name without another render', async () => {
    for (const custom of [false, true]) {
        const f = await galleryFixture({custom}), id = custom ? 'custom-focus' : 'clean';
        const opener = f.preview(id); opener.focus(); opener.onclick();
        f.element('#closeModal').onclick();
        assert.equal(f.doc.activeElement, opener, 'Cancel keeps its existing connected opener');
        assert.equal(f.evaluate('history.length'), 0);
        opener.onclick();
        const before = f.evaluate('state');
        f.mounts.length = 0;
        f.element(custom ? '#applyTemplateStructure' : '#applyTemplateStyle').onclick({});
        assert.equal(f.mounts.length, 1);
        assert.notEqual(f.preview(id), opener); assert.equal(opener.isConnected, false);
        assert.equal(f.doc.activeElement, f.preview(id));
        assert.equal(f.evaluate('history.length'), 1); assert.equal(f.evaluate('future.length'), 0);
        assert.equal(f.evaluate('current'), 0); assert.equal(f.evaluate('modal.open'), false);
        const expected = custom ? structuredClone(before) : prepareCommand(before, 'template.apply', {templateId:id}).project;
        if (custom) {
            const saved = saveCustomTemplate('Saved focus', createDemoProject()); saved.id = id;
            applyTemplate(expected, saved, true);
        }
        assert.deepEqual(f.evaluate('state'), expected);
    }
});

test('Apply focus return yields to newer focus, gallery and dialog owners', async () => {
    for (const change of ['background', 'filter', 'gallery', 'dialog', 'outside']) {
        const f = await galleryFixture(), opener = f.preview('clean');
        opener.focus(); opener.onclick();
        let focusAfterInterruption;
        f.context.interruptFocus = () => {
            if (change === 'background') f.doc.hasFocus = () => false;
            if (change === 'filter') {
                const search = f.element('#panelContent').querySelector('#templateSearch');
                search.value = '인터뷰'; search.oninput({target:search});
            }
            if (change === 'gallery') vm.runInContext('renderPanel();', f.context);
            if (change === 'dialog') vm.runInContext('templatePreview.open(TEMPLATES[2]);modal.close();', f.context);
            if (change === 'outside') f.element('#projectName').focus();
            focusAfterInterruption = f.focusEvents.length;
        };
        vm.runInContext('const oldSeek=seekTo;seekTo=(...args)=>{oldSeek(...args);interruptFocus();};', f.context);
        f.element('#applyTemplateStyle').onclick({});
        assert.equal(f.focusEvents.length, focusAfterInterruption, change);
        if (change === 'outside') assert.equal(f.doc.activeElement, f.element('#projectName'));
        assert.equal(f.evaluate('history.length'), 1);
    }
});
