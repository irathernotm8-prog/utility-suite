const fs=require('node:fs/promises');
const path=require('node:path');
const {validateRules}=require('./rules');
const defaults={profiles:[{id:'default',name:'Everyday',rules:[]},{id:'business',name:'Business records',rules:[{id:'receipts',name:'Receipts by year',action:'group',folder:'Receipts/{year}',match:{nameContains:'receipt'},enabled:true}]}]};
async function load(dir){try{return validate(JSON.parse(await fs.readFile(path.join(dir,'profiles.json'),'utf8')));}catch(e){if(e.code==='ENOENT')return structuredClone(defaults);throw e;}}
function validate(settings){if(!Array.isArray(settings?.profiles)||!settings.profiles.length||settings.profiles.length>30)throw Error('Use 1–30 profiles.');const ids=new Set();return {profiles:settings.profiles.map(p=>{if(typeof p.id!=='string'||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>80)throw Error('Profiles need unique IDs and short names.');ids.add(p.id);return {id:p.id,name:p.name.trim(),rules:validateRules(p.rules)};})};}
async function save(dir,settings){const value=validate(settings);await fs.mkdir(dir,{recursive:true});const p=path.join(dir,'profiles.json');await fs.writeFile(p+'.tmp',JSON.stringify(value,null,2),{mode:0o600});await fs.rename(p+'.tmp',p);return value;}
// Explorer preferences (window layout, favorites, terminal). Separate from Tidy profiles.
const prefDefaults={view:'list',sort:{key:'name',dir:1},foldersFirst:true,showHidden:false,showPreview:true,iconSize:104,terminal:'',editor:'',pins:[],unpinned:[],collapsed:[],recents:[],tabs:[],activeTab:0,sidebarWidth:212,previewWidth:300,theme:'system'};
async function loadPrefs(dir){try{const raw=JSON.parse(await fs.readFile(path.join(dir,'prefs.json'),'utf8'));return cleanPrefs(raw);}catch{return structuredClone(prefDefaults);}}
function cleanPrefs(raw){const out=structuredClone(prefDefaults);if(!raw||typeof raw!=='object')return out;
  for(const k of ['view','terminal','editor','theme'])if(typeof raw[k]==='string'&&raw[k].length<200)out[k]=raw[k];
  for(const k of ['foldersFirst','showHidden','showPreview'])if(typeof raw[k]==='boolean')out[k]=raw[k];
  for(const k of ['iconSize','activeTab','sidebarWidth','previewWidth'])if(Number.isFinite(raw[k]))out[k]=raw[k];
  if(raw.sort&&typeof raw.sort.key==='string')out.sort={key:raw.sort.key,dir:raw.sort.dir===-1?-1:1};
  for(const k of ['pins','unpinned','recents','tabs','collapsed'])if(Array.isArray(raw[k]))out[k]=raw[k].filter(x=>typeof x==='string'&&x.length<4096).slice(0,40);
  if(!['list','grid','columns'].includes(out.view))out.view='list';
  if(!['system','light','dark'].includes(out.theme))out.theme='system';
  return out;}
async function savePrefs(dir,value){const clean=cleanPrefs(value);await fs.mkdir(dir,{recursive:true});const p=path.join(dir,'prefs.json');await fs.writeFile(p+'.tmp',JSON.stringify(clean,null,2),{mode:0o600});await fs.rename(p+'.tmp',p);return clean;}
module.exports={load,save,validate,loadPrefs,savePrefs,cleanPrefs};
