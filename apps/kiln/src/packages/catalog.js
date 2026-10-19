// Kiln — the packages Kiln can install and run, and how each one finds models and saves images.
// models: package-relative folder -> library folder (see shared/types.js)
// outputs: package-relative folder -> folder inside the profile's outputs
const A1111_MODELS = {
  'models/Stable-diffusion': 'StableDiffusion',
  'models/Lora': 'Lora',
  'models/LyCORIS': 'LyCORIS',
  'models/VAE': 'VAE',
  'embeddings': 'Embeddings',
  'models/hypernetworks': 'Hypernetwork',
  'models/ESRGAN': 'ESRGAN',
  'models/RealESRGAN': 'RealESRGAN',
  'models/SwinIR': 'SwinIR',
  'models/GFPGAN': 'GFPGAN',
  'models/Codeformer': 'Codeformer',
  'models/LDSR': 'LDSR',
  'models/ControlNet': 'ControlNet',
  'models/VAE-approx': 'ApproxVAE',
  'models/deepbooru': 'DeepDanbooru',
  'models/adetailer': 'Ultralytics'
};
const outs = (root) => ({
  [`${root}/txt2img-images`]: 'Text2Img',
  [`${root}/img2img-images`]: 'Img2Img',
  [`${root}/extras-images`]: 'Extras',
  [`${root}/txt2img-grids`]: 'Text2ImgGrids',
  [`${root}/img2img-grids`]: 'Img2ImgGrids',
  [`${root}/images`]: 'Saved'
});

const COMMON_A1111_OPTIONS = [
  { flag: '--api', label: 'Allow Kiln to generate with it', help: 'Turns on the API that Kiln’s Generate screen uses.', type: 'bool', default: true },
  { flag: '--xformers', label: 'xformers', help: 'Faster, lighter attention on NVIDIA cards.', type: 'bool', default: false },
  { flag: '--medvram-sdxl', label: 'Save memory with SDXL', help: 'For 8–12 GB cards. Slightly slower, avoids out-of-memory errors.', type: 'bool', default: false },
  { flag: '--medvram', label: 'Save memory (all models)', type: 'bool', default: false },
  { flag: '--lowvram', label: 'Very low memory mode', help: 'For 4 GB cards. Much slower.', type: 'bool', default: false },
  { flag: '--no-half-vae', label: 'Full-precision VAE', help: 'Fixes black or NaN images with some SDXL VAEs.', type: 'bool', default: false },
  { flag: '--listen', label: 'Reachable from other devices on your network', type: 'bool', default: false },
  { flag: '--port', label: 'Port', type: 'text', default: '', placeholder: '7860' },
  { flag: '--theme', label: 'Web UI theme', type: 'choice', choices: ['', 'dark', 'light'], default: '' },
  { flag: '--enable-insecure-extension-access', label: 'Allow installing extensions from the web UI', type: 'bool', default: false },
  { flag: '--skip-python-version-check', label: 'Skip the Python version check', type: 'bool', default: true },
  { flag: '--skip-torch-cuda-test', label: 'Skip the CUDA test', help: 'Lets it start without a supported GPU.', type: 'bool', default: false }
];

