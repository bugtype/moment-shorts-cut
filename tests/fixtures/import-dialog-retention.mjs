import vm from 'node:vm';
import {File} from 'node:buffer';
import {setImmediate} from 'node:timers/promises';
import {createAppFixture} from './app.mjs';
const mode = process.argv[2];
async function setup() {
    const f = await createAppFixture(); f.context.File = File;
    vm.runInContext(`state=initial();state.kind='video';state.fileName='previous.mp4';state.audioName='previous.wav';
        sources.videoFile=new File(['video'],state.fileName,{type:'video/mp4'});
        sources.audioFile=new File(['audio'],state.audioName,{type:'audio/wav'});
        validateProject(state);composition.draw=()=>{};state.captions=[{start:0,end:0.1,text:'Caption'}];panel='captions';renderPanel();`, f.context);
    const refs = vm.runInContext('[new WeakRef(state),new WeakRef(sources.videoFile),new WeakRef(sources.audioFile)]', f.context);
    let stale;
    if (mode !== 'control') {
        f.element('#importSrt').onclick({});
        f.element('#subtitleImportFile').files = [new File(['1\n00:00:00,000 --> 00:00:00,100\nImported'], 'captions.srt')];
        f.element('#subtitleImportFile').onchange();
        if (mode === 'append-success') {
            f.element('#subtitleImportMode').value = 'append';
            f.element('#subtitleImportMode').onchange();
        }
        if (mode === 'pending-cancel') {
            const file = f.element('#subtitleImportFile').files[0];
            const bytes = await file.arrayBuffer();
            let finish;
            file.arrayBuffer = () => new Promise(resolve => finish = () => resolve(bytes));
            const pending = f.element('#confirmSubtitleImport').onclick({});
            f.element('#cancelSubtitleImport').onclick();
            finish();
            await pending;
        }
        if (mode === 'review-cancel' || mode === 'success' || mode === 'append-success') await f.element('#confirmSubtitleImport').onclick({});
        stale = f.element('#confirmSubtitleImport').onclick;
        if (mode === 'success' || mode === 'append-success') {
            await stale({});
            if (f.doc.activeElement !== f.element(`[data-caption-text="${mode === 'append-success' ? 1 : 0}"]`)) throw new Error('Successful import must focus its first imported caption');
        }
        else if (mode === 'cancel' || mode === 'review-cancel') f.element('#cancelSubtitleImport').onclick();
        else if (mode === 'replace') vm.runInContext("modalOpen('Replacement','')", f.context);
        else if (mode === 'native-close') {
            f.element('#modal').close(); f.element('#modal').onclose?.();
        }
    }
    if (mode !== 'active') {
        // Replacement modal must close before valid media replacement starts.
        if (mode === 'replace') f.element('#modal').close();
        vm.runInContext('sources.setVideoFile=async()=>{}', f.context);
        await vm.runInContext("loadVideo(new File(['new'],'next.mp4',{type:'video/mp4'}))", f.context);
        await stale?.({});
    }
    return {f, refs, stale};
}
const h = await setup();
for (let i=0; i<10; i++) { await setImmediate(); global.gc(); }
console.log(JSON.stringify({retained:Array.from(h.refs, ref=>!!ref.deref()),
    history:h.f.evaluate('history.length'), future:h.f.evaluate('future.length'),
    fileName:h.f.evaluate('state.fileName'), speed:h.f.evaluate('state.speed')}));
