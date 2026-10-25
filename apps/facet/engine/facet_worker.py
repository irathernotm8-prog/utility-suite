#!/usr/bin/env python3
"""Facet engine worker.

Runs every model on this computer. Facet's main process starts it inside Facet's own Python environment and talks
to it over stdin/stdout, one JSON object per line. Anything the libraries print goes to stderr, which Facet shows
as the engine log, so the protocol channel never gets polluted.

Requests:   {"id": "...", "cmd": "hello" | "imagine" | "cutout" | "shape" | "export" | "unload", "args": {...}}
Replies:    {"id": "...", "type": "progress", "stage": "...", "pct": 0..1, "msg": "..."}
            {"id": "...", "type": "result", "data": {...}}
            {"id": "...", "type": "error", "error": "...", "detail": "..."}
"""
import json
import math
import os
import sys
import threading
import time
import traceback

# ── protocol channel: keep a private copy of stdout, then send fd 1 to stderr ─────────────────────────────────────
_proto = os.fdopen(os.dup(1), "w", buffering=1, encoding="utf-8")
os.dup2(2, 1)
sys.stdout = sys.stderr
_lock = threading.Lock()


def send(obj):
    with _lock:
        _proto.write(json.dumps(obj) + "\n")
        _proto.flush()


HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # the bundled TripoSR code (tsr/)

MODELS = os.environ.get("FACET_MODELS") or os.path.join(HERE, "models")
os.environ.setdefault("HY3DGEN_MODELS", MODELS)
os.environ.setdefault("U2NET_HOME", os.path.join(MODELS, "rembg"))
os.environ.setdefault("HF_HUB_OFFLINE", "1")          # everything is downloaded up front by Facet
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")  # ops Metal lacks quietly run on the CPU

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

torch = None  # imported lazily so "hello" can answer fast even on slow disks


def _torch():
    global torch
    if torch is None:
        import torch as _t
        torch = _t
        try:
            torch.set_num_threads(max(1, os.cpu_count() or 1))
        except Exception:
            pass
    return torch


# ── device ────────────────────────────────────────────────────────────────────────────────────────────────────
def pick_device():
    t = _torch()
    want = (os.environ.get("FACET_DEVICE") or "auto").lower()
    has_cuda = t.cuda.is_available()
    has_mps = getattr(t.backends, "mps", None) is not None and t.backends.mps.is_available()
    if want == "cuda" and has_cuda:
        return "cuda"
    if want == "mps" and has_mps:
        return "mps"
    if want == "cpu":
        return "cpu"
    return "cuda" if has_cuda else "mps" if has_mps else "cpu"


DEVICE = None


def device():
    global DEVICE
    if DEVICE is None:
        DEVICE = pick_device()
    return DEVICE


def half_ok():
    return device() in ("cuda", "mps")


def cpu_dtype():
    """float32 is fastest on CPUs, bfloat16 halves memory. Use float32 when there is room for it."""
    t = _torch()
    ram = int(os.environ.get("FACET_RAM_MB") or 0)
    return t.float32 if ram >= 20000 else t.bfloat16


def empty_cache():
    t = _torch()
    import gc
    gc.collect()
    try:
        if device() == "cuda":
            t.cuda.empty_cache()
        elif device() == "mps":
            t.mps.empty_cache()
    except Exception:
        pass


# ── model cache ───────────────────────────────────────────────────────────────────────────────────────────────
LOADED = {}   # key -> object
KEEP = os.environ.get("FACET_KEEP_LOADED", "1") == "1"


def drop(prefix=None):
    for k in list(LOADED):
        if prefix is None or k.startswith(prefix):
            LOADED.pop(k, None)
    empty_cache()


def make_room(key):
    """At most one big model in memory at a time unless the machine has room to spare."""
    if key in LOADED:
        return
    if not KEEP:
        drop()
        return
    big = [k for k in LOADED if not k.startswith("rembg")]
    if big:
        drop_keys = big
        t = _torch()
        if device() == "cuda":
            try:
                free, total = t.cuda.mem_get_info()
                if total >= 20 * 1024 ** 3 and len(big) < 2:
                    drop_keys = []
            except Exception:
                pass
        for k in drop_keys:
            LOADED.pop(k, None)
        empty_cache()


def model_dir(repo):
    return os.path.join(MODELS, *repo.split("/"))


