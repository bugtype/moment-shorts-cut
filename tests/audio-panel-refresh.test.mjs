import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';

// Actual app/renderer entry points with mocked metadata and numeric DOM replacement.
// This does not exercise native decoding, IME completion, focus or browser layout.
async function fixture() {
    const f=await createAppFixture(),root=f.element('#panelContent');
    const queryAll=root.querySelectorAll.bind(root),queryDocument=f.doc.querySelector.bind(f.doc);
    let html=root.innerHTML,inputs=[],assignments=0;
    Object.defineProperty(root,'innerHTML',{
        get:()=>html,
        set:value=>{
            html=value;assignments++;
            for(const input of inputs)input.isConnected=false;
            inputs=[...value.matchAll(/<input\b[^>]*>/g)].flatMap(([tag])=>{
                const design=/\bdata-design="(design\.(?:title|credit)\.(?:start|end))"/.exec(tag)?.[1];
                const id=/\bid="(panelTrimStart|panelTrimEnd)"/.exec(tag)?.[1];
                if(!design&&!id)return [];
                return [{id,type:'number',dataset:design?{design}:{},value:/\bvalue="([^"]*)"/.exec(tag)?.[1]||'',isConnected:true,
                    get valueAsNumber(){return this.value.trim()===''?NaN:Number(this.value);},
                    focus(){f.doc.activeElement=this;},setCustomValidity(){},reportValidity(){},setAttribute(){},removeAttribute(){}}];
            });
        },
    });
    root.querySelectorAll=selector=>selector==='[data-design]'?inputs.filter(input=>input.dataset.design):queryAll(selector);
    f.doc.querySelector=selector=>inputs.find(input=>input.id&&selector==='#'+input.id)||queryDocument(selector);
    const probes=[],revoked=[],storageWrites=[];
    f.context.localStorage.setItem=(...args)=>storageWrites.push(args);
    f.context.URL={createObjectURL:()=> 'blob:pending-panel-audio',revokeObjectURL:url=>revoked.push(url)};
    f.context.Audio=class {
        duration=8;listeners=new Map();removed=0;loads=0;
        constructor(){probes.push(this);}
        addEventListener(name,callback){this.listeners.set(name,callback);}
        removeEventListener(name){this.listeners.delete(name);}
        set src(value){this.source=value;}
        removeAttribute(){this.removed++;}load(){this.loads++;}
    };
    vm.runInContext('state.overlays=[];history=[];future=[];current=2;globalThis.audioPersists=0;globalThis.audioSaves=0;persistMedia=()=>audioPersists++;scheduleSave=()=>audioSaves++;renderInspector()',f.context);
    f.root=root;f.probes=probes;f.revoked=revoked;f.storageWrites=storageWrites;
    f.revision=()=>f.evaluate('app.panelRevision');
    f.snapshot=()=>f.evaluate('({state,history,future,current,selected,panel})');
    f.switch=panel=>vm.runInContext(`textLayer='title';effectTab='cards';switchPanel(${JSON.stringify(panel)})`,f.context);
    f.control=key=>inputs.find(input=>input.dataset.design===key||input.id===key);
    f.assignments=()=>assignments;
    f.choose=(file={name:'voice.wav',size:1})=>{
        const input=f.element('#audioInput');input.files=[file];input.value='selected';
        const pending=input.onchange({target:input});assert.equal(input.value,'');return pending;
    };
    f.finish=(event='loadedmetadata')=>{const probe=probes.at(-1);assert.ok(probe);probe.listeners.get(event)?.();};
    return f;
}

for(const panel of ['text','effects','templates','settings']) {
    test(`audio completion retains the current independent ${panel} panel and applied editing state`,async()=>{
        const f=await fixture();f.switch('audio');const pending=f.choose();
        assert.equal(f.evaluate('loadingMedia'),true);f.switch(panel);
        vm.runInContext("edit(()=>state.design.title.lines[0]='Applied while audio waits')",f.context);
        const before=f.snapshot(),revision=f.revision(),html=f.root.innerHTML,assignments=f.assignments();
        f.finish();await pending;
        const expected=structuredClone(before);expected.state.audioName='voice.wav';expected.state.audioOffset=0;
        assert.deepEqual(f.snapshot(),expected);assert.equal(f.revision(),revision);
        assert.equal(f.root.innerHTML,html);assert.equal(f.assignments(),assignments);
        assert.equal(f.evaluate('loadingMedia'),false);assert.equal(f.element('#audioInput').value,'');
        assert.equal(f.evaluate('audioPersists'),1);assert.equal(f.probes[0].removed,1);assert.equal(f.probes[0].loads,1);
    });
}

