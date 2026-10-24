import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {setLocale,initLocale} from '../dist/i18n.mjs';
import {createTextFileWorkflow} from '../dist/text-file-workflow.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createDemoProject} from '../dist/core/project.mjs';

const text='1\n00:00:00,250 --> 00:00:01,500\nImported';
async function fixture(setup='') {
    const f=await createAppFixture();
    vm.runInContext(`state.captions=[{start:5,end:6,text:'Keep original',basis:'timeline',speaker:'1',keywords:'keep',timing:'estimated'}];state.clips=[{start:0,end:2}];${setup};history=[];future=[];current=.5;globalThis.appendSaves=0;scheduleSave=()=>appendSaves++;switchPanel('captions');renderInspector();`,f.context);
    f.open=()=>f.element('#importSrt').onclick({});
    f.file=(file=new Blob([text]))=>{f.element('#subtitleImportFile').files=[file];f.element('#subtitleImportFile').onchange();};
    f.choice=(id,value)=>{f.element('#'+id).value=value;f.element('#'+id).onchange();};
    f.mode=value=>f.choice('subtitleImportMode',value);
    f.clock=value=>f.choice('subtitleImportClock',value);
    f.confirm=event=>f.element('#confirmSubtitleImport').onclick(event||{});
    f.snapshot=()=>f.evaluate('({state,history,future,current,appendSaves})');
    return f;
}

test('reviewed append preserves out-of-output originals and metadata, adds once, focuses first new row, one undo',async()=>{
    const f=await fixture(),before=f.snapshot();f.element('#trimStart').value='.125';f.element('#trimEnd').value='1.75';
    f.open();assert.equal(f.element('#subtitleImportMode').value,'replace');f.mode('append');f.file();
    const prepared=await f.confirm();assert.equal(prepared.prepared,true);assert.deepEqual(f.snapshot(),before);
    assert.match(f.element('#subtitleImportReport').innerHTML,/10000/);assert.match(f.element('#subtitleImportReport').innerHTML,/<strong>2<\/strong>/);
    const confirm=f.element('#confirmSubtitleImport').onclick;await confirm({});await confirm({});
    assert.equal(f.evaluate('state.captions.length'),2);assert.deepEqual(f.evaluate('state.captions[0]'),before.state.captions[0]);
    assert.deepEqual(f.evaluate('state.captions[1]'),{start:.25,end:1.5,text:'Imported'});
    assert.equal(f.evaluate('history.length'),1);assert.equal(f.evaluate('current'),.5);
    assert.equal(f.element('#trimStart').value,'.125');assert.equal(f.element('#trimEnd').value,'1.75');
    assert.equal(f.doc.activeElement,f.element('[data-caption-text="1"]'));
    vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state'),before.state);
    vm.runInContext('undo(true)',f.context);assert.equal(f.evaluate('state.captions.length'),2);
});

test('output-clock append converts only new cues with speed; clipping counts retain parser behavior',async()=>{
    for(const speed of [.25,2,4]){
        const f=await fixture(`state.speed=${speed};state.clips=[{start:2,end:4},{start:2,end:4}]`),original=f.evaluate('state.captions');
        f.open();f.mode('append');f.clock('output');f.file(new Blob(['00:00:00,250 --> 00:00:30,000\nAdded']));
        const result=await f.confirm();assert.equal(result.report.clippedCaptions,1);await f.confirm();
        assert.deepEqual(f.evaluate('state.captions[0]'),original[0]);
        assert.deepEqual(f.evaluate('state.captions[1]'),{start:.25*speed,end:4,text:'Added',basis:'timeline'});
    }
});

test('existing replacement and legacy hidden import remain destructive defaults',async()=>{
    const f=await fixture();f.open();f.file();await f.confirm();await f.confirm();assert.deepEqual(f.evaluate('state.captions'),[{start:.25,end:1.5,text:'Imported'}]);
    vm.runInContext("state.captions.push({start:1,end:2,text:'old'})",f.context);
    f.context.legacyFile=new Blob([text]);await vm.runInContext('importSrt(legacyFile)',f.context);
    assert.equal(f.evaluate('state.captions.length'),1);
});

test('browser append keeps 2 MiB file path above API text limit, and combined cap rejects atomically',async()=>{
    const large=Array.from({length:60},()=>`00:00:00,000 --> 00:00:01,000\n${'x'.repeat(2000)}`).join('\n\n');assert.ok(large.length>100000);
    const f=await fixture();f.open();f.mode('append');f.file(new Blob([large]));await f.confirm();await f.confirm();assert.equal(f.evaluate('state.captions.length'),61);
    const full=await fixture("state.captions=Array.from({length:10000},()=>({start:0,end:1,text:'old'}))");full.open();full.mode('append');full.file();const before=full.snapshot();
    await full.confirm();assert.match(full.element('#subtitleImportReport').innerHTML,/<strong>10001<\/strong>/);await full.confirm();
    assert.deepEqual(full.snapshot(),before);assert.equal(full.element('#modal').open,true);
});

