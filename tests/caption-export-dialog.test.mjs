import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createAppFixture} from './fixtures/app.mjs';
import {projectSubtitles} from '../dist/core/project.mjs';
import {setLocale,initLocale} from '../dist/i18n.mjs';

test('caption factories link natively without accessing browser resources during initialization', () => {
    // The VM fixture strips imports. This child checks real bindings and safe
    // module initialization, not browser behavior or factory invocation.
    const urls = ['caption-export-dialog.mjs', 'caption-workspace.mjs']
        .map(file => new URL('../dist/' + file, import.meta.url).href);
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
        import assert from 'node:assert/strict';
        for (const name of ['window', 'document', 'navigator', 'localStorage', 'indexedDB',
            'Worker', 'Image', 'AudioContext', 'OfflineAudioContext', 'XMLHttpRequest', 'fetch']) {
            Object.defineProperty(globalThis, name, {configurable:true, get() {
                throw new Error('Unexpected browser resource access: ' + name);
            }});
        }
        const urls = ${JSON.stringify(urls)};
        assert.equal(typeof (await import(urls[0])).createCaptionExportDialog, 'function');
        assert.equal(typeof (await import(urls[1])).createCaptionWorkspace, 'function');
        console.log('Caption factories linked.');
    `], {encoding:'utf8', timeout:10000, maxBuffer:1024 * 1024});
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, 'Caption factories linked.\n');
});

async function fixture(setup='') {
    const f=await createAppFixture(), downloads=[], writes=[];
    f.context.collectCaptionExport=(blob,name)=>downloads.push({blob,name});
    f.context.localStorage.setItem=(...args)=>writes.push(args);
    vm.runInContext(`download=(blob,name)=>collectCaptionExport(blob,name);state.name='review';state.speed=2;
        state.clips=[{start:2,end:4},{start:0,end:2},{start:2,end:4}];
        state.captions=[{start:2,end:3,text:'한글 <b>A</b>',speaker:'0'},
            {start:0,end:1,text:'timeline 文本',basis:'timeline'},
            {start:10,end:11,text:'trimmed'}, {start:0,end:1,text:'outside'}];
        ${setup};history=[];future=[];current=1;globalThis.exportSaves=0;scheduleSave=()=>exportSaves++;
        switchPanel('captions');playing=true;`,f.context);
    f.downloads=downloads;f.writes=writes;
    f.choose=(format,scope='range')=>{for(const [id,value] of [['captionExportFormat',format],['captionExportScope',scope]]){f.element('#'+id).value=value;f.element('#'+id).onchange();}};
    f.open=(format='srt')=>{f.choose(format);f.element('#downloadCaptions').onclick();};
    f.save=(first,last)=>{f.element('#captionExportFirst').value=String(first);f.element('#captionExportLast').value=String(last);f.element('#confirmCaptionExport').onclick();};
    f.snapshot=()=>f.evaluate('({state,history,future,current,playing,exportSaves})');
    return f;
}

for(const format of ['srt','vtt','txt','review-txt'])test(`${format}: default all-save parity and explicit range preserve global clocks and project`,async()=>{
    const f=await fixture(),before=f.snapshot();
    f.choose(format,'all');f.element('#downloadCaptions').onclick();
    assert.notEqual(f.element('#modal').open,true);assert.equal(f.downloads.length,1);
    const options={format:format==='review-txt'?'txt':format,bom:format==='srt',...(format==='review-txt'?{review:true}:{})};
    const compare=async(item,range,suffix)=>{
        assert.equal(item.name,`review${suffix}.${format==='review-txt'?'review.txt':format}`);
        const expected=new TextEncoder().encode(projectSubtitles(before.state,{...options,...range}));
        assert.deepEqual(new Uint8Array(await item.blob.arrayBuffer()),expected);
        assert.equal(item.blob.type,format==='vtt'?'text/vtt;charset=utf-8':'text/plain;charset=utf-8');
    };
    await compare(f.downloads[0],{},'');
    f.open(format);assert.equal(f.element('#captionExportFirst').value,'1');assert.equal(f.element('#captionExportLast').value,'1');
    assert.equal(f.downloads.length,1);assert.deepEqual(f.snapshot(),before);
    f.save(1,3);assert.equal(f.downloads.length,2);assert.equal(f.element('#modal').open,false);
    await compare(f.downloads[1],{captionIndex:0,count:3},'.rows-1-3');
    assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.writes,[]);
});

test('range can cross pages; opening uses visible first row, never a presumed page selection',async()=>{
    const f=await fixture("state.captions=Array.from({length:70},(_,i)=>({start:0,end:1,text:'row '+(i+1)}))");
    f.element('#nextCaptionPage').onclick();f.open('txt');
    assert.equal(f.element('#captionExportFirst').value,'51');assert.equal(f.element('#captionExportLast').value,'51');
    const before=f.snapshot();f.save(49,53);
    assert.equal(await f.downloads[0].blob.text(),projectSubtitles(before.state,{format:'txt',captionIndex:48,count:5}));
    assert.equal(f.downloads[0].name,'review.rows-49-53.txt');assert.deepEqual(f.snapshot(),before);
});

test('invalid, trimmed-empty and failed downloads stay open; cancel is read-only and errors allow retry',async()=>{
    const f=await fixture();f.open();const before=f.snapshot();
    for(const [first,last] of [['',1],[0,1],[1.5,2],[3,2],[1,5],['Infinity',2],[1,'NaN']]){f.save(first,last);assert.equal(f.downloads.length,0);assert.equal(f.element('#modal').open,true);}
    f.save(3,3);assert.equal(f.downloads.length,0);assert.equal(f.element('#modal').open,true);
    vm.runInContext("download=()=>{throw new Error('download blocked')}",f.context);f.save(1,1);assert.equal(f.element('#modal').open,true);assert.match(f.element('#toast').textContent,/download blocked/);
    vm.runInContext('download=(blob,name)=>collectCaptionExport(blob,name)',f.context);f.save(1,1);assert.equal(f.downloads.length,1);
    f.open();f.element('#cancelCaptionExport').onclick();assert.equal(f.downloads.length,1);assert.deepEqual(f.snapshot(),before);
    const empty=await fixture('state.captions=[]');empty.open();assert.notEqual(empty.element('#modal').open,true);assert.equal(empty.downloads.length,0);
});

test('stale contexts, closed/replaced dialogs, IME and busy actions never download',async()=>{
    for(const change of ["state.captions[0].text='changed'",'state=structuredClone(state)','sources.videoFile={}','sources.audioFile={}',"switchPanel('text')","modal.close()","modalOpen('Replacement','')",'loadingMedia=true','exporting=true','transcribing=true',"persistence.restorePhase='failed';persistence.recoveryValid=false","Object.defineProperty(audioRecording,'requesting',{get:()=>true})","Object.defineProperty(audioRecording,'current',{get:()=>({})})"]){
        const f=await fixture();f.open();const old=f.element('#confirmCaptionExport').onclick;vm.runInContext(change,f.context);const before=f.snapshot();old();assert.equal(f.downloads.length,0);assert.deepEqual(f.snapshot(),before);
    }
    const f=await fixture();f.open();const old=f.element('#confirmCaptionExport').onclick;f.element('#cancelCaptionExport').onclick();f.open();old();assert.equal(f.downloads.length,0);
    const input=f.element('#captionExportFirst'),confirm=f.element('#confirmCaptionExport');
    confirm.onclick({isComposing:true});confirm.onclick({keyCode:229});input.oncompositionstart();confirm.onclick();assert.equal(f.downloads.length,0);input.oncompositionend();
    input.onkeydown({key:'Enter',altKey:true});assert.equal(f.downloads.length,0);input.onkeydown({key:'Enter',preventDefault(){}});assert.equal(f.downloads.length,1);
});

test('locale switching preserves range drafts; all three localized scope options and dialog labels exist',async()=>{
    try {
        for(const [locale,label] of [['ko','첫 작성 행'],['en','First authored row'],['zh-CN','首个编写行']]){
            const f=await fixture();setLocale(locale,{persist:false});vm.runInContext('renderPanel()',f.context);f.open();assert.ok(f.element('#modal').innerHTML.includes(label));
            f.element('#captionExportFirst').value='2';const input=f.element('#captionExportFirst'),before=f.snapshot();
            setLocale(locale==='en'?'ko':'en',{persist:false});assert.equal(input.value,'2');assert.equal(f.element('#captionExportFirst'),input);assert.deepEqual(f.snapshot(),before);
        }
    }finally{initLocale();}
});

test('export controls use a shrinking two-column group, separate from Add, without a nowrap toolbar overflow',async()=>{
    const f=await fixture(),html=f.element('#panelContent').innerHTML;
    assert.match(html,/id="addCaption"[^]*?<\/div><div class="caption-export-controls">/);
    const css=fs.readFileSync(new URL('../dist/styles/workspace-state.css',import.meta.url),'utf8');
    assert.match(css,/\.caption-export-controls\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
    assert.match(css,/#captionExportScope\s*\{[^}]*min-width:0/);
});

test('scope defaults to all, survives panel redraw in memory and blocks range entry during busy/IME',async()=>{
    const f=await fixture();assert.equal(f.element('#captionExportScope').value,'all');f.choose('vtt');
    vm.runInContext('renderPanel()',f.context);assert.equal(f.element('#captionExportScope').value,'range');assert.equal(f.element('#captionExportFormat').value,'vtt');
    f.element('#downloadCaptions').onclick({isComposing:true});assert.notEqual(f.element('#modal').open,true);
    vm.runInContext('loadingMedia=true',f.context);f.element('#downloadCaptions').onclick();assert.notEqual(f.element('#modal').open,true);
    vm.runInContext('loadingMedia=false',f.context);f.element('#downloadCaptions').onclick();assert.equal(f.element('#modal').open,true);
});

test('scoped export retains quarter/four-times clocks and valid failed-recovery read-only access',async()=>{
    for(const speed of [.25,4]){
        const f=await fixture(`state.speed=${speed};persistence.restorePhase='failed';persistence.recoveryValid=true`),before=f.snapshot();
        f.open();f.save(1,2);assert.equal(f.downloads.length,1);
        const expected=projectSubtitles(before.state,{format:'srt',bom:true,captionIndex:0,count:2});
        assert.deepEqual(new Uint8Array(await f.downloads[0].blob.arrayBuffer()),new TextEncoder().encode(expected));
        assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.writes,[]);assert.equal(f.evaluate('persistence.restorePhase'),'failed');
    }
    const f=await fixture("state.captions[0].text='bad\\0text'");f.open();f.save(1,1);assert.equal(f.downloads.length,0);assert.equal(f.element('#modal').open,true);
});
