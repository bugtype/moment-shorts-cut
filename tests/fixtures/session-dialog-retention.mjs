import vm from 'node:vm';
import {File} from 'node:buffer';
import {setImmediate} from 'node:timers/promises';
import {createAppFixture} from './app.mjs';
const mode=process.argv[2];
async function setup(){
 const probe=()=>({addEventListener(){},removeEventListener(){},pause(){},removeAttribute(){},load(){}});
 const f=await createAppFixture({sessionMediaDependencies:{createVideo:probe,createAudio:probe,createURL:()=> 'blob:pending',revokeURL(){}}});
 vm.runInContext("state=initial();state.kind='video';state.fileName='original.mp4';state.audioName='music.wav';persistence.restorePhase='failed';persistence.recoveryValid=true;persistence.recoveryBaseline=JSON.stringify(state)",f.context);
 f.element('#projectFilesButton').onclick();f.element('#relinkSessionMedia').onclick();
 const stale=f.element('#connectSessionMedia').onclick;
 const refs=[];
 for(const [kind,name] of [['Video','original.mp4'],['Audio','music.wav']]){
  const file=new File(['payload'],name); refs.push(new WeakRef(file));
  f.element('#sessionMedia'+kind).onchange({target:{files:[file],value:'selected'}});
 }
 let pending;
 if(mode.startsWith('pending-')){f.element('#sessionMediaConfirmed').checked=true;pending=stale();}
 if(mode==='cancel'||mode==='pending-cancel') f.element('#cancelSessionMedia').onclick();
 if(mode==='native-close'||mode==='pending-native-close'){f.element('#modal').close();f.element('#modal').onclose();}
 if(mode==='replace'||mode==='pending-replace') vm.runInContext("modalOpen('Other','')",f.context);
 await pending;
 if(mode!=='active') await stale();
 return {f,refs};
}
const h=await setup();for(let i=0;i<10;i++){await setImmediate();global.gc();}
console.log(JSON.stringify({mode,retained:h.refs.map(r=>!!r.deref()),open:h.f.element('#modal').open,history:h.f.evaluate('history.length'),future:h.f.evaluate('future.length'),phase:h.f.evaluate('persistence.restorePhase'),video:h.f.evaluate('!!sources.videoFile'),audio:h.f.evaluate('!!sources.audioFile')}));
