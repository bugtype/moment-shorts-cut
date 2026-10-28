import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { settingsPanelMarkup } from '../dist/panel-markup.mjs';
import { createDemoProject, createProjectDocument } from '../dist/core/project.mjs';
import { setLocale } from '../dist/i18n.mjs';

const ratios=['9:16','4:5','1:1','16:9'];
function ratioButtons(html) {
    return [...html.matchAll(/<button\b[^>]*data-ratio="([^"]+)"[^>]*>(.*?)<\/button>/gs)];
}

test('desktop and compact ratio pickers expose the same four numeric choices with decorative shapes', () => {
    const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
    const desktop=ratioButtons(html);
    assert.deepEqual(desktop.map(match=>match[1]),ratios);
    assert.equal(desktop.filter(match=>match[0].includes('aria-pressed="true"')).length,1);
    const css=fs.readFileSync(new URL('../dist/styles/inspector-dialogs.css',import.meta.url),'utf8');
    assert.match(css,/\.ratio-grid\s*\{[^}]*display:grid;[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
    assert.match(css,/\.ratio-shape\.feed-portrait\s*\{[^}]*width:20px;[^}]*height:25px/);
    try {
        for(const locale of ['ko','en','zh-CN']) {
            setLocale(locale,{persist:false});
            for(const ratio of ratios) {
                const state={...createDemoProject(),ratio};
                const mobile=ratioButtons(settingsPanelMarkup(state,state.clips[0]));
                assert.deepEqual(mobile.map(match=>match[1]),ratios);
                assert.equal(mobile.filter(match=>match[0].includes('aria-pressed="true"')).length,1);
                assert.ok(mobile.find(match=>match[1]===ratio)[0].includes('aria-pressed="true"'));
                for(const button of [...desktop,...mobile]) {
                    assert.match(button[2],/<i class="ratio-shape [^"]+" aria-hidden="true"><\/i><strong>[^<]+<\/strong>$/);
                    assert.doesNotMatch(button[2],/<small>/);
                }
            }
        }
    } finally {setLocale('ko',{persist:false});}
});

test('actual ratio choice makes one undoable edit with unchanged authored data, playhead and trim drafts', async () => {
    for(const panel of ['media','settings']) {
        const f=await createAppFixture();
        vm.runInContext(`current=2;history=[];switchPanel('${panel}');renderInspector();`,f.context);
        f.element('#trimStart').value='1.2345';
        f.element('#trimEnd').value='11.5';
        const before=f.evaluate('state');
        const button={dataset:{ratio:'4:5'}};
        f.documentEvents.get('click')({target:{closest:selector=>selector==='[data-ratio]'?button:null}});
        assert.deepEqual(f.evaluate('state'),{...before,ratio:'4:5'});
        assert.equal(f.evaluate('history.length'),1);
        assert.equal(f.evaluate('current'),2);
        assert.equal(f.element('#trimStart').value,'1.2345');
        assert.equal(f.element('#trimEnd').value,'11.5');
        assert.equal(f.element('#previewSize').textContent,'1080 × 1350');
        assert.equal(f.element('#preview').width,540);
        assert.equal(f.element('#preview').height,675);
        assert.equal(f.element('#canvasWrap').style.aspectRatio,'4/5');
        vm.runInContext('undo()',f.context);
        assert.deepEqual(f.evaluate('state'),before);
        vm.runInContext('undo(true)',f.context);
        assert.equal(f.evaluate('state.ratio'),'4:5');
    }
});

test('4:5 settings restore and failed-valid metadata edits preserve recovery storage protection', async () => {
    const f=await createAppFixture();
    const project={...createDemoProject(),ratio:'4:5'};
    f.context.ratioFile=new Blob([JSON.stringify(createProjectDocument(project))]);
    await vm.runInContext('importProjectSettings(ratioFile)',f.context);
    assert.equal(f.evaluate('state.ratio'),'4:5');
    assert.equal(f.element('#previewSize').textContent,'1080 × 1350');
    const writes=[];
    f.context.localStorage.setItem=(...args)=>writes.push(args);
    vm.runInContext("persistence.restorePhase='failed';persistence.recoveryValid=true;setRatio('1:1');setRatio('4:5');",f.context);
    assert.equal(f.evaluate('state.ratio'),'4:5');
    await vm.runInContext('saveProject(true);scheduleSave();undo();undo(true)',f.context);
    await new Promise(resolve=>setTimeout(resolve,300));
    assert.deepEqual(writes,[]);
});

test('4:5 preview PNG copies the actual 540 by 675 bitmap without project edits', async () => {
    const f=await createAppFixture(),copies=[],downloads=[];
    f.context.ratioDownloads=downloads;
    vm.runInContext("setRatio('4:5');panel='settings';renderPanel();download=(blob,name)=>ratioDownloads.push({blob,name});",f.context);
    f.doc.createElement=tag=>{
        assert.equal(tag,'canvas');
        const canvas={getContext:()=>({drawImage:source=>{canvas.source=source;}}),toBlob(callback){
            canvas.callback=callback;canvas.encoded=[canvas.width,canvas.height];
        }};
        copies.push(canvas);
        return canvas;
    };
    const before=f.evaluate('({state,history,current,playing})');
    f.element('#savePreviewPng').onclick();
    assert.deepEqual(copies[0].encoded,[540,675]);
    assert.deepEqual([copies[0].width,copies[0].height],[0,0]);
    assert.equal(copies[0].source,f.element('#preview'));
    assert.deepEqual([copies[0].source.width,copies[0].source.height],[540,675]);
    copies[0].callback(new Blob(['mock pixels'],{type:'image/png'}));
    assert.match(downloads[0].name,/\.preview-540x675\.png$/);
    assert.deepEqual(f.evaluate('({state,history,current,playing})'),before);
});
