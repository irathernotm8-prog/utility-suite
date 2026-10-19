const {parentPort,workerData}=require('node:worker_threads');
const fs=require('node:fs/promises');
function csvHeader(text,sep){const result=[];let value='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(c===sep&&!quoted){result.push(value.trim());value='';}else if((c==='\n'||c==='\r')&&!quoted)break;else value+=c;}result.push(value.trim());return result.slice(0,80).filter(Boolean);}
async function inspect({file,ext}) {
  let text='',headers=[];
  if(['txt','md','csv','tsv','json','log'].includes(ext)) {
    const handle=await fs.open(file,'r');try{const buffer=Buffer.alloc(65536);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);text=buffer.subarray(0,bytesRead).toString('utf8');}finally{await handle.close();}
    if(ext==='csv'||ext==='tsv')headers=csvHeader(text,ext==='tsv'?'\t':',');
  } else if(ext==='xlsx') {
    const Excel=require('exceljs');const book=new Excel.Workbook();await book.xlsx.readFile(file);
    const sheet=book.worksheets[0];if(sheet){for(let i=1;i<=Math.min(sheet.rowCount,10);i++){const row=sheet.getRow(i);const values=[];row.eachCell({includeEmpty:true},(cell,n)=>{if(n<=80)values.push(cell.text.slice(0,200));});if(values.filter(Boolean).length){headers=values.filter(Boolean);break;}}text=headers.join(' | ');}
  } else if(ext==='pdf') {
    globalThis.DOMMatrix=(await import('@thednp/dommatrix')).default;
    const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const path=require('node:path');
    const task=getDocument({data:new Uint8Array(await fs.readFile(file)),standardFontDataUrl:path.join(path.dirname(require.resolve('pdfjs-dist/package.json')),'standard_fonts')+path.sep,isEvalSupported:false,useSystemFonts:false,disableFontFace:true});
    const doc=await task.promise;try{for(let i=1;i<=Math.min(3,doc.numPages);i++){const page=await doc.getPage(i);const content=await page.getTextContent();text+=content.items.map(x=>x.str||'').join(' ')+'\n';}}finally{await task.destroy();}
    if(!text.trim())return {text:'',headers:[],note:'No extractable text; scanned images need OCR.'};
  } else return {text:'',headers:[],note:'Content reader does not support this format.'};
  return {text:text.slice(0,12000),headers:headers.map(x=>x.trim()).filter(Boolean)};
}
if(parentPort)inspect(workerData).then(result=>parentPort.postMessage(result)).catch(e=>parentPort.postMessage({text:'',headers:[],note:`Could not read contents: ${e.message}`}));
module.exports={csvHeader};