test('changing action invalidates prepared and pending reviews; cancel/stale/IME/busy cannot append',async()=>{
    const f=await fixture();f.open();f.mode('append');let reads=0;
    const bytes=new TextEncoder().encode(text).buffer;f.file({size:bytes.byteLength,arrayBuffer:async()=>{reads++;return bytes;}});
    await f.confirm();f.mode('replace');assert.equal(f.element('#subtitleImportReport').innerHTML,'');
    const reread=await f.confirm();assert.equal(reread.prepared,true);assert.equal(reads,2);assert.equal(f.evaluate('history.length'),0);
    f.mode('append');await f.confirm();f.element('#cancelSubtitleImport').onclick();assert.equal(f.evaluate('history.length'),0);
    let finish;f.open();f.mode('append');f.file({size:bytes.byteLength,arrayBuffer:()=>new Promise(resolve=>finish=()=>resolve(bytes))});const pending=f.confirm();f.mode('replace');finish();await pending;
    assert.equal(f.element('#subtitleImportReport').innerHTML,'');assert.equal(f.evaluate('history.length'),0);
    for(const change of ["state.captions[0].text='changed'",'sources.videoFile={}',"switchPanel('text')","modal.close()","modalOpen('Other','')",'loadingMedia=true','transcribing=true','exporting=true']){
        const f=await fixture();f.open();f.mode('append');f.file();await f.confirm();const action=f.element('#confirmSubtitleImport').onclick;vm.runInContext(change,f.context);const before=f.snapshot();await action({});assert.deepEqual(f.snapshot(),before);
    }
    const composing=await fixture();composing.open();composing.mode('append');composing.file();await composing.confirm();const before=composing.snapshot();
    await composing.confirm({isComposing:true});composing.element('#subtitleImportMode').oncompositionstart();await composing.confirm();assert.deepEqual(composing.snapshot(),before);composing.element('#subtitleImportMode').oncompositionend();await composing.confirm();assert.equal(composing.evaluate('history.length'),1);
});

test('append choice/warning/confirmation are localized and failed-valid recovery never saves',async()=>{
    try {
        for(const [locale,label,button] of [['ko','기존 자막 유지 후 추가','자막 추가'],['en','Keep existing and add','Add captions'],['zh-CN','保留现有字幕并添加','添加字幕']]){
            const f=await fixture();setLocale(locale,{persist:false});f.open();assert.ok(f.element('#modal').innerHTML.includes(label));f.mode('append');f.file();await f.confirm();assert.equal(f.element('#confirmSubtitleImport').textContent,button);
            setLocale(locale==='ko'?'en':'ko',{persist:false});assert.equal(f.element('#subtitleImportMode').value,'append');await f.confirm();assert.equal(f.evaluate('state.captions.length'),2);
        }
        const f=await fixture("persistence.restorePhase='failed';persistence.recoveryValid=true"),writes=[];
        f.context.localStorage.setItem=(...args)=>writes.push(args);vm.runInContext('scheduleSave=()=>persistence.scheduleSave()',f.context);
        f.open();f.mode('append');f.file();await f.confirm();await f.confirm();await vm.runInContext('saveProject(true)',f.context);
        assert.equal(f.evaluate('state.captions.length'),2);assert.deepEqual(writes,[]);assert.equal(f.evaluate('persistence.restorePhase'),'failed');
    }finally{initLocale();}
});

test('prepared append consumes its private parsed data once without re-reading and rejects invalid action',async()=>{
    let project=createDemoProject(),commits=0,reads=0;
    const service=createEditorService({getProject:()=>project,commitProject:next=>{project=next;commits++;}});
    const workflow=createTextFileWorkflow({getProject:()=>project,execute:(...args)=>service.execute(...args),query:()=>({value:''}),closeModal(){},focusImportedCaption(){},settingsUnavailable:()=>false,download(){},toast(){}});
    const bytes=new TextEncoder().encode(text).buffer,file={size:bytes.byteLength,arrayBuffer:async()=>{reads++;return bytes;}};
    const result=await workflow.importSrt(file,{mode:'append',owned:true,prepareOnly:true});assert.equal(commits,0);
    await result.commit();await result.commit();assert.equal(commits,1);assert.equal(reads,1);assert.equal(project.captions.length,4);
    const invalid=await workflow.importSrt(file,{mode:'invalid'});assert.equal(invalid.ok,false);assert.equal(commits,1);
});
