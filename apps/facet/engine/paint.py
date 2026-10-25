"""Facet: Hunyuan3D Paint — a diffusion model that paints every side of a mesh, not just the side in the picture.

Hunyuan3D-2's texture pipeline (in the hy3dgen package) first removes baked-in lighting from the picture, then
generates six consistent views of the object guided by the mesh's normals and positions, and bakes them into a UV
texture. Facet runs it with three changes:
  * the compiled `custom_rasterizer` is replaced by `torch_raster` (pure PyTorch, nothing to compile),
  * it runs on whatever device Facet picked, not only CUDA,
  * the number of diffusion steps and the bake resolution are adjustable (Fast / Standard).
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STEPS = {"fast": (15, 25), "standard": (30, 50)}          # (multi-view steps, de-lighting steps)
SIZES = {"fast": 1024, "standard": 2048}                   # render and texture resolution


class _StepsProxy:
    """Wraps a diffusers pipeline so its hard-coded step count can be changed."""

    def __init__(self, pipe, steps):
        self._pipe, self._steps = pipe, steps

    def __getattr__(self, name):
        return getattr(self._pipe, name)

    def __call__(self, *a, **k):
        k["num_inference_steps"] = self._steps
        return self._pipe(*a, **k)


def load(models_root, device, quality="standard", progress=None):
    import torch
    sys.path.insert(0, HERE)
    import torch_raster
    sys.modules["custom_rasterizer"] = torch_raster

    from hy3dgen.texgen import pipelines as P
    from hy3dgen.texgen.differentiable_renderer import mesh_render as MR

    size = SIZES.get(quality, 2048)
    mv_steps, dl_steps = STEPS.get(quality, STEPS["standard"])

    cfg_init = P.Hunyuan3DTexGenConfig.__init__

    def config_init(self, *a, **k):
        cfg_init(self, *a, **k)
        self.device = device
        self.render_size = size
        self.texture_size = size
    P.Hunyuan3DTexGenConfig.__init__ = config_init

    real_render = MR.MeshRender
    P.MeshRender = lambda **kw: real_render(device=device, **kw)

    # the paint networks were built for float16 (parts of the UNet cast to half explicitly), so keep it everywhere;
    # on a CPU that is slow, but painting there is a last resort anyway
    custom = None if device == "cuda" else _device_pipeline(models_root, device)
    _patch_from_pretrained(None, custom)
    _prefer_safetensors(os.path.join(models_root, "tencent", "Hunyuan3D-2", "hunyuan3d-paint-v2-0-turbo", "unet", "modules.py"))
    progress and progress("Loading Hunyuan3D Paint")
    pipe = P.Hunyuan3DPaintPipeline.from_pretrained(os.path.join(models_root, "tencent", "Hunyuan3D-2"), subfolder="hunyuan3d-paint-v2-0-turbo")
    mv = pipe.models["multiview_model"]
    mv.pipeline = _StepsProxy(mv.pipeline, mv_steps)
    dl = pipe.models["delight_model"]
    dl.pipeline = _StepsProxy(dl.pipeline, dl_steps)
    if device == "cuda":
        try:
            free, total = torch.cuda.mem_get_info()
            if total < 14 * 1024 ** 3:
                # under ~14 GB, keep only the active network on the card
                pipe.enable_model_cpu_offload(device="cuda")
        except Exception:
            pass
    return pipe


def _prefer_safetensors(modules_py):
    """The paint UNet's loader (shipped with the weights) reads the 7 GB float32 .bin. Facet downloads the 3.7 GB
    half-precision .safetensors instead, so point the loader at it. The safetensors file also carries image-adapter
    weights this loader does not use, so extra tensors are allowed; a missing tensor still fails."""
    try:
        src = open(modules_py, encoding="utf-8").read()
    except OSError:
        return
    if "# Facet v2" in src:
        return
    edits = [
        ("unet_ckpt_path = os.path.join(pretrained_model_name_or_path, 'diffusion_pytorch_model.bin')",
         "unet_ckpt_path = os.path.join(pretrained_model_name_or_path, 'diffusion_pytorch_model.bin')\n"
         "        _st = os.path.join(pretrained_model_name_or_path, 'diffusion_pytorch_model.safetensors')  # Facet v2\n"
         "        if os.path.exists(_st):\n"
         "            unet_ckpt_path = _st"),
        ("unet_ckpt = torch.load(unet_ckpt_path, map_location='cpu', weights_only=True)",
         "unet_ckpt = __import__('safetensors.torch', fromlist=['load_file']).load_file(unet_ckpt_path) if unet_ckpt_path.endswith('.safetensors') "
         "else torch.load(unet_ckpt_path, map_location='cpu', weights_only=True)"),
        ("unet.load_state_dict(unet_ckpt, strict=True)",
         "_missing, _extra = unet.load_state_dict(unet_ckpt, strict=False)\n"
         "        if _missing:\n"
         "            raise RuntimeError('Paint weights are missing ' + str(len(_missing)) + ' tensors')"),
    ]
    for old, new in edits:
        if old not in src:
            return   # an unexpected version of the file: leave it alone
        src = src.replace(old, new, 1)
    with open(modules_py, "w", encoding="utf-8") as f:
        f.write(src)


def _device_pipeline(models_root, device):
    """hy3dgen's multi-view pipeline hard-codes 'cuda' in a few places. For Metal or the CPU, use a copy with the
    device swapped (kept in the models folder, rebuilt when hy3dgen changes)."""
    import hashlib
    import shutil
    import hy3dgen.texgen as tg
    src = os.path.join(os.path.dirname(tg.__file__), "hunyuanpaint")
    files = []
    for root, _, names in os.walk(src):
        for n in names:
            if n.endswith(".py"):
                files.append(os.path.join(root, n))
    digest = hashlib.sha1("".join(open(f, encoding="utf-8").read() for f in sorted(files)).encode()).hexdigest()[:10]
    dst = os.path.join(models_root, ".facet", f"hunyuanpaint-{device}-{digest}")
    if not os.path.exists(os.path.join(dst, "pipeline.py")):
        shutil.rmtree(dst, ignore_errors=True)
        for f in files:
            rel = os.path.relpath(f, src)
            text = open(f, encoding="utf-8").read()
            text = text.replace(".to('cuda')", f".to('{device}')").replace('.to("cuda")', f'.to("{device}")').replace("device='cuda'", f"device='{device}'")
            os.makedirs(os.path.dirname(os.path.join(dst, rel)), exist_ok=True)
            with open(os.path.join(dst, rel), "w", encoding="utf-8") as out:
                out.write(text)
    return dst


def _patch_from_pretrained(dtype=None, custom=None):
    """The paint pipeline loads its multi-view network as diffusers custom code that ships inside the installed
    hy3dgen package (not downloaded), so it is trusted. On the CPU it also asks for float32 instead of float16."""
    import diffusers
    base = diffusers.DiffusionPipeline
    if not getattr(base, "_facet_orig", None):
        base._facet_orig = base.from_pretrained.__func__
    orig = base._facet_orig

    def patched(klass, *a, **k):
        if k.get("custom_pipeline"):
            k["trust_remote_code"] = True
            if custom and os.path.basename(os.path.normpath(str(k["custom_pipeline"]))) == "hunyuanpaint":
                k["custom_pipeline"] = custom
        if dtype is not None:
            k["torch_dtype"] = dtype
        return orig(klass, *a, **k)
    base.from_pretrained = classmethod(patched)


def paint(pipe, mesh, image):
    """mesh: trimesh facing +z (Hunyuan's own convention). image: RGBA cut-out. Returns a textured trimesh."""
    import trimesh
    m = mesh.copy()
    m.visual = trimesh.visual.ColorVisuals(m)
    out = pipe(m, image)
    return out