# ── background removal ────────────────────────────────────────────────────────────────────────────────────────
def rembg_session():
    if "rembg" not in LOADED:
        import rembg
        name = "isnet-general-use" if os.path.exists(os.path.join(os.environ["U2NET_HOME"], "isnet-general-use.onnx")) else "u2net"
        providers = None
        try:
            import onnxruntime as ort
            avail = ort.get_available_providers()
            pref = [p for p in ("CUDAExecutionProvider", "CoreMLExecutionProvider", "CPUExecutionProvider") if p in avail]
            providers = pref or None
        except Exception:
            pass
        LOADED["rembg"] = rembg.new_session(name, providers=providers) if providers else rembg.new_session(name)
    return LOADED["rembg"]


def has_transparency(img):
    if img.mode != "RGBA":
        return False
    lo, _ = img.getchannel("A").getextrema()
    return lo < 250


def cut_out(img, force=False):
    """Returns an RGBA image with the background removed (unless it already has one)."""
    img = img.convert("RGBA") if img.mode != "RGBA" else img
    if has_transparency(img) and not force:
        return img
    import rembg
    out = rembg.remove(img.convert("RGB"), session=rembg_session())
    return out.convert("RGBA")


def frame(img, ratio=0.85, size=1024):
    """Crops to the object, pads to a square and leaves a margin, like every image-to-3D model expects."""
    a = np.array(img.convert("RGBA"))
    ys, xs = np.where(a[..., 3] > 8)
    if not len(ys):
        raise RuntimeError("Nothing left after removing the background. Try an image with a clearer subject, or turn off Remove background.")
    fg = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    side = max(fg.shape[0], fg.shape[1])
    canvas = int(side / ratio)
    out = np.zeros((canvas, canvas, 4), dtype=np.uint8)
    y0 = (canvas - fg.shape[0]) // 2
    x0 = (canvas - fg.shape[1]) // 2
    out[y0:y0 + fg.shape[0], x0:x0 + fg.shape[1]] = fg
    return Image.fromarray(out, "RGBA").resize((size, size), Image.LANCZOS)


def load_input(path, remove_bg=True):
    img = Image.open(path)
    img.load()
    if img.mode in ("P", "LA", "L", "CMYK", "I;16", "I"):
        img = img.convert("RGBA")
    if remove_bg:
        img = cut_out(img)
    elif img.mode != "RGBA":
        img = img.convert("RGBA")
    return frame(img)


# ── text → image (concept art for prompts) ────────────────────────────────────────────────────────────────────
IMAGE_MODELS = {
    "sd-turbo": {"repo": "stabilityai/sd-turbo", "size": 512, "steps": 2},
    "sdxl-turbo": {"repo": "stabilityai/sdxl-turbo", "size": 512, "steps": 2},
}


def image_pipe(mid):
    key = "img:" + mid
    if key not in LOADED:
        make_room(key)
        t = _torch()
        from diffusers import AutoPipelineForText2Image
        spec = IMAGE_MODELS[mid]
        # SD-Turbo's VAE overflows in half precision on Metal, so it runs in full precision there
        if device() == "cuda" or (device() == "mps" and mid == "sdxl-turbo"):
            dtype = t.float16
        elif device() == "cpu":
            dtype = cpu_dtype()
        else:
            dtype = t.float32
        pipe = AutoPipelineForText2Image.from_pretrained(model_dir(spec["repo"]), torch_dtype=dtype, variant="fp16", use_safetensors=True, local_files_only=True)
        pipe.to(device())
        try:
            pipe.set_progress_bar_config(disable=True)
        except Exception:
            pass
        if device() == "mps":
            try:
                pipe.enable_attention_slicing()
            except Exception:
                pass
        LOADED[key] = pipe
    return LOADED[key]


