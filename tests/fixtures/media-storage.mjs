// Isolated atomic-commit fixture: aborted transactions never change persisted records.
export function createMediaStorageFixture(initial = []) {
  const records=new Map(initial),attempts=[],failures=[],openFailures=[];
  const db={close(){},transaction(name,mode){
    if(mode!=='readwrite')return {objectStore:()=>({get(key){
      const request={};queueMicrotask(()=>{request.result=structuredClone(records.get(key));request.onsuccess();});return request;
    }})};
    const tx={},changes=[],failure=failures.shift();attempts.push(changes);
    tx.objectStore=()=>({put:(value,key)=>changes.push([key,structuredClone(value)]),delete:key=>changes.push([key,null])});
    queueMicrotask(()=>{
      if(failure){tx.error=failure;tx.onabort();return;}
      for(const [key,value] of changes)value===null?records.delete(key):records.set(key,value);
      tx.oncomplete();
    });
    return tx;
  }};
  const factory={open(){
    const request={},failure=openFailures.shift();
    queueMicrotask(()=>{if(failure){request.error=failure;request.onerror();}else{request.result=db;request.onsuccess();}});
    return request;
  }};
  return {factory,records,attempts,failures,openFailures};
}
