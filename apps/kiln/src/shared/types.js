// Kiln — model types and their library folders. Shared by the main process and the window.
// Folder names match Stability Matrix's Data/Models layout, so an existing Stability Matrix
// models folder works as a Kiln library as-is.
(function (root) {
  const MODEL_TYPES = [
    { id: 'StableDiffusion', label: 'Checkpoints', short: 'Checkpoint', civitai: ['Checkpoint'], exts: ['safetensors', 'ckpt', 'gguf', 'sft'] },
    { id: 'DiffusionModels', label: 'Diffusion models (UNet)', short: 'UNet', civitai: ['UNet'], exts: ['safetensors', 'gguf', 'sft'] },
    { id: 'Lora', label: 'LoRA', short: 'LoRA', civitai: ['LORA', 'DoRA'], exts: ['safetensors', 'pt', 'ckpt'] },
    { id: 'LyCORIS', label: 'LyCORIS', short: 'LyCORIS', civitai: ['LoCon'], exts: ['safetensors', 'pt'] },
    { id: 'Embeddings', label: 'Embeddings', short: 'Embedding', civitai: ['TextualInversion'], exts: ['safetensors', 'pt', 'bin'] },
    { id: 'VAE', label: 'VAE', short: 'VAE', civitai: ['VAE'], exts: ['safetensors', 'pt', 'ckpt', 'sft'] },
    { id: 'TextEncoders', label: 'Text encoders', short: 'Text encoder', civitai: ['TextEncoder', 'CLIP'], exts: ['safetensors', 'gguf', 'bin', 'pt'] },
    { id: 'ControlNet', label: 'ControlNet', short: 'ControlNet', civitai: ['Controlnet'], exts: ['safetensors', 'pth', 'pt', 'bin'] },
    { id: 'T2IAdapter', label: 'T2I adapters', short: 'T2I adapter', civitai: [], exts: ['safetensors', 'pth'] },
    { id: 'IpAdapter', label: 'IP-Adapter', short: 'IP-Adapter', civitai: [], exts: ['safetensors', 'bin', 'pth'] },
    { id: 'ClipVision', label: 'CLIP vision', short: 'CLIP vision', civitai: [], exts: ['safetensors', 'bin'] },
    { id: 'ESRGAN', label: 'Upscalers', short: 'Upscaler', civitai: ['Upscaler'], exts: ['pth', 'safetensors', 'pt'] },
    { id: 'Hypernetwork', label: 'Hypernetworks', short: 'Hypernetwork', civitai: ['Hypernetwork'], exts: ['pt', 'safetensors'] },
    { id: 'AnimateDiff', label: 'Motion modules', short: 'Motion module', civitai: ['MotionModule'], exts: ['safetensors', 'ckpt', 'pth'] },
    { id: 'Ultralytics', label: 'Detailers (ADetailer)', short: 'Detector', civitai: ['Detection'], exts: ['pt', 'safetensors'] },
    { id: 'Other', label: 'Other', short: 'Other', civitai: ['Other', 'Poses', 'Wildcards', 'Workflows', 'AestheticGradient'], exts: [] }
  ];
  // Folders a library also keeps (used by packages, rarely browsed)
  const EXTRA_FOLDERS = ['ApproxVAE', 'Codeformer', 'GFPGAN', 'RealESRGAN', 'SwinIR', 'LDSR', 'DeepDanbooru', 'Sams', 'StyleModels', 'GLIGEN', 'SVD', 'PromptExpansion', 'BackgroundRemoval', 'AudioEncoders', 'ModelPatches', 'Diffusers'];

  const MODEL_EXT = /\.(safetensors|ckpt|pt|pth|bin|gguf|sft|onnx)$/i;
  const byId = Object.fromEntries(MODEL_TYPES.map(t => [t.id, t]));
  function typeForCivitai(civType) {
    const t = MODEL_TYPES.find(x => x.civitai.some(c => c.toLowerCase() === String(civType || '').toLowerCase()));
    return t ? t.id : 'Other';
  }
  // Guess a type from a file name and size when nothing else is known
  function guessType(name, bytes) {
    const n = String(name || '').toLowerCase();
    if (/lora|locon|lycoris/.test(n)) return 'Lora';
    if (/\bvae\b|vae[._-]|_vae|ae\.safetensors$/.test(n)) return 'VAE';
    if (/controlnet|control_|cn[-_]/.test(n)) return 'ControlNet';
    if (/esrgan|upscal|ultrasharp|4x|2x[-_]/.test(n)) return 'ESRGAN';
    if (/t5xxl|clip_l|clip_g|umt5|text_?encoder|qwen.*vl/.test(n)) return 'TextEncoders';
    if (/embedding|negative|easynegative|\.pt$/.test(n) && bytes && bytes < 5e6) return 'Embeddings';
    if (/ip-?adapter/.test(n)) return 'IpAdapter';
    if (/clip_vision|clipvision/.test(n)) return 'ClipVision';
    if (/flux|unet|wan|hunyuan|ltx|\.gguf$/.test(n) && bytes > 3e9) return 'DiffusionModels';
    if (bytes && bytes > 1.5e9) return 'StableDiffusion';
    if (bytes && bytes < 1.5e9 && bytes > 5e6) return 'Lora';
    return 'StableDiffusion';
  }

  const api = { MODEL_TYPES, EXTRA_FOLDERS, MODEL_EXT, byId, typeForCivitai, guessType };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KilnTypes = api;
})(typeof window !== 'undefined' ? window : globalThis);