def cropped(img):
    """True when the object runs off the top or bottom of a sketch (feet or head cut off), which makes poor models."""
    try:
        if not os.path.exists(os.path.join(os.environ["U2NET_HOME"], "isnet-general-use.onnx")):
            return False
        cut = cut_out(img)
        al = np.asarray(cut.getchannel("A")) > 127
        edge = max(2, al.shape[0] // 100)
        return bool(al[-edge:].mean() > 0.02 or al[:edge].mean() > 0.02)
    except Exception:
        return False


def cmd_imagine(rid, a):
    t = _torch()
    mid = a.get("model") or "sd-turbo"
    if mid not in IMAGE_MODELS:
        raise RuntimeError("Unknown image model " + mid)
    n = max(1, min(8, int(a.get("count", 4))))
    seed = int(a.get("seed", -1))
    if seed < 0:
        seed = int.from_bytes(os.urandom(4), "little") & 0x7FFFFFFF
    out_dir = a["outDir"]
    os.makedirs(out_dir, exist_ok=True)
    send({"id": rid, "type": "progress", "stage": "load", "pct": 0.02, "msg": "Loading the image model"})
    pipe = image_pipe(mid)
    spec = IMAGE_MODELS[mid]
    steps = int(a.get("steps") or spec["steps"])
    size = int(a.get("size") or spec["size"])
    images = []
    for i in range(n):
        send({"id": rid, "type": "progress", "stage": "imagine", "pct": 0.05 + 0.9 * i / n, "msg": f"Sketching idea {i + 1} of {n}"})
        g = t.Generator("cpu").manual_seed(seed + i)
        img = pipe(prompt=a["prompt"], negative_prompt=a.get("negative") or None, num_inference_steps=steps,
                   guidance_scale=0.0, width=size, height=size, generator=g).images[0]
        p = os.path.join(out_dir, f"idea-{seed + i}.png")
        img.save(p)
        images.append({"path": p, "seed": seed + i, "cropped": cropped(img)})
        send({"id": rid, "type": "progress", "stage": "imagine", "pct": 0.05 + 0.9 * (i + 1) / n, "msg": f"Sketched {i + 1} of {n}", "image": p})
    if not KEEP:
        drop("img:")
    return {"images": images, "seed": seed}


# ── image → 3D: TripoSR ───────────────────────────────────────────────────────────────────────────────────────
def triposr():
    key = "shape:triposr"
    if key not in LOADED:
        make_room(key)
        from tsr.system import TSR
        m = TSR.from_pretrained(model_dir("stabilityai/TripoSR"), config_name="config.yaml", weight_name="model.ckpt")
        m.renderer.set_chunk_size(8192 if device() != "cpu" else 32768)
        m.to(device())
        m.eval()
        LOADED[key] = m
    return LOADED[key]


def to_view_space(mesh):
    """TripoSR is z-up and faces +x; glTF and every viewer expect y-up facing +z."""
    import trimesh
    mesh.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0]))
    mesh.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [0, 1, 0]))
    return mesh


def run_triposr(rid, img, resolution=256, base=0.0, span=1.0):
    t = _torch()
    send({"id": rid, "type": "progress", "stage": "load", "pct": base + span * 0.05, "msg": "Loading TripoSR"})
    model = triposr()
    a = np.array(img).astype(np.float32) / 255.0
    rgb = a[:, :, :3] * a[:, :, 3:4] + (1 - a[:, :, 3:4]) * 0.5
    cond = Image.fromarray((rgb * 255.0).astype(np.uint8))
    send({"id": rid, "type": "progress", "stage": "shape", "pct": base + span * 0.2, "msg": "Reading the shape from the image"})
    with t.no_grad():
        codes = model([cond], device=device())
        send({"id": rid, "type": "progress", "stage": "mesh", "pct": base + span * 0.55, "msg": f"Building the surface at {resolution}³"})
        mesh = model.extract_mesh(codes, True, resolution=int(resolution))[0]
    return to_view_space(mesh)


# ── image → 3D: Hunyuan3D-2 family ────────────────────────────────────────────────────────────────────────────
SHAPE_MODELS = {
    "hy3d-mini-turbo": {"repo": "tencent/Hunyuan3D-2mini", "sub": "hunyuan3d-dit-v2-mini-turbo", "turbo": True, "steps": 5, "octree": 380},
    "hy3d-mini": {"repo": "tencent/Hunyuan3D-2mini", "sub": "hunyuan3d-dit-v2-mini", "turbo": False, "steps": 30, "octree": 380},
    "hy3d-turbo": {"repo": "tencent/Hunyuan3D-2", "sub": "hunyuan3d-dit-v2-0-turbo", "turbo": True, "steps": 5, "octree": 380},
    "hy3d-mv-turbo": {"repo": "tencent/Hunyuan3D-2mv", "sub": "hunyuan3d-dit-v2-mv-turbo", "turbo": True, "steps": 5, "octree": 380, "multiview": True},
}


def _stub_pymeshlab():
    """hy3dgen imports pymeshlab for optional clean-up helpers Facet does not use. If it will not load, stand in."""
    try:
        import pymeshlab  # noqa: F401
    except Exception:
        import types
        sys.modules["pymeshlab"] = types.ModuleType("pymeshlab")


def _patch_surface_extractor():
    """Marching cubes runs in NumPy, which has no half or bfloat16 types: hand it float32."""
    from hy3dgen.shapegen.models.autoencoders import surface_extractors as se
    if getattr(se.MCSurfaceExtractor, "_facet", False):
        return
    orig = se.MCSurfaceExtractor.run

    def run(self, grid_logit, *a, **k):
        return orig(self, grid_logit.float(), *a, **k)
    se.MCSurfaceExtractor.run = run
    se.MCSurfaceExtractor._facet = True


