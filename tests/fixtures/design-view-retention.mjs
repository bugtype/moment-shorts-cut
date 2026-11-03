import vm from 'node:vm';
import {setImmediate} from 'node:timers/promises';
import {createAppFixture} from './app.mjs';
const f=await createAppFixture();
const root=f.element('#panelContent'),baseQuery=f.doc.querySelector;
let controls=[],markup='',nodes=new Map();
root.querySelector=selector=>controls.find(input=>selector===`[data-design="${input.dataset.design}"]`)||nodes.get(selector)||null;
root.querySelectorAll=selector=>selector==='[data-design]'?controls:[];
Object.defineProperty(root,'innerHTML',{get:()=>markup,set(value){
 for(const input of controls)input.isConnected=false;
 controls=[];markup=value;nodes=new Map([...value.matchAll(/id="([^"]+)"/g)].map(([,id])=>['#'+id,{}]));
 for(const [,attrs] of value.matchAll(/<input\b([^>]*)>/g)){
 const path=/data-design="([^"]+)"/.exec(attrs)?.[1];if(!path)continue;
 controls.push({dataset:{design:path},type:/type="([^"]+)"/.exec(attrs)?.[1]||'text',value:/value="([^"]*)"/.exec(attrs)?.[1]||'',isConnected:true,setAttribute(){},removeAttribute(){},setCustomValidity(){},validity:{}});
 }
}});
vm.runInContext("state.captions=Array.from({length:10000},(_,i)=>({start:i/1000,end:(i+1)/1000,text:'Caption '+i+' '+ 'x'.repeat(100)}));textLayer='title';switchPanel('text');",f.context);
// JSON size describes the retired authored payload, not native heap allocation.
const serializedBytes=vm.runInContext('JSON.stringify(state).length',f.context);
const mode=process.argv[2]||'reset';
const ref=new WeakRef(vm.runInContext('state',f.context));
if(mode!=='active'){
 vm.runInContext("switchPanel('media');confirmReset();",f.context);
 f.element('#confirmReset').onclick();
 if(mode==='return')vm.runInContext("switchPanel('text')",f.context);
}

for(let i=0;i<10;i++){await setImmediate();global.gc();}
console.log(JSON.stringify({serializedBytes,oldProjectRetained:!!ref.deref(),currentCaptions:f.evaluate('state.captions.length'),history:f.evaluate('history.length'),future:f.evaluate('future.length'),panel:f.evaluate('panel')}));
