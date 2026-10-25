"""Facet texturing: paint a mesh from the picture(s) it was made from.

The image-to-3D models give geometry (Hunyuan) or blurry per-vertex colour (TripoSR). Here the mesh is unwrapped into
a UV texture, every texel is projected back into each input view, coloured from the pixels that can actually see it,
and the parts no picture shows are filled from their nearest painted neighbours (or from a fallback colour field).
The result is a normal PBR texture that Blender, Unity, Unreal, Godot, Roblox and three.js all read.

Coordinates: the mesh is y-up. A view is an orthographic camera looking at the object from direction d
(unit vector from the object toward the camera); image right = up x d.
"""
import math
import numpy as np
from PIL import Image, ImageDraw

UP = np.array([0.0, 1.0, 0.0])
HORIZONTAL = {"+z": np.array([0.0, 0.0, 1.0]), "+x": np.array([1.0, 0.0, 0.0]), "-z": np.array([0.0, 0.0, -1.0]), "-x": np.array([-1.0, 0.0, 0.0])}
# Hunyuan's multi-view order: front, then the object turned 90° at a time
VIEW_TURN = {"front": 0, "left": 1, "back": 2, "right": 3}


def _basis(d):
    right = np.cross(UP, d)
    return right / np.linalg.norm(right), UP.copy()


def rotate_y(v, quarter_turns):
    a = quarter_turns * math.pi / 2
    c, s = math.cos(a), math.sin(a)
    return np.array([c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]])


def _alpha_box(img):
    a = np.asarray(img.getchannel("A")) > 127
    ys, xs = np.where(a)
    if not len(ys):
        return None, a
    return (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1), a