def hunyuan(mid):
    key = "shape:" + mid
    if key not in LOADED:
        make_room(key)
        t = _torch()
        _stub_pymeshlab()
        from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline
        _patch_surface_extractor()
        spec = SHAPE_MODELS[mid]
        dtype = t.float16 if half_ok() else cpu_dtype()
        # build the network straight in its final precision, so loading never needs a full float32 copy in memory
        old = t.get_default_dtype()
        try:
            t.set_default_dtype(dtype)
            pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(spec["repo"], subfolder=spec["sub"], use_safetensors=True, variant="fp16", device=device(), dtype=dtype)
        finally:
            t.set_default_dtype(old)
        if spec["turbo"]:
            pipe.enable_flashvdm(mc_algo="mc")
            pipe.to(device(), dtype)   # the turbo decoder loads in fp16; match the pipeline
        LOADED[key] = pipe
    return LOADED[key]


def run_hunyuan(rid, mid, images, steps=None, octree=None, seed=0, guidance=None, base=0.0, span=1.0):
    t = _torch()
    spec = SHAPE_MODELS[mid]
    send({"id": rid, "type": "progress", "stage": "load", "pct": base + span * 0.04, "msg": "Loading Hunyuan3D"})
    pipe = hunyuan(mid)
    steps = int(steps or spec["steps"])
    octree = int(octree or spec["octree"])

    def cb(i, _t, _o):
        send({"id": rid, "type": "progress", "stage": "shape", "pct": base + span * (0.12 + 0.6 * (i + 1) / steps), "msg": f"Shaping, step {i + 1} of {steps}"})

    send({"id": rid, "type": "progress", "stage": "shape", "pct": base + span * 0.1, "msg": "Reading the image"})
    image = images if spec.get("multiview") else images["front"]
    kw = dict(image=image, num_inference_steps=steps, octree_resolution=octree, num_chunks=20000 if device() != "cpu" else 60000,
              generator=t.manual_seed(int(seed)), output_type="trimesh", callback=cb, callback_steps=1, enable_pbar=False)
    if guidance is not None:
        kw["guidance_scale"] = float(guidance)
    with t.inference_mode():
        mesh = pipe(**kw)[0]
        if mesh is None or not len(getattr(mesh, "faces", [])):
            raise RuntimeError("No surface came out of that picture. Try a clearer picture of a single object, or another seed.")
        send({"id": rid, "type": "progress", "stage": "mesh", "pct": base + span * 0.85, "msg": "Surface built"})
    return mesh


# ── mesh clean-up ─────────────────────────────────────────────────────────────────────────────────────────────
def vertex_colors(mesh):
    try:
        if mesh.visual.kind == "vertex":
            c = np.asarray(mesh.visual.vertex_colors)
            if len(c) == len(mesh.vertices):
                return c
    except Exception:
        pass
    return None


TEXTURED_MAX_FACES = 150000


def remove_floaters(mesh, keep_ratio=0.02):
    import trimesh
    if len(mesh.faces) < 10:
        return mesh
    labels = trimesh.graph.connected_component_labels(mesh.face_adjacency, node_count=len(mesh.faces))
    counts = np.bincount(labels)
    if len(counts) <= 1:
        return mesh
    keep = counts >= max(counts.max() * keep_ratio, 32)
    mask = keep[labels]
    mesh.update_faces(mask)
    mesh.remove_unreferenced_vertices()
    return mesh


def transfer_colors(dst, src_vertices, src_colors):
    from scipy.spatial import cKDTree
    _, idx = cKDTree(src_vertices).query(np.asarray(dst.vertices), k=1)
    import trimesh
    dst.visual = trimesh.visual.ColorVisuals(dst, vertex_colors=np.asarray(src_colors)[idx])
    return dst


def simplify(mesh, faces):
    faces = int(faces or 0)
    if faces <= 0 or len(mesh.faces) <= faces:
        return mesh
    cols = vertex_colors(mesh)
    src_v = np.asarray(mesh.vertices).copy()
    try:
        out = mesh.simplify_quadric_decimation(face_count=faces)
    except TypeError:
        out = mesh.simplify_quadric_decimation(faces)
    if cols is not None:
        out = transfer_colors(out, src_v, cols)
    return out


def normalize(mesh):
    """Centers the model on the floor (y = 0) and scales its largest side to 1."""
    b = mesh.bounds
    size = float((b[1] - b[0]).max()) or 1.0
    center = (b[0] + b[1]) / 2
    mesh.apply_translation([-center[0], -b[0][1], -center[2]])
    mesh.apply_scale(1.0 / size)
    return mesh


def has_texture(mesh):
    return getattr(mesh.visual, "kind", None) == "texture" and getattr(mesh.visual, "uv", None) is not None


