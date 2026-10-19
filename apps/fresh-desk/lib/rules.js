const path = require('node:path');
const fields = new Set(['extensions','nameContains','nameEquals','pathContains','contentContains','headersContain','minBytes','maxBytes','minAgeDays','maxAgeDays','minWidth','minHeight','width','height','ratio']);
function folderName(value) {
  if (typeof value !== 'string' || value.length > 180) throw Error('Destination must be a folder name, up to 180 characters.');
  const parts=value.trim().replaceAll('\\','/').split('/');
  if (!parts.length || parts.length>4 || parts.some(p=>!p||p!==p.trim()||p.startsWith('.')||/[<>:"|?*\x00-\x1f]/.test(p)||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p))) throw Error('Use up to four ordinary folder names, separated by /. No absolute paths or reserved names.');
  return parts.join('/');
}
function validateRules(rules) {
  if(!Array.isArray(rules)||rules.length>100)throw Error('Use at most 100 rules.');
  return rules.map((r,i)=>{
    if(!r||typeof r.name!=='string'||!r.name.trim()||r.name.length>100)throw Error(`Rule ${i+1} needs a short name.`);
    if(!['group','keep'].includes(r.action))throw Error(`Invalid action in ${r.name}.`);
    const match=r.match;
    if(!match||typeof match!=='object'||Array.isArray(match)||!Object.keys(match).length)throw Error(`${r.name} needs a condition.`);
    for(const [k,v] of Object.entries(match)) {
      if(!fields.has(k))throw Error(`Unknown condition ${k}.`);
      if(k==='extensions'||k==='headersContain') {if(!Array.isArray(v)||!v.length||v.length>100||v.some(s=>typeof s!=='string'||!s.trim()||s.length>100))throw Error(`Invalid ${k}.`);}
      else if(k.startsWith('min')||k.startsWith('max')||['width','height'].includes(k)) {if(typeof v!=='number'||!Number.isFinite(v)||v<0)throw Error(`Invalid number for ${k}.`);}
      else if(typeof v!=='string'||!v.trim()||v.length>300)throw Error(`Invalid ${k}.`);
    }
    if(match.ratio&&!/^\d{1,6}:\d{1,6}$/.test(match.ratio))throw Error('Ratio must look like 1:1 or 16:9.');
    return {id:String(r.id||i),name:r.name.trim(),action:r.action,folder:r.action==='group'?folderName(r.folder):'',match,enabled:r.enabled!==false};
  });
}
function matches(row,match) {
  const lower=s=>String(s||'').toLowerCase();
  for(const [k,v] of Object.entries(match)) {
    if(k==='extensions'&&!v.map(x=>lower(x).replace(/^\./,'')).includes(row.ext))return false;
    if(k==='nameEquals'&&lower(row.name)!==lower(v))return false;
    if(k==='nameContains'&&!lower(row.name).includes(lower(v)))return false;
    if(k==='pathContains'&&!lower(row.relative).includes(lower(v)))return false;
    if(k==='contentContains'&&!lower(row.content?.text).includes(lower(v)))return false;
    if(k==='headersContain'&&!v.every(x=>(row.content?.headers||[]).some(h=>lower(h)===lower(x))))return false;
    const numbers={minBytes:row.bytes,maxBytes:row.bytes,minAgeDays:row.ageDays,maxAgeDays:row.ageDays,minWidth:row.width,minHeight:row.height,width:row.width,height:row.height};
    if(k in numbers) {const n=numbers[k];if(n===undefined||k.startsWith('min')&&n<v||k.startsWith('max')&&n>v||['width','height'].includes(k)&&n!==v)return false;}
    if(k==='ratio'){const [w,h]=v.split(':').map(Number);if(!w||!h||!row.width||!row.height||row.width*h!==row.height*w)return false;}
  }
  return true;
}
function decide(row,rules) {
  const rule=rules.find(r=>r.enabled&&matches(row,r.match));
  if(!rule)return null;
  return {folder:rule.action==='keep'?null:rule.folder.replaceAll('{year}',row.modified.slice(0,4)),keep:rule.action==='keep',source:'rule',reason:`Rule: ${rule.name}`,confidence:'rule',ruleId:rule.id};
}
module.exports={folderName,validateRules,matches,decide};
