// Kiln — model sources: CivitAI, Hugging Face, and "paste any link".
const { net } = require('electron');
const core = require('../core');
const { typeForCivitai, guessType } = require('../shared/types');

const UA = 'Kiln/0.1 (+desktop app)';

async function getJSON(url, headers = {}) {
  const res = await net.fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA, ...headers } });
  if (res.status === 401 || res.status === 403) { const e = new Error('This needs an API key or token. Add one in Settings → Accounts.'); e.code = res.status; throw e; }
  if (res.status === 404) { const e = new Error('Not found'); e.code = 404; throw e; }
  if (!res.ok) throw new Error(`The server answered ${res.status}`);
  return res.json();
}

/* ---------- CivitAI ---------- */
const CIV = 'https://civitai.com/api/v1';
const civHeaders = () => { const k = core.secret('civitaiKey'); return k ? { Authorization: `Bearer ${k}` } : {}; };
const thumb = (url, w = 450) => {
  if (!url) return '';
  const m = url.match(/^(https:\/\/image\.civitai\.com\/[^/]+\/[^/]+)\/(?:[^/]*=[^/]*\/)?([^/]+)$/);
  return m ? `${m[1]}/width=${w}/${m[2]}` : url;
};

function mapVersion(v, model) {
  return {
    id: v.id, name: v.name, baseModel: v.baseModel || '', trainedWords: v.trainedWords || [], publishedAt: v.publishedAt || v.createdAt,
    earlyAccess: !!(v.earlyAccessEndsAt && new Date(v.earlyAccessEndsAt) > new Date()) || v.availability === 'EarlyAccess',
    description: v.description || '',
    files: (v.files || []).map(f => ({ id: f.id, name: f.name, sizeKB: f.sizeKB, type: f.type, primary: !!f.primary, downloadUrl: f.downloadUrl, format: f.metadata?.format || '', fp: f.metadata?.fp || '', size: f.metadata?.size || '', hashes: f.hashes || {} })),
    images: (v.images || []).map(i => ({ url: i.url, thumb: thumb(i.url), nsfwLevel: i.nsfwLevel ?? (i.nsfw && i.nsfw !== 'None' ? 4 : 1), type: i.type || 'image', width: i.width, height: i.height, meta: i.meta || null })),
    modelId: model?.id ?? v.modelId
  };
}
function mapModel(m) {
  return {
    source: 'civitai', id: m.id, name: m.name, type: m.type, kilnType: typeForCivitai(m.type), nsfw: !!m.nsfw, nsfwLevel: m.nsfwLevel || 0,
    creator: m.creator?.username || '', creatorImage: m.creator?.image || '', tags: m.tags || [], description: m.description || '',
    stats: { downloads: m.stats?.downloadCount || 0, likes: m.stats?.thumbsUpCount || 0, comments: m.stats?.commentCount || 0 },
    versions: (m.modelVersions || []).map(v => mapVersion(v, m)),
    url: `https://civitai.com/models/${m.id}`
  };
}
async function civSearch({ query = '', types = [], baseModels = [], sort = 'Most Downloaded', period = 'AllTime', nsfw = false, cursor = '', limit = 30 }) {
  const u = new URL(CIV + '/models');
  u.searchParams.set('limit', String(limit));
  if (query) u.searchParams.set('query', query);
  for (const t of types) u.searchParams.append('types', t);
  for (const b of baseModels) u.searchParams.append('baseModels', b);
  if (sort) u.searchParams.set('sort', sort);
  if (period && !query) u.searchParams.set('period', period);
  u.searchParams.set('nsfw', nsfw ? 'true' : 'false');
  if (cursor) u.searchParams.set('cursor', cursor);
  const r = await getJSON(u.toString(), civHeaders());
  return { items: (r.items || []).map(mapModel), nextCursor: r.metadata?.nextCursor || null };
}
async function civModel(id) { return mapModel(await getJSON(`${CIV}/models/${id}`, civHeaders())); }
async function civVersion(id) {
  const v = await getJSON(`${CIV}/model-versions/${id}`, civHeaders());
  return { version: mapVersion(v), model: v.model || {}, modelId: v.modelId, raw: v };
}
async function civByHash(sha256) {
  const v = await getJSON(`${CIV}/model-versions/by-hash/${sha256}`, civHeaders());
  return { version: mapVersion(v), model: v.model || {}, modelId: v.modelId, raw: v };
}
function civDownloadUrl(url) {
  const k = core.secret('civitaiKey');
  if (!k || !/civitai\.com/.test(url)) return url;
  return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(k);
}
// Stability Matrix compatible sidecar (".cm-info.json"), so both apps read each other's metadata
function cmInfo({ model, version, file }) {
  return {
    ModelId: version.modelId ?? model?.id ?? null, ModelName: model?.name || '', ModelDescription: model?.description || '', Nsfw: !!model?.nsfw,
    Tags: model?.tags || [], ModelType: model?.type || '', VersionId: version.id, VersionName: version.name, VersionDescription: version.description || null,
    AuthorUsername: model?.creator?.username || model?.creator || '', BaseModel: version.baseModel || '', RemoteFileName: file?.name || '',
    RemoteFileId: file?.id || null, FileMetadata: { fp: file?.fp || null, size: file?.size || null, format: file?.format || null },
    ImportedAt: new Date().toISOString(), Hashes: { SHA256: file?.hashes?.SHA256 || null, CRC32: file?.hashes?.CRC32 || null, BLAKE3: file?.hashes?.BLAKE3 || null },
    TrainedWords: version.trainedWords || [], Stats: null, UserTitle: null, ThumbnailImageUrl: null, InferenceDefaults: null, Source: 0, SourceUrl: `https://civitai.com/models/${version.modelId ?? model?.id}?modelVersionId=${version.id}`
  };
}