def stats(mesh):
    textured = has_texture(mesh)
    return {"vertices": int(len(mesh.vertices)), "faces": int(len(mesh.faces)), "colors": textured or vertex_colors(mesh) is not None,
            "texture": textured, "watertight": bool(mesh.is_watertight)}


def srgb_to_linear(c):
    c = np.asarray(c).astype(np.float64)
    rgb = c[:, :3] / 255.0
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    out = c.copy()
    out[:, :3] = np.round(lin * 255.0)
    return out.astype(np.uint8)


def linear_to_srgb(c):
    c = np.asarray(c).astype(np.float64)
    lin = c[:, :3] / 255.0
    rgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    out = c.copy()
    out[:, :3] = np.round(np.clip(rgb, 0, 1) * 255.0)
    return out.astype(np.uint8)


def load_mesh(path):
    """Loads any supported file as one mesh with sRGB vertex colours."""
    import trimesh
    m = trimesh.load(path, force="mesh")
    if path.lower().endswith((".glb", ".gltf")):
        c = vertex_colors(m)
        if c is not None:
            m.visual = trimesh.visual.ColorVisuals(m, vertex_colors=linear_to_srgb(c))
    return m


def export_mesh(mesh, path, fmt=None, height_mm=None):
    import trimesh
    fmt = (fmt or os.path.splitext(path)[1][1:]).lower()
    m = mesh.copy()
    if fmt == "stl" and height_mm:
        # printers think in millimetres; the model's height becomes exactly height_mm
        h = float(m.bounds[1][1] - m.bounds[0][1]) or 1.0
        m.apply_scale(float(height_mm) / h)
        # most slicers expect z-up
        m.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0]))
        m.apply_translation([0, 0, -m.bounds[0][2]])
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    if fmt == "glb":
        # glTF stores vertex colours as linear light; everything else (and Facet internally) uses sRGB
        c = vertex_colors(m)
        if c is not None:
            m.visual = trimesh.visual.ColorVisuals(m, vertex_colors=srgb_to_linear(c))
        data = trimesh.exchange.gltf.export_glb(trimesh.Scene(m), include_normals=True)
        with open(path, "wb") as f:
            f.write(data)
    elif fmt == "obj":
        if has_texture(m):
            base = os.path.splitext(os.path.basename(path))[0]
            text, files = trimesh.exchange.obj.export_obj(m, include_texture=True, return_texture=True, mtl_name=base + ".mtl")
            for name, data in files.items():
                with open(os.path.join(os.path.dirname(os.path.abspath(path)), name), "wb") as f:
                    f.write(data)
        else:
            text = trimesh.exchange.obj.export_obj(m, include_color=vertex_colors(m) is not None, include_texture=False)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
    else:
        if fmt == "ply" and has_texture(m):
            m.visual = m.visual.to_color()
        m.export(path, file_type=fmt)
    return path


# ── commands ──────────────────────────────────────────────────────────────────────────────────────────────────
def cmd_hello(rid, a):
    t = _torch()
    info = {"python": sys.version.split()[0], "torch": t.__version__, "device": device(), "cpus": os.cpu_count(), "models": MODELS}
    if device() == "cuda":
        p = t.cuda.get_device_properties(0)
        info.update(gpu=p.name, vramMB=int(p.total_memory / 1048576))
    elif device() == "mps":
        info.update(gpu="Apple GPU (Metal)")
    for mod in ("diffusers", "transformers", "trimesh", "rembg", "hy3dgen"):
        try:
            m = __import__(mod)
            info[mod] = getattr(m, "__version__", "yes")
        except Exception:
            info[mod] = None
    return info


def cmd_cutout(rid, a):
    send({"id": rid, "type": "progress", "stage": "cutout", "pct": 0.2, "msg": "Removing the background"})
    img = load_input(a["image"], remove_bg=a.get("removeBg", True))
    out = a.get("out") or os.path.splitext(a["image"])[0] + "-cutout.png"
    img.save(out)
    return {"path": out}


