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
        validateProject(state);composition.draw=()=>{};panel='settings';renderPanel();bind();`, f.context);
    const refs = vm.runInContext('[new WeakRef(state),new WeakRef(sources.videoFile),new WeakRef(sources.audioFile)]', f.context);
    // No retired callback is saved outside the app. Closed modal controls stay mounted.
    if (mode !== 'control') {
        f.element('#helpButton').onclick(); f.element('#findToolsButton').onclick();
        if (!f.element('#modal').open) throw new Error('Finder dialog must open');
        if (mode === 'cancel') { f.element('#cancelToolFinder').onclick(); f.element('#modal').onclose?.(); }
        // Route to settings, avoiding unrelated gallery snapshot ownership.
        else if (mode === 'route') f.element('#toolFinderResult5').onclick();
        // The fixture retains detached nodes: replacement is defensive coverage, not a native leak claim.
        else if (mode === 'replace') vm.runInContext("modalOpen('Replacement','')", f.context);
        else if (mode === 'native-close') {
            f.element('#modal').close(); f.element('#modal').onclose?.();
        }
    }
    if (mode !== 'active') {
        // Replacement modal must close before valid media replacement starts.
        if (mode === 'replace') f.element('#modal').close();
        vm.runInContext('sources.setVideoFile=async()=>{}', f.context);
        if (f.element('#modal').open) throw new Error('Media replacement requires a closed modal');
        await vm.runInContext("loadVideo(new File(['new'],'next.mp4',{type:'video/mp4'}))", f.context);
    }
    return {f, refs};
}
const h = await setup();
for (let i=0; i<10; i++) { await setImmediate(); global.gc(); }
console.log(JSON.stringify({retained:Array.from(h.refs, ref=>!!ref.deref()),
    history:h.f.evaluate('history.length'), future:h.f.evaluate('future.length'),
    fileName:h.f.evaluate('state.fileName'), speed:h.f.evaluate('state.speed')}));