/* ---------- Hugging Face ---------- */
const HF = 'https://huggingface.co';
const hfHeaders = () => { const t = core.secret('hfToken'); return t ? { Authorization: `Bearer ${t}` } : {}; };
const ESSENTIALS = [
  { repo: 'madebyollin/sdxl-vae-fp16-fix', type: 'VAE', note: 'SDXL VAE that works in half precision (fixes black images)' },
  { repo: 'stabilityai/sdxl-vae', type: 'VAE', note: 'Official SDXL VAE' },
  { repo: 'comfyanonymous/flux_text_encoders', type: 'TextEncoders', note: 'CLIP-L and T5 text encoders for Flux' },
  { repo: 'city96/FLUX.1-dev-gguf', type: 'DiffusionModels', note: 'Flux dev in smaller GGUF sizes for 8–12 GB cards' },
  { repo: 'xinsir/controlnet-union-sdxl-1.0', type: 'ControlNet', note: 'One ControlNet for every SDXL control type' },
  { repo: 'lllyasviel/sd_control_collection', type: 'ControlNet', note: 'ControlNets for SD 1.5 and SDXL' },
  { repo: 'h94/IP-Adapter', type: 'IpAdapter', note: 'Use an image as the prompt' },
  { repo: 'Bingsu/adetailer', type: 'Ultralytics', note: 'Face, hand and person detectors for ADetailer' },
  { repo: 'ai-forever/Real-ESRGAN', type: 'ESRGAN', note: 'Real-ESRGAN upscalers' },
  { repo: 'lokCX/4x-Ultrasharp', type: 'ESRGAN', note: '4x-UltraSharp upscaler' }
];
async function hfSearch({ query = '', sort = 'downloads', filter = 'text-to-image', limit = 40 }) {
  const u = new URL(HF + '/api/models');
  if (query) u.searchParams.set('search', query);
  if (filter) u.searchParams.set('filter', filter);
  u.searchParams.set('sort', sort); u.searchParams.set('direction', '-1'); u.searchParams.set('limit', String(limit));
  const r = await getJSON(u.toString(), hfHeaders());
  return { items: r.map(m => ({ source: 'hf', id: m.id || m.modelId, name: (m.id || m.modelId).split('/').pop(), creator: (m.id || '').split('/')[0], likes: m.likes || 0, downloads: m.downloads || 0, tags: m.tags || [], pipeline: m.pipeline_tag || '', updatedAt: m.lastModified, gated: !!m.gated, url: `${HF}/${m.id}` })) };
}
async function hfFiles(repo, revision = 'main') {
  const r = await getJSON(`${HF}/api/models/${repo}/tree/${revision}?recursive=1`, hfHeaders());
  return r.filter(f => f.type === 'file').map(f => ({ path: f.path, size: f.lfs?.size || f.size || 0, url: `${HF}/${repo}/resolve/${revision}/${f.path.split('/').map(encodeURIComponent).join('/')}`, isModel: /\.(safetensors|ckpt|pt|pth|bin|gguf|sft|onnx)$/i.test(f.path) }));
}
async function hfModel(repo) {
  const m = await getJSON(`${HF}/api/models/${repo}`, hfHeaders());
  return { id: m.id, author: m.author, likes: m.likes, downloads: m.downloads, tags: m.tags || [], gated: !!m.gated, pipeline: m.pipeline_tag, cardData: m.cardData || {}, url: `${HF}/${m.id}` };
}

