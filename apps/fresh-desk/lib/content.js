const path=require('node:path');
const {Worker}=require('node:worker_threads');
const supported=new Set(['pdf','xlsx','txt','md','csv','tsv','json','log']);
async function inspect(file,ext,bytes) {
  if(!supported.has(ext))return {text:'',headers:[],note:'No content reader for this format.'};
  if(bytes>20*1024*1024)return {text:'',headers:[],note:'Content scan skipped: file exceeds 20 MB.'};
  return new Promise(resolve=>{
    let done=false;const worker=new Worker(path.join(__dirname,'content-worker.js'),{workerData:{file,ext},resourceLimits:{maxOldGenerationSizeMb:192}});
    const finish=result=>{if(done)return;done=true;clearTimeout(timer);worker.terminate();resolve(result);};
    const timer=setTimeout(()=>finish({text:'',headers:[],note:'Content scan timed out after 15 seconds.'}),15000);
    worker.once('message',finish);worker.once('error',()=>finish({text:'',headers:[],note:'Content reader failed; metadata grouping retained.'}));worker.once('exit',()=>finish({text:'',headers:[],note:'Content reader stopped.'}));
  });
}
module.exports={inspect};
