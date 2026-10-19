const fs=require('node:fs/promises');
const path=require('node:path');
const {validateRules}=require('./rules');
const defaults={profiles:[{id:'default',name:'Everyday',rules:[]},{id:'creative',name:'Creative work',rules:[{id:'square',name:'Square social artwork',action:'group',folder:'Social artwork',match:{extensions:['png','jpg','jpeg','webp'],ratio:'1:1',minWidth:1000},enabled:true}]},{id:'business',name:'Business records',rules:[{id:'receipts',name:'Receipt filenames by modified year',action:'group',folder:'Receipts/{year}',match:{nameContains:'receipt'},enabled:true}]}]};
async function load(dir){try{return validate(JSON.parse(await fs.readFile(path.join(dir,'profiles.json'),'utf8')));}catch(e){if(e.code==='ENOENT')return structuredClone(defaults);throw e;}}
function validate(settings){if(!Array.isArray(settings?.profiles)||!settings.profiles.length||settings.profiles.length>30)throw Error('Use 1–30 profiles.');const ids=new Set();return {profiles:settings.profiles.map(p=>{if(typeof p.id!=='string'||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>80)throw Error('Profiles need unique IDs and short names.');ids.add(p.id);return {id:p.id,name:p.name.trim(),rules:validateRules(p.rules)};})};}
async function save(dir,settings){const value=validate(settings);await fs.mkdir(dir,{recursive:true});const p=path.join(dir,'profiles.json');await fs.writeFile(p+'.tmp',JSON.stringify(value,null,2),{mode:0o600});await fs.rename(p+'.tmp',p);return value;}
module.exports={load,save,validate};
