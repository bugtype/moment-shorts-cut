import vm from 'node:vm';
import {File} from 'node:buffer';
import {setImmediate} from 'node:timers/promises';
import {createAppFixture} from './app.mjs';
const mode = process.argv[2], kind = process.argv[3];
const ids = {
 position: ['panelContent #openPosition','applyPosition','cancelPosition'],
 card: ['panelContent #effectControls #openCardPosition','applyPosition','cancelPosition'],
 framing: ['openFraming','applyFraming','cancelFraming'],
 timing: ['panelContent #effectControls #moveSceneTime','confirmCardMove','cancelCardMove'],
}[kind];
async function setup() {
    const f = await createAppFixture(); f.context.File = File;
    vm.runInContext(`state=initial();state.kind='video';state.fileName='previous.mp4';state.audioName='previous.wav';
        sources.videoFile=new File(['video'],state.fileName,{type:'video/mp4'});
        sources.audioFile=new File(['audio'],state.audioName,{type:'audio/wav'});
        state.clips=[{start:1,end:3},{start:5,end:8}];selected=0;validateProject(state);composition.draw=()=>{};state.overlays=[{...newCard(5),id:'card',start:0,end:2}];selectedCard='card';textLayer='title';effectTab='cards';switchPanel('${kind==='card'||kind==='timing'?'effects':kind==='position'?'text':'media'}');`, f.context);
    const refs = vm.runInContext('[new WeakRef(state),new WeakRef(sources.videoFile),new WeakRef(sources.audioFile)]', f.context);
    let stale;
    if (mode !== 'control') {
        f.element('#'+ids[0]).id=ids[0];f.element('#'+ids[0]).onclick({});
        if (!f.element('#modal').open) throw new Error('Geometry dialog must open');
        stale = f.element('#'+ids[1]).onclick;
        if (mode === 'cancel') f.element('#'+ids[2]).onclick();
        else if (mode === 'apply') {
            if(kind==='timing') f.element('#cardMoveStart').value='1';
            else if(kind==='framing') f.element('#framing-panX').value='10';
            else f.element('#position-x').value='40';
            stale();
        } else if (mode === 'replace') vm.runInContext("modalOpen('Replacement','')", f.context);
        else if (mode === 'native-close') {
            f.element('#modal').close(); f.element('#modal').onclose?.();
        }
    }
    if (mode !== 'active') {
        // Replacement modal must close before valid media replacement starts.
        if (mode === 'replace') f.element('#modal').close();
        vm.runInContext('sources.setVideoFile=async()=>{}', f.context);
        await vm.runInContext("loadVideo(new File(['new'],'next.mp4',{type:'video/mp4'}))", f.context);
        // The base fixture retains selector nodes across innerHTML replacement. Rebind
        // the same panel to the new project to remove that unrelated fixture root.
        vm.runInContext("state.overlays=[{...newCard(5),id:'card',start:0,end:2}];selectedCard='card';renderPanel();", f.context);
        stale?.();
    }
    return {f, refs, stale};
}
const h = await setup();
for (let i=0; i<10; i++) { await setImmediate(); global.gc(); }
console.log(JSON.stringify({retained:Array.from(h.refs, ref=>!!ref.deref()),
    history:h.f.evaluate('history.length'), future:h.f.evaluate('future.length'),
    fileName:h.f.evaluate('state.fileName'), speed:h.f.evaluate('state.speed')}));