/* ---------- any link ---------- */
// Works out what a pasted link points to and how to download it
async function resolveLink(raw) {
  const s = String(raw || '').trim();
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch { throw new Error('That doesn’t look like a link'); }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'civitai.com' || host === 'civitai.green' || host.endsWith('civitai.com')) {
    let m = u.pathname.match(/\/api\/download\/models\/(\d+)/);
    if (m) { const v = await civVersion(m[1]); return { kind: 'civitai', modelId: v.modelId, versionId: Number(m[1]) }; }
    m = u.pathname.match(/\/models\/(\d+)/);
    if (m) return { kind: 'civitai', modelId: Number(m[1]), versionId: Number(u.searchParams.get('modelVersionId')) || null };
    throw new Error('Open a model page on CivitAI and copy its link');
  }
  if (host === 'civitaiarchive.com' || host.endsWith('civarchive.com')) {
    const m = u.pathname.match(/\/models\/(\d+)/);
    if (m) return { kind: 'civitai', modelId: Number(m[1]), versionId: Number(u.searchParams.get('modelVersionId')) || null, archive: true, url: u.toString() };
  }
  if (host === 'huggingface.co' || host === 'hf.co') {
    const parts = u.pathname.split('/').filter(Boolean);
    const isDatasets = parts[0] === 'datasets' || parts[0] === 'spaces';
    if (isDatasets) throw new Error('Datasets and Spaces aren’t models. Open the model repository instead.');
    const repo = parts.slice(0, 2).join('/');
    const mode = parts[2];
    if ((mode === 'blob' || mode === 'resolve') && parts.length > 4) {
      const rev = parts[3]; const file = parts.slice(4).map(decodeURIComponent).join('/');
      return { kind: 'file', source: 'hf', repo, name: file.split('/').pop(), url: `${HF}/${repo}/resolve/${rev}/${parts.slice(4).join('/')}`, suggestedType: guessType(file, 0) };
    }
    return { kind: 'hf-repo', repo };
  }
  const name = decodeURIComponent(u.pathname.split('/').pop() || 'model');
  return { kind: 'file', source: 'web', name, url: u.toString(), suggestedType: guessType(name, 0) };
}

module.exports = { civSearch, civModel, civVersion, civByHash, civDownloadUrl, civHeaders, cmInfo, thumb, hfSearch, hfFiles, hfModel, hfHeaders, ESSENTIALS, resolveLink, getJSON };
