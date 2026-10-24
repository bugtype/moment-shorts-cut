import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createPreviewExport } from '../dist/preview-export.mjs';
import { createAppFixture } from './fixtures/app.mjs';
import { setLocale, initLocale } from '../dist/i18n.mjs';

function fixture() {
    let project = {name:'Test',speed:1}, media = [{}], busy = false;
    const source = {width:540,height:960,pixels:'first'}, canvases=[], downloads=[], errors=[];
    const save = createPreviewExport({getProject:()=>project,getMedia:()=>media,getCanvas:()=>source,
        blocked:()=>busy, download:(...args)=>downloads.push(args),toast:value=>errors.push(value),
        createCanvas:()=>{
            const canvas={getContext:()=>({drawImage:input=>{canvas.pixels=input.pixels;}}),
                toBlob(callback,type){canvas.callback=callback;canvas.type=type;}};
            canvases.push(canvas);return canvas;
        }});
    return {save,source,canvases,downloads,errors,project:()=>project,
        replace:()=>{project={...project};},relink:()=>{media=[{}];},block:value=>{busy=value;}};
}
const png=()=>new Blob(['pixels'],{type:'image/png'});

test('copies displayed pixels synchronously and keeps exact preview dimensions, name and PNG MIME',()=>{
    for(const [width,height] of [[540,960],[540,675],[960,960],[960,540]]){
        const f=fixture();Object.assign(f.source,{width,height});f.save();
        const copy=f.canvases[0];f.source.pixels='later playback';
        assert.equal(copy.pixels,'first');assert.equal(copy.width,width);assert.equal(copy.height,height);
        assert.equal(copy.type,'image/png');copy.callback(png());
        assert.equal(f.downloads[0][1],`Test.preview-${width}x${height}.png`);
        assert.deepEqual(f.project(),{name:'Test',speed:1});
    }
});
test('newer snapshots, project replacement/content changes, media replacement and busy state suppress obsolete downloads',()=>{
    for(const invalidate of [f=>f.replace(),f=>{f.project().name='Changed';},f=>f.relink(),f=>f.block(true)]){
        const f=fixture();f.save();invalidate(f);f.canvases[0].callback(png());
        assert.equal(f.downloads.length,0);assert.equal(f.errors.length,0);
    }
    const f=fixture();f.save();f.save();f.canvases[1].callback(png());f.canvases[0].callback(null);
    assert.equal(f.downloads.length,1);assert.equal(f.errors.length,0);
});
test('null, empty, wrong MIME and synchronous canvas/encoder failures never download; retry works',()=>{
    for(const blob of [null,new Blob([],{type:'image/png'}),new Blob(['x'],{type:'image/jpeg'})]){
        const f=fixture();f.save();f.canvases[0].callback(blob);assert.equal(f.downloads.length,0);assert.equal(f.errors.length,1);
        f.save();f.canvases[1].callback(png());assert.equal(f.downloads.length,1);
    }
    for(const fault of ['create','context','draw','encode','missing']){
        const errors=[],downloads=[];
        const save=createPreviewExport({getProject:()=>({name:'x'}),getMedia:()=>[],getCanvas:()=>({width:1,height:1}),blocked:()=>false,
            download:x=>downloads.push(x),toast:x=>errors.push(x),createCanvas:()=>{
                if(fault==='create')throw new Error('allocation');
                return {getContext:()=>fault==='context'?null:{drawImage(){if(fault==='draw')throw new DOMException('tainted','SecurityError');}},
                    toBlob:fault==='missing'?undefined:()=>{throw new DOMException('tainted','SecurityError');}};
            }});
        save();assert.equal(errors.length,1,fault);assert.equal(downloads.length,0);
    }
});
test('blocked requests allocate nothing and invalid dimensions refuse capture',()=>{
    const f=fixture();f.block(true);f.save();assert.equal(f.canvases.length,0);
    f.block(false);f.source.width=0;f.save();assert.equal(f.canvases.length,0);assert.equal(f.errors.length,1);
});
test('actual Frame action uses snapshot owner without renderer, playback, history, audio or recorder side effects',async()=>{
    const f=await createAppFixture(), downloads=[], copies=[];
    f.context.downloads=downloads;
    vm.runInContext('download=(blob,name)=>downloads.push({blob,name}); panel="settings"; renderPanel();',f.context);
    const original=f.doc.createElement;
    f.doc.createElement=tag=>{
        assert.equal(tag,'canvas');const canvas={getContext:()=>({drawImage:source=>{canvas.source=source;}}),toBlob(callback){canvas.callback=callback;}};
        copies.push(canvas);return canvas;
    };
    const before=f.evaluate('({state, current, playing, history:history.length})');
    vm.runInContext('pause=()=>{throw Error("pause")};seekTo=()=>{throw Error("seek")};draw=()=>{throw Error("draw")};',f.context);
    f.element('#savePreviewPng').onclick();assert.equal(copies.length,1);assert.equal(copies[0].source,f.element('#preview'));
    copies[0].callback(png());assert.equal(downloads.length,1);
    assert.deepEqual(f.evaluate('({state, current, playing, history:history.length})'),before);
    for(const condition of ['exporting=true','loadingMedia=true','transcribing=true','editorReady=false']){
        vm.runInContext(condition,f.context);f.element('#savePreviewPng').onclick();assert.equal(copies.length,1);
        vm.runInContext('exporting=false;loadingMedia=false;transcribing=false;editorReady=true',f.context);
    }
    f.doc.createElement=original;
});
test('Frame action labels translate in place and include actual bitmap dimensions',async()=>{
    const f=await createAppFixture();vm.runInContext('panel="settings";renderPanel()',f.context);
    for(const locale of ['ko','en','zh-CN']){
        setLocale(locale,{persist:false});
        // Explicitly refresh marked controls in this synthetic document.
        f.context.localize(f.doc);
        assert.match(f.element('#savePreviewPng').getAttribute('aria-label'),/540.*960/);
    }
    initLocale();
});

test('actual ratio changes refresh PNG dimensions after bitmap resize; stale panel and recovery actions do nothing',async()=>{
    const f=await createAppFixture();vm.runInContext('panel="settings";renderPanel()',f.context);
    const old=f.element('#savePreviewPng').onclick;
    for(const [ratio,width,height] of [['1:1',960,960],['16:9',960,540],['9:16',540,960]]){
        vm.runInContext(`runEditorCommand('project.update',{patch:{ratio:${JSON.stringify(ratio)}}})`,f.context);
        assert.match(f.element('#savePreviewPng').getAttribute('aria-label'),new RegExp(`${width}.*${height}`));
    }
    let allocations=0;f.doc.createElement=()=>{allocations++;throw Error('must not allocate');};
    old();assert.equal(allocations,0,'replaced project makes old action inert');
    vm.runInContext("persistence.restorePhase='failed';persistence.recoveryValid=true",f.context);
    f.element('#savePreviewPng').onclick();assert.equal(allocations,0);
    vm.runInContext("persistence.restorePhase='ready';panel='media'",f.context);
    f.element('#savePreviewPng').onclick();assert.equal(allocations,0);
});