test('deferred audio metadata keeps the actual Title timing control and its uncommitted numeric draft',async()=>{
    const f=await fixture();f.switch('audio');const pending=f.choose();f.switch('text');
    const input=f.control('design.title.start');assert.ok(input);input.value='2.75';input.focus();
    const before=f.snapshot();f.finish();await pending;
    assert.equal(f.control('design.title.start'),input);assert.equal(input.isConnected,true);assert.equal(input.value,'2.75');
    assert.equal(f.doc.activeElement,input);assert.equal(f.evaluate('state.design.title.start'),before.state.design.title.start);
    assert.deepEqual(f.evaluate('history'),before.history);
    const imported=f.evaluate('state');input.onchange();
    assert.equal(f.evaluate('state.design.title.start'),2.75);assert.equal(f.evaluate('history.length'),1);
    assert.equal(f.evaluate('JSON.parse(history[0]).audioName'),'voice.wav');
    vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state'),imported);
});

test('deferred audio metadata keeps the Settings trim controls and unapplied range draft',async()=>{
    const f=await fixture();f.switch('audio');const pending=f.choose();f.switch('settings');
    const start=f.control('panelTrimStart'),end=f.control('panelTrimEnd');assert.ok(start&&end);
    start.value='1.2345';end.value='9.8765';start.focus();const before=f.snapshot();
    f.finish();await pending;
    assert.equal(f.control('panelTrimStart'),start);assert.equal(f.control('panelTrimEnd'),end);
    assert.equal(start.isConnected,true);assert.equal(start.value,'1.2345');assert.equal(end.value,'9.8765');
    assert.equal(f.doc.activeElement,start);assert.deepEqual(f.evaluate('state.clips'),before.state.clips);
    const imported=f.evaluate('state');f.element('#panelTrimApply').onclick();
    assert.deepEqual(f.evaluate('state.clips'),[{start:1.2345,end:9.8765}]);assert.equal(f.evaluate('history.length'),1);
    assert.equal(f.evaluate('JSON.parse(history[0]).audioName'),'voice.wav');
    vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state'),imported);
});

for(const panel of ['audio','captions','media','unknown-panel']) {
    test(`audio completion still refreshes the dependent or conservative ${panel} panel`,async()=>{
        const f=await fixture();f.switch(panel);
        const html=f.root.innerHTML,revision=f.revision(),assignments=f.assignments(),pending=f.choose();
        if(panel==='captions')assert.match(html,/<option value="audio"[^>]*disabled/);
        f.finish();await pending;
        assert.equal(f.revision(),revision+1);assert.equal(f.assignments(),assignments+1);
        assert.equal(f.evaluate('state.audioName'),'voice.wav');assert.equal(f.evaluate('state.audioOffset'),0);
        assert.equal(f.evaluate('audioPersists'),1);assert.equal(f.evaluate('audioSaves'),1);
        if(panel==='audio'){
            assert.match(f.root.innerHTML,/voice\.wav/);assert.match(f.root.innerHTML,/id="downloadOriginalAudio"/);
            assert.match(f.root.innerHTML,/id="audioOffset"/);
        }
        if(panel==='captions'){
            const option=/<option value="audio"([^>]*)>/.exec(f.root.innerHTML);assert.ok(option);assert.doesNotMatch(option[1],/disabled/);
        }
        assert.equal(f.evaluate('loadingMedia'),false);assert.equal(f.element('#audioInput').value,'');
        assert.equal(f.probes[0].listeners.size,0);
    });
}

test('the completion-time panel owns the refresh decision in both navigation directions',async()=>{
    for(const [initial,current,refresh] of [['audio','text',false],['text','audio',true],['captions','settings',false],['settings','captions',true]]){
        const f=await fixture();f.switch(initial);const pending=f.choose();f.switch(current);
        const revision=f.revision();f.finish();await pending;
        assert.equal(f.evaluate('panel'),current);assert.equal(f.revision(),revision+(refresh?1:0),initial+' → '+current);
    }
});

