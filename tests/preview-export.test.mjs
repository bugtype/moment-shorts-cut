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
                toBlob(callback,type){
                    canvas.callback=callback;canvas.type=type;
                    // Native toBlob snapshots the bitmap before its asynchronous work.
                    canvas.encoded={width:canvas.width,height:canvas.height,pixels:canvas.pixels};
                }};
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
        assert.deepEqual(copy.encoded,{width,height,pixels:'first'});
        assert.deepEqual([copy.width,copy.height],[0,0]);
        assert.deepEqual([f.source.width,f.source.height],[width,height]);
        assert.equal(copy.type,'image/png');copy.callback(png());
        assert.equal(f.downloads[0][1],`Test.preview-${width}x${height}.png`);
        assert.deepEqual(f.project(),{name:'Test',speed:1});
    }
});
test('newer snapshots, project replacement/content changes, media replacement and busy state suppress obsolete downloads',()=>{
    for(const invalidate of [f=>f.replace(),f=>{f.project().name='Changed';},f=>f.relink(),f=>f.block(true)]){
        const f=fixture();f.save();invalidate(f);f.canvases[0].callback(png());
        assert.equal(f.downloads.length,0);assert.equal(f.errors.length,0);
        assert.deepEqual([f.canvases[0].width,f.canvases[0].height],[0,0]);
    }
    const f=fixture();f.save();f.save();
    assert.ok(f.canvases.every(canvas=>canvas.width===0&&canvas.height===0));
    f.canvases[1].callback(png());f.canvases[0].callback(null);
    assert.equal(f.downloads.length,1);assert.equal(f.errors.length,0);
    const blocked=fixture();blocked.save();blocked.block(true);blocked.save();blocked.block(false);
    blocked.canvases[0].callback(png());assert.equal(blocked.downloads.length,0);
    assert.equal(blocked.canvases.length,1,'blocked successor allocates nothing but still invalidates');
});
test('null, empty, wrong MIME and synchronous canvas/encoder failures never download; retry works',()=>{
    for(const blob of [null,new Blob([],{type:'image/png'}),new Blob(['x'],{type:'image/jpeg'})]){
        const f=fixture();f.save();f.canvases[0].callback(blob);assert.equal(f.downloads.length,0);assert.equal(f.errors.length,1);
        f.save();f.canvases[1].callback(png());assert.equal(f.downloads.length,1);
    }
    for(const fault of ['create','context','draw','encode','missing']){
        const errors=[],downloads=[],canvases=[];
        const save=createPreviewExport({getProject:()=>({name:'x'}),getMedia:()=>[],getCanvas:()=>({width:1,height:1}),blocked:()=>false,
            download:x=>downloads.push(x),toast:x=>errors.push(x),createCanvas:()=>{
                if(fault==='create')throw new Error('allocation');
                const canvas={getContext:()=>fault==='context'?null:{drawImage(){if(fault==='draw')throw new DOMException('tainted','SecurityError');}},
                    toBlob:fault==='missing'?undefined:()=>{throw new DOMException('tainted','SecurityError');}};
                canvases.push(canvas);return canvas;
            }});
        save();assert.equal(errors.length,1,fault);assert.equal(downloads.length,0);
        assert.ok(canvases.every(canvas=>canvas.width===0&&canvas.height===0),fault);
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
        assert.equal(tag,'canvas');const canvas={getContext:()=>({drawImage:source=>{canvas.source=source;}}),toBlob(callback){
            canvas.callback=callback;canvas.encoded=[canvas.width,canvas.height];
        }};
        copies.push(canvas);return canvas;
    };
    const before=f.evaluate('({state, current, playing, history:history.length})');
    vm.runInContext('pause=()=>{throw Error("pause")};seekTo=()=>{throw Error("seek")};draw=()=>{throw Error("draw")};',f.context);
    const source=f.element('#preview'),dimensions=[source.width,source.height];
    for(let index=0;index<3;index++){
        f.element('#savePreviewPng').onclick();assert.equal(copies.length,index+1);assert.equal(copies[index].source,source);
        assert.deepEqual(copies[index].encoded,dimensions);
        assert.ok(copies.every(canvas=>canvas.width===0&&canvas.height===0));
        assert.deepEqual([source.width,source.height],dimensions);
    }
    copies[1].callback(null);copies[2].callback(png());copies[0].callback(png());assert.equal(downloads.length,1);
    assert.deepEqual(f.evaluate('({state, current, playing, history:history.length})'),before);
    for(const condition of ['exporting=true','loadingMedia=true','transcribing=true','editorReady=false']){
        vm.runInContext(condition,f.context);f.element('#savePreviewPng').onclick();assert.equal(copies.length,3);
        vm.runInContext('exporting=false;loadingMedia=false;transcribing=false;editorReady=true',f.context);
    }
    f.doc.createElement=original;
});

