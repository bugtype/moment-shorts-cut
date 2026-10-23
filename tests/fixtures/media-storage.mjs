// Isolated transaction fixture, not a full IndexedDB implementation.
// Enqueue exceptions alone do not abort; asynchronous failures and abort() do.
export function createMediaStorageFixture(initial = []) {
  const records=new Map(initial),attempts=[],failures=[],openFailures=[],enqueueFailures=[],events=[];
  const db={close(){},transaction(name,mode){
    if(mode!=='readwrite')return {objectStore:()=>({get(key){
      const request={};queueMicrotask(()=>{request.result=structuredClone(records.get(key));request.onsuccess();});return request;
    }})};
    const tx={},changes=[],failure=failures.shift(),enqueueFailure=enqueueFailures.shift();attempts.push(changes);
    let aborted=false;
    tx.abort=()=>{aborted=true;};
    function enqueue(key,value){
      if(enqueueFailure?.key===key)throw enqueueFailure.error;
      changes.push([key,structuredClone(value)]);
    }
    tx.objectStore=()=>({put:(value,key)=>enqueue(key,value),delete:key=>enqueue(key,null)});
    queueMicrotask(()=>{
      if(!aborted&&failure){tx.error=failure;events.push('error');tx.onerror?.();aborted=true;}
      if(aborted){events.push('abort');tx.onabort?.();return;}
      for(const [key,value] of changes)value===null?records.delete(key):records.set(key,value);
      events.push('complete');tx.oncomplete?.();
    });
    return tx;
  }};
  const factory={open(){
    const request={},failure=openFailures.shift();
    queueMicrotask(()=>{if(failure){request.error=failure;request.onerror();}else{request.result=db;request.onsuccess();}});
    return request;
  }};
  return {factory,records,attempts,failures,openFailures,enqueueFailures,events};
}