def cmd_shape(rid, a):
    t0 = time.time()
    engine = a.get("engine") or "triposr"
    out_dir = a["outDir"]
    os.makedirs(out_dir, exist_ok=True)
    remove_bg = a.get("removeBg", True)
    views = a.get("views") or {"front": a["image"]}
    if "front" not in views:
        raise RuntimeError("A front view is needed.")

    send({"id": rid, "type": "progress", "stage": "cutout", "pct": 0.02, "msg": "Preparing the image"})
    prepared = {}
    for name, p in views.items():
        if not p:
            continue
        img = load_input(p, remove_bg=remove_bg)
        prepared[name] = img
        img.save(os.path.join(out_dir, f"input-{name}.png" if name != "front" else "input.png"))
    send({"id": rid, "type": "progress", "stage": "cutout", "pct": 0.06, "msg": "Image ready", "image": os.path.join(out_dir, "input.png")})

    seed = int(a.get("seed", -1))
    if seed < 0:
        seed = int.from_bytes(os.urandom(4), "little") & 0x7FFFFFFF
    _torch().manual_seed(seed)

    color_from = None
    if engine == "triposr":
        mesh = run_triposr(rid, prepared["front"], resolution=int(a.get("resolution") or 256), base=0.06, span=0.8)
    elif engine in SHAPE_MODELS:
        want_color = bool(a.get("colorize")) and os.path.exists(os.path.join(model_dir("stabilityai/TripoSR"), "model.ckpt"))
        span = 0.62 if want_color else 0.8
        mesh = run_hunyuan(rid, engine, prepared, steps=a.get("steps"), octree=a.get("octree"), seed=seed, guidance=a.get("guidance"), base=0.06, span=span)
        if want_color:
            # Colour comes from TripoSR's read of the same image, laid onto Hunyuan's sharper surface.
            if not KEEP or device() != "cuda":
                LOADED.pop("shape:" + engine, None)
                empty_cache()
            ref = run_triposr(rid, prepared["front"], resolution=192, base=0.68, span=0.18)
            color_from = ref
    else:
        raise RuntimeError("Unknown engine " + engine)

    send({"id": rid, "type": "progress", "stage": "clean", "pct": 0.80, "msg": "Cleaning up the mesh"})
    import texture as tex
    mesh = remove_floaters(mesh)
    mesh = normalize(mesh)
    # turn the model so the side in the picture faces forward (+z), as game engines expect
    mesh, front_key, front_iou = tex.face_front(mesh, prepared["front"])
    mesh = normalize(mesh)
    mode = a.get("texture") or "picture"
    fallback = None
    if vertex_colors(mesh) is not None:
        fallback = (np.asarray(mesh.vertices).copy(), vertex_colors(mesh).copy())
    if color_from is not None:
        ref = normalize(remove_floaters(color_from))
        ref, _, _ = tex.face_front(ref, prepared["front"])
        ref = normalize(ref)
        # line the two up box-to-box before borrowing colour
        b, rb = mesh.bounds, ref.bounds
        scale = (b[1] - b[0]) / np.maximum(rb[1] - rb[0], 1e-6)
        rv = (np.asarray(ref.vertices) - rb[0]) * scale + b[0]
        fallback = (rv, vertex_colors(ref))
        if mode == "vertex":
            mesh = transfer_colors(mesh, rv, vertex_colors(ref))

    budget = int(a.get("faces") or 0)
    if mode == "picture":
        # a texture carries the detail, so the surface can stay lighter; very dense meshes also unwrap slowly
        budget = min(budget or TEXTURED_MAX_FACES, TEXTURED_MAX_FACES)
    mesh = simplify(mesh, budget)
    try:
        mesh.fix_normals()
    except Exception:
        pass

    painted = None
    paint_error = None
    if mode == "picture":
        views_dirs = [(prepared["front"], [0.0, 0.0, 1.0])]
        V, F = np.asarray(mesh.vertices), np.asarray(mesh.faces)
        if "back" in prepared:
            views_dirs.append((prepared["back"], [0.0, 0.0, -1.0]))
        for side in ("left", "right"):
            if side in prepared:
                # which side a photo shows is ambiguous by name; the silhouette decides
                cands = [np.array([1.0, 0, 0]), np.array([-1.0, 0, 0])]
                d = max(cands, key=lambda c: tex.View(prepared[side], c, V, F).silhouette_iou())
                views_dirs.append((prepared[side], d.tolist()))
        steps = {"Unwrapping the surface": 0.84, "Painting from the picture": 0.88, "Filling hidden sides": 0.92}
        prog = lambda m: send({"id": rid, "type": "progress", "stage": "paint", "pct": steps.get(m, 0.9), "msg": m})
        size = int(a.get("textureSize") or 2048)
        mesh, painted = tex.bake(mesh, views_dirs, fallback=fallback, size=size, progress=prog)
    elif mode == "ai":
        # Hunyuan3D Paint: a diffusion model paints all sides, guided by the picture and the mesh itself
        if not os.path.exists(os.path.join(model_dir("tencent/Hunyuan3D-2"), "hunyuan3d-paint-v2-0-turbo", "unet")):
            raise RuntimeError("Download Hunyuan3D Paint in Models first.")
        for k in [k for k in LOADED if k.startswith("shape:") or k.startswith("img:")]:
            LOADED.pop(k, None)
        empty_cache()
        send({"id": rid, "type": "progress", "stage": "paint", "pct": 0.82, "msg": "Loading Hunyuan3D Paint"})
        import paint
        q = a.get("paintQuality") or "standard"
        key = "paint:" + q
        if key not in LOADED:
            LOADED.pop("paint:fast", None); LOADED.pop("paint:standard", None)
            LOADED[key] = paint.load(MODELS, device(), q)
        send({"id": rid, "type": "progress", "stage": "paint", "pct": 0.85, "msg": "Painting every side (de-lighting, six views, baking)"})
        try:
            mesh = paint.paint(LOADED[key], mesh, prepared["front"])
            painted = 1.0
        except Exception as e:  # noqa: BLE001
            # never lose the model over the painter: fall back to painting from the picture
            traceback.print_exc()
            paint_error = friendly(e)
            LOADED.pop(key, None)
            empty_cache()
            send({"id": rid, "type": "progress", "stage": "paint", "pct": 0.88, "msg": "AI painter failed; painting from the picture instead"})
            mesh, painted = tex.bake(mesh, [(prepared["front"], [0.0, 0.0, 1.0])], fallback=fallback, size=2048)
        if not KEEP:
            LOADED.pop(key, None)
    elif mode == "none":
        import trimesh
        mesh.visual = trimesh.visual.ColorVisuals(mesh)

    send({"id": rid, "type": "progress", "stage": "export", "pct": 0.96, "msg": "Saving"})
    glb = export_mesh(mesh, os.path.join(out_dir, "model.glb"))
    LOADED["last"] = mesh  # quick re-exports
    if not KEEP:
        drop()
    s = stats(mesh)
    s.update(seconds=round(time.time() - t0, 1), seed=seed, engine=engine, device=device(), front=front_key, fit=round(float(front_iou), 3))
    if painted is not None:
        s["painted"] = round(painted, 3)
    if mode == "ai":
        s["painter"] = "hunyuan3d-paint" if not paint_error else "picture (fallback)"
    if paint_error:
        s["paintError"] = paint_error
    return {"glb": glb, "stats": s}