const CATALOG = [
  {
    id: 'forge-neo', mac: 'limited', name: 'Forge Neo', author: 'Haoming02', repo: 'https://github.com/Haoming02/sd-webui-forge-classic', branch: 'neo',
    blurb: 'Forge, kept current: SDXL, Flux, Qwen, Wan and Z-Image in the familiar A1111-style interface.',
    backend: 'a1111', python: '3.13', launch: 'launch.py', tags: ['Recommended', 'SDXL', 'Flux', 'Video'],
    models: {
      'models/Stable-diffusion/sd': 'StableDiffusion', 'models/Stable-diffusion/unet': 'DiffusionModels',
      'models/Lora': 'Lora', 'models/LyCORIS': 'LyCORIS', 'models/VAE': 'VAE', 'models/embeddings': 'Embeddings',
      'models/ESRGAN': 'ESRGAN', 'models/text_encoder': 'TextEncoders', 'models/VAE-approx': 'ApproxVAE',
      'models/adetailer': 'Ultralytics', 'models/deepbooru': 'DeepDanbooru', 'models/hypernetworks': 'Hypernetwork', 'models/controlnet': 'ControlNet'
    },
    outputs: { ...outs('output'), 'output/videos': 'Videos' },
    extensions: { dir: 'extensions', index: 'a1111' },
    options: [
      ...COMMON_A1111_OPTIONS.filter(o => !['--xformers', '--medvram', '--medvram-sdxl', '--lowvram'].includes(o.flag)),
      { flag: '--pin-shared-memory', label: 'Pin shared memory', help: 'Faster model swapping on NVIDIA.', type: 'bool', default: true },
      { flag: '--cuda-malloc', label: 'CUDA malloc', type: 'bool', default: true },
      { flag: '--cuda-stream', label: 'CUDA streams', type: 'bool', default: true },
      { flag: '--sage', label: 'SageAttention', help: 'Faster on RTX cards once SageAttention is installed.', type: 'bool', default: false },
      { flag: '--xformers', label: 'xformers', type: 'bool', default: false },
      { flag: '--uv', label: 'Install requirements with uv', help: 'Much faster installs and updates.', type: 'bool', default: false }
    ]
  },
  {
    id: 'comfyui', mac: 'good', name: 'ComfyUI', author: 'comfyanonymous', repo: 'https://github.com/comfyanonymous/ComfyUI', branch: 'master',
    blurb: 'Node-based workflows for every model family. The most flexible engine, and the newest models land here first.',
    backend: 'comfy', python: '3.12', launch: 'main.py', torch: 'kiln', requirements: 'requirements.txt', tags: ['Workflows', 'Flux', 'Video'],
    comfy: true, extensions: { dir: 'custom_nodes', index: 'comfy', requirements: true },
    options: [
      { flag: '--preview-method', label: 'Live previews', type: 'choice', choices: ['auto', 'latent2rgb', 'taesd', 'none'], default: 'auto' },
      { flag: '--lowvram', label: 'Low memory mode', type: 'bool', default: false },
      { flag: '--highvram', label: 'Keep models in GPU memory', type: 'bool', default: false },
      { flag: '--use-sage-attention', label: 'SageAttention', type: 'bool', default: false },
      { flag: '--fast', label: 'Fast mode (experimental optimizations)', type: 'bool', default: false },
      { flag: '--cpu', label: 'Run on CPU only', type: 'bool', default: false },
      { flag: '--listen', label: 'Reachable from other devices on your network', type: 'bool', default: false },
      { flag: '--port', label: 'Port', type: 'text', default: '', placeholder: '8188' }
    ]
  },
  {
    id: 'forge', mac: 'limited', name: 'Stable Diffusion WebUI Forge', author: 'lllyasviel', repo: 'https://github.com/lllyasviel/stable-diffusion-webui-forge', branch: 'main',
    blurb: 'The original Forge: faster, lighter A1111 with Flux support.', backend: 'a1111', python: '3.10', launch: 'launch.py', tags: ['SDXL', 'Flux'],
    models: { ...A1111_MODELS, 'models/text_encoder': 'TextEncoders' }, outputs: outs('outputs'),
    extensions: { dir: 'extensions', index: 'a1111' }, options: COMMON_A1111_OPTIONS
  },
  {
    id: 'reforge', mac: 'limited', name: 'reForge', author: 'Panchovix', repo: 'https://github.com/Panchovix/stable-diffusion-webui-reForge', branch: 'main',
    blurb: 'Forge with A1111 extension compatibility kept intact.', backend: 'a1111', python: '3.10', launch: 'launch.py', tags: ['SDXL'],
    models: A1111_MODELS, outputs: outs('outputs'), extensions: { dir: 'extensions', index: 'a1111' }, options: COMMON_A1111_OPTIONS
  },
  {
    id: 'a1111', mac: 'ok', name: 'Stable Diffusion WebUI (A1111)', author: 'AUTOMATIC1111', repo: 'https://github.com/AUTOMATIC1111/stable-diffusion-webui', branch: 'master',
    blurb: 'The classic web UI with the largest extension library.', backend: 'a1111', python: '3.10', launch: 'launch.py', tags: ['Classic', 'SD 1.5', 'SDXL'],
    models: A1111_MODELS, outputs: outs('outputs'), extensions: { dir: 'extensions', index: 'a1111' }, options: COMMON_A1111_OPTIONS
  },
  {
    id: 'sdnext', mac: 'good', name: 'SD.Next', author: 'vladmandic', repo: 'https://github.com/vladmandic/sdnext', branch: 'master',
    blurb: 'All-in-one UI with broad model and hardware support, including AMD and Intel.', backend: 'a1111', python: '3.12', launch: 'launch.py', tags: ['AMD', 'Intel', 'Many models'],
    models: { 'models/Stable-diffusion': 'StableDiffusion', 'models/Lora': 'Lora', 'models/VAE': 'VAE', 'models/embeddings': 'Embeddings', 'models/ESRGAN': 'ESRGAN', 'models/UNET': 'DiffusionModels', 'models/control': 'ControlNet' },
    outputs: { 'outputs/text': 'Text2Img', 'outputs/image': 'Img2Img', 'outputs/extras': 'Extras', 'outputs/save': 'Saved' },
    extensions: { dir: 'extensions', index: 'a1111' },
    options: [
      { flag: '--use-cuda', label: 'NVIDIA (CUDA)', type: 'bool', default: false },
      { flag: '--use-rocm', label: 'AMD (ROCm)', type: 'bool', default: false },
      { flag: '--use-directml', label: 'DirectML (Windows AMD/Intel)', type: 'bool', default: false },
      { flag: '--use-ipex', label: 'Intel Arc (IPEX)', type: 'bool', default: false },
      { flag: '--listen', label: 'Reachable from other devices on your network', type: 'bool', default: false },
      { flag: '--port', label: 'Port', type: 'text', default: '', placeholder: '7860' },
      { flag: '--debug', label: 'Verbose console', type: 'bool', default: false }
    ]
  },
  {
    id: 'fooocus', mac: 'ok', name: 'Fooocus', author: 'lllyasviel', repo: 'https://github.com/lllyasviel/Fooocus', branch: 'main',
    blurb: 'Type a prompt and go: Midjourney-style simplicity on SDXL.', backend: null, python: '3.10', launch: 'entry_with_update.py', tags: ['Simple', 'SDXL'],
    fooocus: true,
    options: [
      { flag: '--preset', label: 'Preset', type: 'choice', choices: ['', 'default', 'anime', 'realistic', 'lightning'], default: '' },
      { flag: '--always-low-vram', label: 'Low memory mode', type: 'bool', default: false },
      { flag: '--listen', label: 'Reachable from other devices on your network', type: 'bool', default: false },
      { flag: '--port', label: 'Port', type: 'text', default: '', placeholder: '7865' }
    ]
  }
];

const byId = Object.fromEntries(CATALOG.map(c => [c.id, c]));
module.exports = { CATALOG, byId };