for(const failure of ['metadata error','invalid duration','recovery refusal']) {
    test(`${failure} does not remount or persist over the existing media`,async()=>{
        const f=await fixture();f.switch('text');
        vm.runInContext("sources.audioFile={name:'existing.wav'};sources.audioURL='blob:existing-audio';audio.src=sources.audioURL;state.audioName='existing.wav';state.audioOffset=3",f.context);
        const previous=vm.runInContext('sources.audioFile',f.context),before=f.snapshot(),revision=f.revision(),pending=f.choose();
        if(failure==='invalid duration')f.probes[0].duration=0;
        if(failure==='recovery refusal')vm.runInContext("persistence.restorePhase='failed';persistence.recoveryValid=false",f.context);
        f.finish(failure==='metadata error'?'error':'loadedmetadata');await pending;
        assert.deepEqual(f.snapshot(),before);assert.equal(f.revision(),revision);
        assert.equal(vm.runInContext('sources.audioFile',f.context),previous);
        assert.equal(f.evaluate('sources.audioURL'),'blob:existing-audio');assert.equal(f.evaluate('audio.src'),'blob:existing-audio');
        assert.equal(f.evaluate('audioPersists'),0);assert.equal(f.evaluate('audioSaves'),0);
        assert.deepEqual(f.storageWrites,[]);
        assert.equal(f.evaluate('loadingMedia'),false);assert.equal(f.element('#audioInput').value,'');
        assert.deepEqual(f.revoked,['blob:pending-panel-audio']);
        assert.equal(f.probes[0].removed,1);assert.equal(f.probes[0].loads,1);assert.equal(f.probes[0].listeners.size,0);
    });
}

test('busy, size and recovery rejections remain side-effect free before reading media',async()=>{
    for(const condition of ['loadingMedia=true','exporting=true','transcribing=true',"persistence.restorePhase='restoring'","persistence.restorePhase='failed';persistence.recoveryValid=false",
        "Object.defineProperty(audioRecording,'requesting',{get:()=>true})","Object.defineProperty(audioRecording,'current',{get:()=>({state:'recording'})})",'oversized']){
        const f=await fixture();f.switch('settings');
        if(condition!=='oversized')vm.runInContext(condition,f.context);
        const before=f.snapshot(),revision=f.revision();await f.choose({name:'rejected.wav',size:condition==='oversized'?101*1024*1024:1});
        assert.deepEqual(f.snapshot(),before);assert.equal(f.revision(),revision);assert.equal(f.probes.length,0);
        assert.equal(f.evaluate('audioPersists'),0);assert.equal(f.evaluate('audioSaves'),0);assert.equal(f.element('#audioInput').value,'');
        assert.deepEqual(f.storageWrites,[]);
    }
});

test('recording handoff still requires its current owner and refreshes Audio only after acceptance',async()=>{
    for(const accepted of [true,false]){
        const f=await fixture();f.switch('audio');
        const owner={state:'inactive'};let current=owner;
        const recording=vm.runInContext('audioRecording',f.context);
        Object.defineProperty(recording,'current',{get:()=>current});
        f.context.recordingOwner=owner;f.context.recordedFile={name:'recorded.webm',size:1};
        const before=f.snapshot(),revision=f.revision();
        const pending=vm.runInContext('loadAudio(recordedFile,recordingOwner)',f.context);
        assert.equal(f.probes.length,1);if(!accepted)current={state:'inactive'};
        f.finish();await pending;
        assert.equal(f.revision(),revision+(accepted?1:0));assert.equal(f.evaluate('audioPersists'),accepted?1:0);
        assert.equal(f.evaluate('audioSaves'),accepted?1:0);assert.equal(f.evaluate('loadingMedia'),false);
        assert.deepEqual(f.revoked,accepted?[]:['blob:pending-panel-audio']);
        if(accepted)assert.equal(f.evaluate('state.audioName'),'recorded.webm');else {
            assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.storageWrites,[]);
        }
    }
});