def cmd_export(rid, a):
    src = a["src"]
    if a.get("format") == "glb" and src.lower().endswith(".glb") and not a.get("faces") and not a.get("heightM"):
        import shutil
        shutil.copyfile(src, a["out"])
        return {"path": a["out"]}
    m = load_mesh(src)
    if a.get("faces"):
        m = simplify(m, a["faces"])
    if a.get("heightM"):
        h = float(m.bounds[1][1] - m.bounds[0][1]) or 1.0
        m.apply_scale(float(a["heightM"]) / h)
    out = export_mesh(m, a["out"], a.get("format"), a.get("heightMm"))
    return {"path": out, "stats": stats(m)}


def cmd_orient(rid, a):
    """Takes a GLB from elsewhere (Tripo), turns it to face +z, stands it on the floor at Facet's scale; keeps materials."""
    import trimesh
    import texture as tex
    scene = trimesh.load(a["src"], force="scene")
    flat = scene.dump(concatenate=True) if hasattr(scene, "dump") else scene
    key = a.get("assume") or "+x"
    iou = None
    if a.get("image") and os.path.exists(a["image"]):
        try:
            img = load_input(a["image"], remove_bg=os.path.exists(os.path.join(os.environ["U2NET_HOME"], "isnet-general-use.onnx")))
            key, iou = tex.find_front(img, np.asarray(flat.vertices), np.asarray(flat.faces))
        except Exception:
            traceback.print_exc()
    turns = {"+z": 0, "+x": -1, "-z": 2, "-x": 1}[key]
    if turns:
        scene.apply_transform(trimesh.transformations.rotation_matrix(turns * math.pi / 2, [0, 1, 0]))
    b = scene.bounds
    size = float((b[1] - b[0]).max()) or 1.0
    c = (b[0] + b[1]) / 2
    T = trimesh.transformations.scale_matrix(1.0 / size) @ trimesh.transformations.translation_matrix([-c[0], -b[0][1], -c[2]])
    scene.apply_transform(T)
    data = trimesh.exchange.gltf.export_glb(scene, include_normals=True)
    with open(a["out"], "wb") as f:
        f.write(data)
    flat = scene.dump(concatenate=True)
    s = {"vertices": int(len(flat.vertices)), "faces": int(len(flat.faces)), "colors": True, "texture": True, "watertight": bool(flat.is_watertight), "front": key}
    if iou is not None:
        s["fit"] = round(float(iou), 3)
    return {"path": a["out"], "stats": s}


