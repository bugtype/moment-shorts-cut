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
        validateProject(state);composition.draw=()=>{};panel='captions';renderPanel();bind();`, f.context);
    vm.runInContext('globalThis.downloadCount=0;download=()=>downloadCount++', f.context);
    const refs = vm.runInContext('[new WeakRef(state),new WeakRef(sources.videoFile),new WeakRef(sources.audioFile)]', f.context);
    let stale;
    if (mode !== 'control') {
        f.element('#captionExportScope').value='range'; f.element('#captionExportScope').onchange();
        f.element('#downloadCaptions').onclick();
        if (!f.element('#modal').open) throw new Error('Caption Export dialog must open');
        stale = f.element('#confirmCaptionExport').onclick;
        if (mode === 'cancel') f.element('#cancelCaptionExport').onclick();
        else if (mode === 'save') { stale(); } else if (mode === 'replace') vm.runInContext("modalOpen('Replacement','')", f.context);
        else if (mode === 'native-close') {
            f.element('#modal').close(); f.element('#modal').onclose?.();
        }
    }
    if (mode !== 'active') {
        // Replacement modal must close before valid media replacement starts.
        if (mode === 'replace') f.element('#modal').close();
        vm.runInContext('sources.setVideoFile=async()=>{}', f.context);
        await vm.runInContext("loadVideo(new File(['new'],'next.mp4',{type:'video/mp4'}))", f.context);
        stale?.();
    }
    return {f, refs, stale};
}
const h = await setup();
for (let i=0; i<10; i++) { await setImmediate(); global.gc(); }
console.log(JSON.stringify({retained:Array.from(h.refs, ref=>!!ref.deref()),
    downloads:h.f.evaluate('downloadCount'), history:h.f.evaluate('history.length'), future:h.f.evaluate('future.length'),
    fileName:h.f.evaluate('state.fileName'), speed:h.f.evaluate('state.speed')}));
