const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {createReadStream}=require('node:fs');
const rulesEngine=require('./rules');
const contentReader=require('./content');
const skip = new Set(['node_modules', '.git', 'dist', 'Applications', 'Windows', 'System', 'Library', '$RECYCLE.BIN']);
// Everyday groups: where a person would actually look for the file later.
const types = {Documents: 'pdf doc docx txt rtf md odt pages epub', Spreadsheets: 'xlsx xls xlsm csv ods tsv numbers', Presentations: 'ppt pptx key odp', Images: 'png jpg jpeg gif webp bmp tiff tif heic heif avif svg ico raw cr2 cr3 nef arw dng', Videos: 'mp4 mov m4v avi mkv webm wmv mpg mpeg', Audio: 'mp3 wav aac flac m4a ogg opus aiff wma', Archives: 'zip rar 7z tar gz tgz bz2 xz', Installers: 'dmg pkg exe msi msix appimage deb rpm', Design: 'psd ai eps fig sketch xd afdesign afphoto indd', Fonts: 'ttf otf woff woff2', Code: 'js mjs ts tsx jsx py rb go rs java swift c cpp h cs php sh ps1 html css json yml yaml toml xml sql ipynb'};
const partial = new Set(['crdownload', 'part', 'partial', 'download', 'opdownload']);
const SCREENSHOT = /^(screen ?shot|screenshot|cleanshot|capture|snip|schermafbeelding|captura)/i;
const RECORDING = /^(screen recording|recording|screencast)/i;
const MONTHS = ['01 January','02 February','03 March','04 April','05 May','06 June','07 July','08 August','09 September','10 October','11 November','12 December'];
const fingerprint = s => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}`;
function kindGroup(name) {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (/\b(receipt|invoice)\b/i.test(name.replace(/[_-]/g, ' '))) return 'Receipts & invoices';
  const kind = Object.keys(types).find(k => types[k].split(' ').includes(ext)) || 'Other';
  if (kind === 'Images' && SCREENSHOT.test(name)) return 'Screenshots';
  if (kind === 'Videos' && RECORDING.test(name)) return 'Screen recordings';
  return kind;
}
function group(name, mode = 'kind', size, modified) {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (mode === 'type') return ext ? ext.toUpperCase() : 'No extension';
  if (mode === 'year' || mode === 'month') {
    const d = modified ? new Date(modified) : new Date();
    return mode === 'year' ? String(d.getFullYear()) : `${d.getFullYear()}/${MONTHS[d.getMonth()]}`;
  }
  // 'kind' (and the older 'smart'/'ratio' names) group by what the file is.
  return kindGroup(name);
}
function cleanupFlags(row, options) {
  const flags = [];
  if (partial.has(row.ext)) flags.push('partial');
  if (types.Installers.split(' ').includes(row.ext) && row.ageDays > 14) flags.push('installer');
  if (row.bytes >= (Number(options.largeBytes) || 1024 ** 3)) flags.push('large');
  if (row.old) flags.push('old');
  return flags;
}
async function refresh(plan) {
  const destinations=new Map();
  for(const row of plan.rows){
    delete row.conflict;
    row.to=row.keep?row.from:path.join(plan.root,rulesEngine.folderName(row.folder),row.name);
    row.canMove=!row.keep&&row.from!==row.to;
    if(!row.canMove)continue;
    const key=row.to.toLowerCase();
    const previous=destinations.get(key);
    if(previous)previous.conflict=row.conflict='Multiple files share this destination';
    destinations.set(key,row);
    try{await fs.lstat(row.to);row.conflict='Destination already exists';}catch(e){if(e.code!=='ENOENT')row.conflict='Cannot verify destination';}
  }
  return plan;
}
async function scan(root, options = {}, dimensions = async () => null, progress = ()=>{}, canceled = ()=>false) {
  root=await fs.realpath(root);
  if(root===path.parse(root).root)throw Error('Choose a personal folder rather than a whole drive.');
  const rules=rulesEngine.validateRules(options.rules||[]);
  const rows=[],warnings=[],emptyDirs=[];
  // Image dimensions are only read when a saved rule asks about them.
  const needsSize=rules.some(r=>r.enabled&&['width','height','minWidth','minHeight','ratio'].some(k=>k in r.match));
  const stop=()=>{if(canceled())throw Error('Scan canceled. Previous preview was cleared.');};
  async function walk(dir){
    stop();
    const listing=await fs.readdir(dir,{withFileTypes:true});
    if(dir!==root&&listing.every(e=>e.name==='.DS_Store'||e.name==='Thumbs.db'||e.name==='desktop.ini'))emptyDirs.push(dir);
    for(const ent of listing){
      stop();
      if(ent.name.startsWith('.')||skip.has(ent.name))continue;
      const from=path.join(dir,ent.name);
      if(ent.isSymbolicLink())continue;
      if(ent.isDirectory()){if(ent.name.toLowerCase().endsWith('.app'))continue;if(options.recursive){try{await walk(from);}catch(e){if(canceled())throw e;warnings.push(`${from}: ${e.message}`);}}else{try{const inner=await fs.readdir(from);if(inner.every(n=>n==='.DS_Store'||n==='Thumbs.db'||n==='desktop.ini'))emptyDirs.push(from);}catch{}}continue;}
      if(!ent.isFile())continue;
      try{
        const stat=await fs.lstat(from);if(!stat.isFile()||stat.isSymbolicLink())continue;
        const ext=path.extname(ent.name).slice(1).toLowerCase();
        const row={id:crypto.randomUUID(),from,name:ent.name,relative:path.relative(root,from),ext,bytes:stat.size,modified:stat.mtime.toISOString(),ageDays:Math.max(0,(Date.now()-stat.mtimeMs)/86400000),fingerprint:fingerprint(stat)};
        await validate(from,row.fingerprint);
        row.old=row.ageDays>(Number(options.days)||365);
        if(needsSize&&/^(png|jpe?g|webp|gif|bmp|heic|avif|tiff?)$/.test(ext)){const size=await dimensions(from);if(size?.width&&size?.height){row.width=size.width;row.height=size.height;}}
        row.folder=group(ent.name,options.mode,null,row.modified);row.source='metadata';row.confidence='metadata';row.reason=reasonFor(row,options.mode);
        row.flags=cleanupFlags(row,options);if(row.flags.includes('partial')){row.keep=true;row.reason='Unfinished download — left in place';}
        if(options.content&&!row.keep){row.content=await contentReader.inspect(from,ext,row.bytes);const text=row.content.text||'';if(!['type','year','month'].includes(options.mode)&&/\b(receipt|invoice)\b/i.test(text)&&/\b(total|amount due)\b/i.test(text)&&/\b(tax|paid|payment|subtotal)\b/i.test(text)){row.folder='Receipts & invoices';row.source='content';row.confidence='review';row.reason='Receipt/invoice text plus amount and payment/tax terms; verify classification.';}}
        const decision=rulesEngine.decide(row,rules);if(decision)Object.assign(row,decision);
        if(Number(options.activeDays)>0&&row.ageDays<Number(options.activeDays)){row.keep=true;row.source='protected';row.confidence='rule';row.reason=`Protected: modified within ${Number(options.activeDays)} days`;}
        await validate(from,row.fingerprint);rows.push(row);progress({phase:'Reading files',count:rows.length});
      }catch(e){warnings.push(`${from}: ${e.message}`);}
    }
  }
  await walk(root);stop();
  if(options.content&&!['type','year','month'].includes(options.mode)){
    const schemas=new Map();
    for(const row of rows){const headers=row.content?.headers;if(!headers||headers.length<2||row.source==='rule'||row.keep)continue;const key=headers.map(h=>h.trim().toLowerCase()).join('\u001f');if(!schemas.has(key))schemas.set(key,[]);schemas.get(key).push(row);}
    for(const [key,groupRows] of schemas){if(groupRows.length<2)continue;const code=crypto.createHash('sha256').update(key).digest('hex').slice(0,8);for(const row of groupRows){row.folder=`Matching reports/Schema ${code}`;row.source='content';row.confidence='review';row.reason=`Matching ordered headers in ${groupRows.length} files: ${row.content.headers.slice(0,6).join(', ')}`;}}
  }
  if(options.duplicates){
    const sizes=new Map();for(const row of rows){if(!sizes.has(row.bytes))sizes.set(row.bytes,[]);sizes.get(row.bytes).push(row);}
    let count=0;
    for(const sameSize of sizes.values()){
      if(sameSize.length<2)continue;
      const hashes=new Map();
      for(const row of sameSize){stop();try{await validate(row.from,row.fingerprint);const hash=crypto.createHash('sha256');for await(const chunk of createReadStream(row.from)){stop();hash.update(chunk);}await validate(row.from,row.fingerprint);const key=hash.digest('hex');if(!hashes.has(key))hashes.set(key,[]);hashes.get(key).push(row);progress({phase:'Checking duplicates',count:++count});}catch(e){if(canceled())throw e;warnings.push(`${row.name}: duplicate check skipped (${e.message})`);}}
      for(const [hash,duplicates] of hashes)if(duplicates.length>1){
        // Keep the oldest copy (usually the original); the rest are suggested for Trash.
        const keeper=[...duplicates].sort((a,b)=>a.modified.localeCompare(b.modified)||a.name.length-b.name.length||a.name.localeCompare(b.name))[0];
        for(const row of duplicates){row.duplicate=hash;row.duplicateCount=duplicates.length;row.duplicateOf=row===keeper?null:keeper.name;if(row!==keeper)row.flags.push('duplicate');}
      }
    }
  }
  stop();return refresh({root,rows,warnings,emptyDirs,mode:options.mode||'kind'});
}
function reasonFor(row,mode){
  if(mode==='type')return `.${row.ext||'—'} files`;
  if(mode==='year'||mode==='month')return `Last modified ${new Date(row.modified).toLocaleDateString(undefined,{year:'numeric',month:'long'})}`;
  const g=kindGroup(row.name);
  if(g==='Screenshots')return 'Named like a screenshot';
  if(g==='Screen recordings')return 'Named like a screen recording';
  if(g==='Receipts & invoices')return 'Filename mentions a receipt or invoice';
  if(g==='Other')return row.ext?`No everyday group for .${row.ext}`:'No file extension';
  return `.${row.ext} → ${g}`;
}
async function revise(plan,changes){
  for(const change of changes){const row=plan.rows.find(r=>r.id===change.id);if(!row)throw Error('Unknown file. Scan again.');const folder=rulesEngine.folderName(change.folder);if(row.source==='protected')throw Error('Change the recent-file protection setting and rescan first.');row.folder=folder;row.keep=false;row.source='manual';row.confidence='rule';row.reason='Destination chosen by you';}
  return refresh(plan);
}
async function safeParent(root,directory){
  if(await fs.realpath(root)!==root)throw Error('Root folder changed.');
  const rel=path.relative(root,directory);
  if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('Destination must stay inside the chosen folder.');
  let current=root;
  for(const piece of rel.split(path.sep).filter(Boolean)){current=path.join(current,piece);try{await fs.mkdir(current);}catch(e){if(e.code!=='EEXIST')throw e;}const stat=await fs.lstat(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Destination contains a symbolic link or non-folder.');}
}
async function validate(file, expected) {
  if (await fs.realpath(file) !== file) throw Error('File path contains a symbolic link; scan again.');
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || fingerprint(stat) !== expected) throw Error('File changed since preview; scan again.');
}
async function safeMove(from, to, expected) {
  await validate(from, expected);
  // Hard-link then unlink is same-volume and atomically refuses an existing destination.
  await fs.link(from, to);
  try { await validate(from, expected); await fs.unlink(from); }
  catch (e) { await fs.unlink(to); throw e; }
}
async function apply(plan, ids, journal, persist) {
  const results = [];
  for (const row of plan.rows.filter(r => ids.includes(r.id))) {
    try {
      if (row.canMove === false || row.conflict) throw Error(row.conflict || 'Already organized.');
      await safeParent(plan.root,path.dirname(row.to));
      if (await fs.realpath(path.dirname(row.to)) !== path.dirname(row.to)) throw Error('Destination contains a symbolic link.');
      const entry = {id:row.id,name:row.name,from:row.from,to:row.to,fingerprint:row.fingerprint,status:'pending'};
      journal.push(entry); await persist(journal);
      await safeMove(row.from, row.to, row.fingerprint);
      entry.status = 'moved'; await persist(journal);
      results.push({name: row.name, ok: true});
    } catch (e) { results.push({name: row.name, ok: false, error: e.message}); }
  }
  return results;
}
async function undo(journal, persist) {
  const results = [];
  for (const entry of [...journal].reverse()) {
    if (!['moved','pending'].includes(entry.status)) continue;
    try {
      await safeMove(entry.to, entry.from, entry.fingerprint);
      entry.status = 'undone'; await persist(journal);
      results.push({name: entry.name, ok: true});
    } catch(e) { results.push({name: entry.name, ok: false, error: e.message}); }
  }
  return results;
}
module.exports = {scan, apply, undo, validate, group, kindGroup, refresh, revise, safeMove, fingerprint};