def cmd_repaint(rid, a):
    """Paints an existing model from its picture (for models made before Facet painted textures)."""
    import texture as tex
    send({"id": rid, "type": "progress", "stage": "paint", "pct": 0.05, "msg": "Reading the model"})
    mesh = load_mesh(a["src"])
    img = Image.open(a["image"]).convert("RGBA")
    if not has_transparency(img):
        img = frame(cut_out(img))
    fallback = None
    mesh = normalize(remove_floaters(mesh))
    mesh, key, iou = tex.face_front(mesh, img)
    mesh = normalize(mesh)
    if vertex_colors(mesh) is not None:
        fallback = (np.asarray(mesh.vertices).copy(), vertex_colors(mesh).copy())
    mesh = simplify(mesh, TEXTURED_MAX_FACES)
    steps = {"Unwrapping the surface": 0.3, "Painting from the picture": 0.6, "Filling hidden sides": 0.85}
    mesh, painted = tex.bake(mesh, [(img, [0.0, 0.0, 1.0])], fallback=fallback, size=int(a.get("textureSize") or 2048),
                             progress=lambda m: send({"id": rid, "type": "progress", "stage": "paint", "pct": steps.get(m, 0.5), "msg": m}))
    export_mesh(mesh, a["out"])
    s = stats(mesh)
    s.update(front=key, fit=round(float(iou), 3), painted=round(painted, 3))
    return {"path": a["out"], "stats": s}


def _rig_mesh(src):
    """The mesh to rig, with UV seams welded so weights flow across the whole surface."""
    m = load_mesh(src)
    welded = m.copy()
    try:
        welded.merge_vertices(merge_tex=True, merge_norm=True)
    except TypeError:
        welded.merge_vertices()
    return m, welded


def cmd_rig_guess(rid, a):
    import rig
    _, welded = _rig_mesh(a["src"])
    b = welded.bounds
    return {"markers": rig.guess_markers(welded), "bounds": b.tolist()}


def cmd_rig(rid, a):
    import rig
    from scipy.spatial import cKDTree
    send({"id": rid, "type": "progress", "stage": "rig", "pct": 0.05, "msg": "Placing the skeleton"})
    mesh, welded = _rig_mesh(a["src"])
    markers = a.get("markers") or rig.guess_markers(welded)
    joints = rig.build_skeleton(welded, markers)
    send({"id": rid, "type": "progress", "stage": "rig", "pct": 0.15, "msg": "Working out how the surface follows each bone"})
    J, W = rig.skin_weights(welded, joints, progress=lambda f: send({"id": rid, "type": "progress", "stage": "rig", "pct": 0.15 + 0.7 * f, "msg": "Weighting the skin"}))
    # carry the weights back to the textured mesh (same positions, split along UV seams)
    _, nn = cKDTree(np.asarray(welded.vertices)).query(np.asarray(mesh.vertices), k=1)
    send({"id": rid, "type": "progress", "stage": "rig", "pct": 0.9, "msg": "Saving the rigged model"})
    out = rig.write_glb(a["out"], mesh, joints, J[nn], W[nn], height_m=float(a.get("heightM") or 1.8), animations=a.get("animations", True))
    return {"path": out, "joints": len(joints), "markers": markers, "clips": ["Idle", "Walk", "Wave"] if a.get("animations", True) else []}


def cmd_unload(rid, a):
    drop()
    return {"ok": True}


COMMANDS = {"hello": cmd_hello, "imagine": cmd_imagine, "cutout": cmd_cutout, "shape": cmd_shape, "export": cmd_export, "unload": cmd_unload,
            "rig_guess": cmd_rig_guess, "rig": cmd_rig, "repaint": cmd_repaint, "orient": cmd_orient}


def friendly(e):
    s = str(e)
    if "out of memory" in s.lower() or "MPS backend out of memory" in s:
        return "The graphics memory ran out. Lower the detail, close other heavy apps, or switch to the Fast engine."
    if isinstance(e, FileNotFoundError) or "not found" in s.lower() and "model" in s.lower():
        return "A model file is missing. Open Models and download it again."
    return s.splitlines()[0][:400] if s else e.__class__.__name__


def main():
    send({"type": "ready", "pid": os.getpid()})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue
        rid = req.get("id")
        cmd = req.get("cmd")
        if cmd == "quit":
            break
        fn = COMMANDS.get(cmd)
        if not fn:
            send({"id": rid, "type": "error", "error": "Unknown command " + str(cmd)})
            continue
        try:
            send({"id": rid, "type": "result", "data": fn(rid, req.get("args") or {})})
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            send({"id": rid, "type": "error", "error": friendly(e), "detail": traceback.format_exc()[-4000:]})


if __name__ == "__main__":
    main()