class View:
    """An orthographic camera fitted so the mesh silhouette lands on the picture's cut-out."""

    def __init__(self, img, d, V, F):
        self.img = img.convert("RGBA")
        self.size = self.img.size[0]
        self.rgb = np.asarray(self.img.convert("RGB")).astype(np.float32)
        self.alpha = np.asarray(self.img.getchannel("A")).astype(np.float32) / 255.0
        self.d = d / np.linalg.norm(d)
        self.right, self.up = _basis(self.d)
        box, _ = _alpha_box(self.img)
        u, v = V @ self.right, V @ self.up
        # fit the mesh's projected box to the picture's object box (uniform scale from the height, centred)
        x0, y0, x1, y1 = box
        mh = max(v.max() - v.min(), 1e-6)
        mw = max(u.max() - u.min(), 1e-6)
        sh, sw = (y1 - y0) / mh, (x1 - x0) / mw
        self.s = sh if abs(sh / sw - 1) < 0.35 else (sh + sw) / 2
        self.cx = (x0 + x1) / 2 - self.s * (u.max() + u.min()) / 2
        self.cy = (y0 + y1) / 2 + self.s * (v.max() + v.min()) / 2
        self.V, self.F = V, F
        self._zbuf = None

    def project(self, P):
        """3D points -> pixel (x, y) and depth toward the camera."""
        return self.cx + self.s * (P @ self.right), self.cy - self.s * (P @ self.up), P @ self.d

    def silhouette_iou(self, res=192):
        k = res / self.size
        x, y, _ = self.project(self.V)
        im = Image.new("L", (res, res), 0)
        dr = ImageDraw.Draw(im)
        pts = np.stack([x * k, y * k], 1)
        for f in self.F[:: max(1, len(self.F) // 60000)]:
            dr.polygon([tuple(pts[i]) for i in f], fill=255)
        sil = np.asarray(im) > 0
        ref = np.asarray(Image.fromarray((self.alpha * 255).astype(np.uint8)).resize((res, res))) > 127
        inter = (sil & ref).sum()
        union = (sil | ref).sum() or 1
        return inter / union

    def zbuffer(self):
        """Front-most face id per pixel, drawn back to front (painter's algorithm)."""
        if self._zbuf is None:
            x, y, z = self.project(self.V)
            order = np.argsort(z[self.F].mean(1))   # far first
            im = Image.new("I", (self.size, self.size), 0)
            dr = ImageDraw.Draw(im)
            for fi in order:
                f = self.F[fi]
                dr.polygon([(x[f[0]], y[f[0]]), (x[f[1]], y[f[1]]), (x[f[2]], y[f[2]])], fill=int(fi) + 1)
            self._zbuf = np.asarray(im).astype(np.int64) - 1
            self._xyz = (x, y, z)
        return self._zbuf

    def visible(self, P, face_ids, tol):
        """True where the point is the front-most surface at its pixel."""
        zb = self.zbuffer()
        x, y, z = self.project(P)
        xi = np.clip(np.round(x).astype(int), 0, self.size - 1)
        yi = np.clip(np.round(y).astype(int), 0, self.size - 1)
        front = zb[yi, xi]
        ok = front >= 0
        vis = np.zeros(len(P), bool)
        same = ok & (front == face_ids)
        vis |= same
        # otherwise compare depth with the front face's plane at this pixel
        idx = np.where(ok & ~same)[0]
        if len(idx):
            X, Y, Z = self._xyz
            f = self.F[front[idx]]
            ax, ay, az = X[f[:, 0]], Y[f[:, 0]], Z[f[:, 0]]
            bx, by, bz = X[f[:, 1]], Y[f[:, 1]], Z[f[:, 1]]
            cx, cy, cz = X[f[:, 2]], Y[f[:, 2]], Z[f[:, 2]]
            px, py = x[idx], y[idx]
            den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            den = np.where(np.abs(den) < 1e-9, 1e-9, den)
            w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den
            w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den
            zf = w0 * az + w1 * bz + (1 - w0 - w1) * cz
            vis[idx] = z[idx] >= zf - tol
        return vis, x, y

    def sample(self, x, y):
        """Bilinear RGB and alpha at pixel positions."""
        n = self.size - 1
        x = np.clip(x, 0, n)
        y = np.clip(y, 0, n)
        x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int)
        x1 = np.minimum(x0 + 1, n); y1 = np.minimum(y0 + 1, n)
        fx = (x - x0)[:, None]; fy = (y - y0)[:, None]
        c = (self.rgb[y0, x0] * (1 - fx) * (1 - fy) + self.rgb[y0, x1] * fx * (1 - fy) + self.rgb[y1, x0] * (1 - fx) * fy + self.rgb[y1, x1] * fx * fy)
        a = (self.alpha[y0, x0] * (1 - fx[:, 0]) * (1 - fy[:, 0]) + self.alpha[y0, x1] * fx[:, 0] * (1 - fy[:, 0]) + self.alpha[y1, x0] * (1 - fx[:, 0]) * fy[:, 0] + self.alpha[y1, x1] * fx[:, 0] * fy[:, 0])
        return c, a


def find_front(img, V, F):
    """Which horizontal side of the mesh the picture shows. Returns (key, iou)."""
    best = None
    for key, d in HORIZONTAL.items():
        iou = View(img, d, V, F).silhouette_iou()
        if best is None or iou > best[1]:
            best = (key, iou)
    return best


def face_front(mesh, front_img):
    """Turns the mesh so the side shown in the picture faces +z (the glTF and game-engine convention)."""
    import trimesh
    V, F = np.asarray(mesh.vertices), np.asarray(mesh.faces)
    key, iou = find_front(front_img, V, F)
    turns = {"+z": 0, "+x": -1, "-z": 2, "-x": 1}[key]
    if turns:
        mesh.apply_transform(trimesh.transformations.rotation_matrix(turns * math.pi / 2, [0, 1, 0]))
    return mesh, key, iou


def unwrap(V, F, log=None):
    import xatlas
    atlas = xatlas.Atlas()
    atlas.add_mesh(V.astype(np.float32), F.astype(np.uint32))
    co = xatlas.ChartOptions()
    co.max_iterations = 2
    po = xatlas.PackOptions()
    po.padding = 4
    po.bilinear = True
    po.resolution = 0
    po.texels_per_unit = 0
    atlas.generate(co, po)
    vmap, idx, uv = atlas[0]
    return vmap.astype(np.int64), idx.astype(np.int64), uv.astype(np.float64)


def raster_uv(idx, uv, size):
    """Face id per texel (−1 where empty), drawn in UV space."""
    im = Image.new("I", (size, size), 0)
    dr = ImageDraw.Draw(im)
    px = np.stack([uv[:, 0] * size, (1 - uv[:, 1]) * size], 1)
    for fi, f in enumerate(idx):
        a, b, c = px[f[0]], px[f[1]], px[f[2]]
        dr.polygon([(a[0], a[1]), (b[0], b[1]), (c[0], c[1])], fill=fi + 1)
    return np.asarray(im).astype(np.int64) - 1


def bake(mesh, views, fallback=None, size=2048, progress=None):
    """
    mesh: trimesh (y-up, front = +z).  views: list of (PIL RGBA picture, direction vector).
    fallback: optional (points Nx3, colours Nx3/4 sRGB uint8) used where no picture sees the surface.
    Returns a textured trimesh.
    """
    import trimesh
    from scipy.spatial import cKDTree
    from scipy import ndimage

    V = np.asarray(mesh.vertices, dtype=np.float64)
    F = np.asarray(mesh.faces, dtype=np.int64)
    progress and progress("Unwrapping the surface")
    vmap, idx, uv = unwrap(V, F)
    V2 = V[vmap]
    progress and progress("Painting from the picture")
    fid = raster_uv(idx, uv, size)
    ty, tx = np.where(fid >= 0)
    f = fid[ty, tx]
    # barycentric coordinates of each texel centre inside its UV triangle
    p = np.stack([(tx + 0.5) / size, 1 - (ty + 0.5) / size], 1)
    a, b, c = uv[idx[f, 0]], uv[idx[f, 1]], uv[idx[f, 2]]
    v0, v1, v2 = b - a, c - a, p - a
    d00 = (v0 * v0).sum(1); d01 = (v0 * v1).sum(1); d11 = (v1 * v1).sum(1); d20 = (v2 * v0).sum(1); d21 = (v2 * v1).sum(1)
    den = d00 * d11 - d01 * d01
    den = np.where(np.abs(den) < 1e-14, 1e-14, den)
    w1 = (d11 * d20 - d01 * d21) / den
    w2 = (d00 * d21 - d01 * d20) / den
    w1 = np.clip(w1, 0, 1); w2 = np.clip(w2, 0, 1 - w1); w0 = 1 - w1 - w2
    P = w0[:, None] * V2[idx[f, 0]] + w1[:, None] * V2[idx[f, 1]] + w2[:, None] * V2[idx[f, 2]]
    fn = np.asarray(mesh.face_normals)[f]

    acc = np.zeros((len(P), 3)); wsum = np.zeros(len(P))
    extent = float((V.max(0) - V.min(0)).max())
    for img, d in views:
        view = View(img, np.asarray(d, float), V, F)
        vis, x, y = view.visible(P, f, tol=extent * 0.006)
        facing = np.clip(fn @ view.d, 0, 1)
        col, al = view.sample(x, y)
        w = vis * (facing ** 2) * (al > 0.5)
        acc += col * w[:, None]
        wsum += w
    painted = wsum > 0.02
    colour = np.zeros((len(P), 3))
    colour[painted] = acc[painted] / wsum[painted, None]

    # surfaces no picture sees
    progress and progress("Filling hidden sides")
    hidden = ~painted
    if hidden.any():
        if fallback is not None and len(fallback[0]):
            _, nn = cKDTree(fallback[0]).query(P[hidden], k=1)
            colour[hidden] = np.asarray(fallback[1])[nn, :3]
        elif painted.any():
            k = min(8, int(painted.sum()))
            dist, nn = cKDTree(P[painted]).query(P[hidden], k=k)
            if k == 1:
                colour[hidden] = colour[painted][nn]
            else:
                wt = 1.0 / np.maximum(dist, 1e-6)
                colour[hidden] = (colour[painted][nn] * wt[..., None]).sum(1) / wt.sum(1)[:, None]
        else:
            colour[hidden] = 180
        # soften the seam where painted meets filled
        edge = painted & (wsum < 0.25)
        if edge.any() and fallback is not None and len(fallback[0]):
            _, nn = cKDTree(fallback[0]).query(P[edge], k=1)
            t = (wsum[edge] / 0.25)[:, None]
            colour[edge] = colour[edge] * t + np.asarray(fallback[1])[nn, :3] * (1 - t)

    tex = np.zeros((size, size, 3), np.float32)
    tex[ty, tx] = colour
    filled = np.zeros((size, size), bool)
    filled[ty, tx] = True
    # bleed colour into the empty gutters so mip-maps and filtering never show black seams
    _, (iy, ix) = ndimage.distance_transform_edt(~filled, return_indices=True)
    tex = tex[iy, ix]
    image = Image.fromarray(np.clip(tex, 0, 255).astype(np.uint8), "RGB")

    material = trimesh.visual.material.PBRMaterial(baseColorTexture=image, metallicFactor=0.0, roughnessFactor=0.85, doubleSided=False)
    out = trimesh.Trimesh(vertices=V2, faces=idx, process=False)
    out.visual = trimesh.visual.TextureVisuals(uv=uv, material=material)
    return out, float(painted.mean())
