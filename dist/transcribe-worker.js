let transcriber;
self.onmessage=async event=>{
 try{
  const {pipeline,env}=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
  env.allowLocalModels=false;
  env.backends.onnx.wasm.numThreads=1;
  if(!transcriber)transcriber=await pipeline('automatic-speech-recognition','Xenova/whisper-tiny',{device:'wasm',dtype:'q8',progress_callback:p=>{
   if(p.status==='progress')self.postMessage({type:'progress',message:`음성 인식 모델 다운로드 중 · ${Math.round(p.progress||0)}% (${p.file||''})`});
  }});
  self.postMessage({type:'progress',message:'음성을 인식하고 있습니다. 영상 길이와 기기 성능에 따라 수 분 걸릴 수 있습니다.'});
  const result=await transcriber(event.data.audio,{language:event.data.language,task:'transcribe',return_timestamps:true,chunk_length_s:30,stride_length_s:5});
  self.postMessage({type:'result',result});
 }catch(error){self.postMessage({type:'error',message:'자동 자막 생성에 실패했습니다. 인터넷 연결과 기기 메모리를 확인해 주세요. SRT 불러오기 또는 직접 입력도 가능합니다.'});}
};