test('private scratch release tolerates synchronous callbacks and throwing cleanup without masking errors',()=>{
    for(const mode of ['success','null','encode','draw','download','toast']){
        const project={name:'sync'},source={width:2,height:3},cleanups=[],downloads=[],errors=[];
        const primary=new Error('primary toast failure');let captured;
        const save=createPreviewExport({getProject:()=>project,getMedia:()=>[],getCanvas:()=>source,blocked:()=>false,
            download:blob=>{if(mode==='download')throw Error('download');downloads.push(blob);},
            toast:value=>{errors.push(value);if(mode==='toast')throw primary;},
            createCanvas:()=>{
                const values={};
                const canvas={getContext:()=>({drawImage(){if(mode==='draw')throw Error('draw');}}),toBlob(callback){
                    captured=[canvas.width,canvas.height];
                    if(mode==='encode')throw Error('encode');
                    callback(mode==='null'||mode==='toast'?null:png());
                }};
                for(const axis of ['width','height'])Object.defineProperty(canvas,axis,{
                    get:()=>values[axis],set:value=>{
                        if(value===0){cleanups.push(axis);throw Error('cleanup '+axis);}
                        values[axis]=value;
                    },
                });
                return canvas;
            },
        });
        if(mode==='toast')assert.throws(save,error=>error===primary);else save();
        assert.deepEqual(cleanups,['width','height'],mode+' attempts both releases');
        assert.deepEqual([source.width,source.height],[2,3]);
        if(mode!=='draw')assert.deepEqual(captured,[2,3]);
        assert.equal(downloads.length,mode==='success'?1:0);
        assert.equal(errors.length,mode==='success'?0:mode==='toast'?2:1);
    }
    for(const failedAxis of ['width','height']){
        const attempts=[],errors=[];
        const canvas={};
        for(const axis of ['width','height'])Object.defineProperty(canvas,axis,{set:value=>{
            attempts.push([axis,value]);if(axis===failedAxis&&value!==0)throw Error('dimension');
        }});
        createPreviewExport({getProject:()=>({name:'size'}),getMedia:()=>[],getCanvas:()=>({width:2,height:3}),
            createCanvas:()=>canvas,blocked:()=>false,download(){assert.fail('must not download');},toast:value=>errors.push(value)})();
        assert.equal(errors.length,1);
        assert.deepEqual(attempts.slice(-2),[['width',0],['height',0]],failedAxis);
    }
    const project={name:'reentrant'},canvases=[],downloads=[];let save;
    save=createPreviewExport({getProject:()=>project,getMedia:()=>[],getCanvas:()=>({width:2,height:3}),blocked:()=>false,
        download:blob=>downloads.push(blob),toast(){assert.fail('unexpected toast');},createCanvas:()=>{
            const index=canvases.length,canvas={getContext:()=>({drawImage(){}}),toBlob(callback){
                canvas.callback=callback;
                if(index===0){save();callback(png());}
            }};
            canvases.push(canvas);return canvas;
        },
    });
    save();assert.equal(canvases.length,2);assert.ok(canvases.every(canvas=>canvas.width===0&&canvas.height===0));
    const latest=png();canvases[1].callback(latest);
    assert.deepEqual(downloads,[latest],'old cleanup and callback cannot own the reentrant result');
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

test('known source or scratch context loss refuses PNG encoding, releases scratch pixels and permits retry', () => {
    for (const failure of ['source-before', 'scratch-before', 'source-during', 'scratch-during']) {
        let sourceLost = failure === 'source-before', scratchLost = failure === 'scratch-before';
        let during = failure, draws = 0, encodes = 0;
        const project = { name: 'context loss' }, canvases = [], downloads = [], errors = [];
        const sourceContext = { isContextLost: () => sourceLost };
        const source = { width: 2, height: 3, getContext: () => sourceContext };
        const save = createPreviewExport({
            getProject: () => project, getMedia: () => [], getCanvas: () => source, blocked: () => false,
            download: (...args) => downloads.push(args), toast: error => errors.push(error),
            createCanvas: () => {
                const context = {
                    isContextLost: () => scratchLost,
                    drawImage() {
                        draws++;
                        if (during === 'source-during') sourceLost = true;
                        if (during === 'scratch-during') scratchLost = true;
                    },
                };
                const canvas = { getContext: () => context, toBlob(callback) { encodes++; this.callback = callback; } };
                canvases.push(canvas);
                return canvas;
            },
        });
        save();
        assert.equal(errors.length, 1, failure);
        assert.equal(errors[0].messageKey, 'shell.previewPngError');
        assert.equal(downloads.length, 0);
        assert.equal(encodes, 0, 'known lost pixels must not reach the encoder');
        assert.equal(draws, failure.endsWith('during') ? 1 : 0);
        assert.equal(canvases.length, failure === 'source-before' ? 0 : 1);
        assert.ok(canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
        assert.deepEqual([source.width, source.height], [2, 3]);

        sourceLost = scratchLost = false;
        during = null;
        save();
        assert.equal(encodes, 1);
        canvases.at(-1).callback(png());
        assert.equal(downloads.length, 1, 'a healthy retry is not latched out');
        assert.equal(errors.length, 1);
        assert.ok(canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
        assert.deepEqual([source.width, source.height], [2, 3]);
    }
});

test('Frame action refuses a lost preview but retains a healthy snapshot through later loss', async () => {
    const f = await createAppFixture(), copies = [], downloads = [];
    f.context.capturedPngs = downloads;
    vm.runInContext('download=(blob,name)=>capturedPngs.push({blob,name});panel="settings";renderPanel()', f.context);
    let lost = true;
    const source = f.element('#preview');
    source.getContext = () => ({ isContextLost: () => lost });
    f.doc.createElement = tag => {
        assert.equal(tag, 'canvas');
        const copy = {
            getContext: () => ({ drawImage() {} }),
            toBlob(callback) { this.callback = callback; },
        };
        copies.push(copy);
        return copy;
    };
    const dimensions = [source.width, source.height];
    const before = f.evaluate('({state,history,future,current,playing})');
    f.element('#savePreviewPng').onclick();
    assert.equal(copies.length, 0);
    assert.equal(downloads.length, 0);
    assert.match(f.element('#toast').textContent, /PNG/);
    assert.equal(f.element('#toast').getAttribute('data-i18n'), 'shell.previewPngError');
    assert.deepEqual(f.evaluate('({state,history,future,current,playing})'), before);

    lost = false;
    f.element('#savePreviewPng').onclick();
    assert.equal(copies.length, 1);
    assert.deepEqual([copies[0].width,copies[0].height], [0,0]);
    lost = true;
    const captured = png();
    copies[0].callback(captured);
    assert.equal(downloads.length, 1, 'loss after toBlob does not invalidate the owned bitmap');
    assert.equal(downloads[0].blob, captured);
    assert.deepEqual([source.width,source.height], dimensions);
    assert.deepEqual(f.evaluate('({state,history,future,current,playing})'), before);
});
