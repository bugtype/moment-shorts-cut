import { message as msg } from './i18n.mjs';
let transcriber;
self.onmessage=async event=>{
 try{
  const {pipeline,env}=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
  env.allowLocalModels=false;
  env.backends.onnx.wasm.numThreads=1;
  if(!transcriber)transcriber=await pipeline('automatic-speech-recognition','Xenova/whisper-tiny',{device:'wasm',dtype:'q8',progress_callback:p=>{
   if(p.status==='progress')self.postMessage({type:'progress',...msg('errors.modelDownload',{progress:Math.round(p.progress||0),file:p.file||''})});
  }});
  self.postMessage({type:'progress',...msg('errors.recognizing')});
  const result=await transcriber(event.data.audio,{language:event.data.language,task:'transcribe',return_timestamps:true,chunk_length_s:30,stride_length_s:5});
  self.postMessage({type:'result',result});
 }catch(error){
  // Failed runtime/model initialization may retain a rejected cache in this worker.
  self.postMessage({type:'error',...(!transcriber?{fatal:true}:{}),...msg('errors.recognitionFailed')});
 }
};
