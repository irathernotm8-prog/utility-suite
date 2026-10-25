"""Facet: a pure-PyTorch stand-in for Hunyuan3D's compiled `custom_rasterizer`.

Hunyuan3D Paint rasterizes through a CUDA/C++ extension that has to be compiled on each machine (CUDA toolkit plus
Visual Studio on Windows). This module does the same job with ordinary tensor operations, so it needs no compiler
and runs on whatever device the tensors live on (CUDA, Metal or CPU).

Behaviour follows the extension's contract:
  rasterize(pos[1,N,4] clip-space, tri[F,3], (H, W)) -> (findices[H,W] int32, 1-based, 0 = empty;
                                                         barycentric[H,W,3], perspective-correct)
  * pixel centres at +0.5, screen x = (x/w * 0.5 + 0.5) * (W-1) + 0.5, same for y with H
  * depth z/w * 0.49999 + 0.5, nearest (smallest) wins, quantised to 2^18 steps, ties broken by face order
  * a pixel is covered when all three screen-space barycentrics are within [0, 1]
"""
import torch

_MAXINT = 2147483647
_QUANT = 2 << 17
_CHUNK = 6_000_000   # candidate pixels per batch; bounds memory on any device


def _screen(V, width, height):
    w = V[:, 3]
    sx = (V[:, 0] / w * 0.5 + 0.5) * (width - 1) + 0.5
    sy = (0.5 + 0.5 * V[:, 1] / w) * (height - 1) + 0.5
    sz = V[:, 2] / w * 0.49999 + 0.5
    return sx, sy, sz, w


def _bary(ax, ay, bx, by, cx, cy, px, py):
    area = (cx - ax) * (by - ay) - (bx - ax) * (cy - ay)
    beta = ((cx - ax) * (py - ay) - (px - ax) * (cy - ay))
    gamma = ((px - ax) * (by - ay) - (bx - ax) * (py - ay))
    safe = torch.where(area == 0, torch.ones_like(area), area)
    beta = beta / safe
    gamma = gamma / safe
    alpha = 1.0 - beta - gamma
    bad = area == 0
    return torch.where(bad, -1.0, alpha), torch.where(bad, -1.0, beta), torch.where(bad, -1.0, gamma)


@torch.no_grad()
def rasterize(pos, tri, resolution, clamp_depth=None, use_depth_prior=0):
    assert pos.device == tri.device
    V = (pos[0] if pos.dim() == 3 else pos).float()
    F = tri.long()
    height, width = int(resolution[0]), int(resolution[1])
    dev = V.device
    sx, sy, sz, w = _screen(V, width, height)
    x0, x1, x2 = sx[F[:, 0]], sx[F[:, 1]], sx[F[:, 2]]
    y0, y1, y2 = sy[F[:, 0]], sy[F[:, 1]], sy[F[:, 2]]
    z0, z1, z2 = sz[F[:, 0]], sz[F[:, 1]], sz[F[:, 2]]

    xmin = torch.minimum(torch.minimum(x0, x1), x2)
    xmax = torch.maximum(torch.maximum(x0, x1), x2)
    ymin = torch.minimum(torch.minimum(y0, y1), y2)
    ymax = torch.maximum(torch.maximum(y0, y1), y2)
    # the extension loops px = int(xmin) .. px < xmax + 1 (C truncation); keep only on-screen pixels
    px0 = torch.clamp(torch.trunc(xmin), min=0).long()
    py0 = torch.clamp(torch.trunc(ymin), min=0).long()
    px1 = torch.clamp(torch.ceil(xmax + 1).long(), max=width)     # exclusive
    py1 = torch.clamp(torch.ceil(ymax + 1).long(), max=height)
    nx = (px1 - px0).clamp(min=0)
    ny = (py1 - py0).clamp(min=0)
    count = nx * ny
    faces = torch.nonzero(count > 0).squeeze(1)

    empty = _MAXINT * _MAXINT + (_MAXINT - 1)
    zbuf = torch.full((height * width,), empty, dtype=torch.int64, device=dev)
    prior = None
    if use_depth_prior and clamp_depth is not None and clamp_depth.numel():
        prior = clamp_depth.reshape(-1).float().to(dev) * 0.49999 + 0.5 + 1e-6

    # walk the faces in batches of roughly _CHUNK candidate pixels
    cum = torch.cumsum(count[faces], 0)
    start = 0
    total = int(cum[-1]) if len(cum) else 0
    done = 0
    while done < total:
        end = int(torch.searchsorted(cum, torch.tensor(done + _CHUNK, device=dev), right=True))
        end = max(end, start + 1)
        fsel = faces[start:end]
        cnt = count[fsel]
        fid = torch.repeat_interleave(fsel, cnt)
        offs = torch.arange(int(cnt.sum()), device=dev) - torch.repeat_interleave(torch.cumsum(cnt, 0) - cnt, cnt)
        px = px0[fid] + offs % nx[fid]
        py = py0[fid] + torch.div(offs, nx[fid], rounding_mode="floor")
        fx, fy = px.float() + 0.5, py.float() + 0.5
        a, b, c = _bary(x0[fid], y0[fid], x1[fid], y1[fid], x2[fid], y2[fid], fx, fy)
        inside = (a >= 0) & (a <= 1) & (b >= 0) & (b <= 1) & (c >= 0) & (c <= 1)
        depth = a * z0[fid] + b * z1[fid] + c * z2[fid]
        pix = py * width + px
        if prior is not None:
            inside &= depth >= prior[pix]
        inside &= depth >= 0
        if inside.any():
            q = (depth[inside] * _QUANT).long()
            token = q * _MAXINT + (fid[inside] + 1)
            zbuf.scatter_reduce_(0, pix[inside], token, reduce="amin")
        done = int(cum[end - 1])
        start = end

    f = zbuf % _MAXINT
    hit = f != (_MAXINT - 1)
    findices = torch.where(hit, f, torch.zeros_like(f)).to(torch.int32)
    bary = torch.zeros((height * width, 3), dtype=torch.float32, device=dev)
    idx = torch.nonzero(hit).squeeze(1)
    if len(idx):
        ff = F[f[idx] - 1]
        px = (idx % width).float() + 0.5
        py = torch.div(idx, width, rounding_mode="floor").float() + 0.5
        a, b, c = _bary(sx[ff[:, 0]], sy[ff[:, 0]], sx[ff[:, 1]], sy[ff[:, 1]], sx[ff[:, 2]], sy[ff[:, 2]], px, py)
        # perspective-correct, as in the extension's second pass
        a = a / w[ff[:, 0]]; b = b / w[ff[:, 1]]; c = c / w[ff[:, 2]]
        s = a + b + c
        s = torch.where(s == 0, torch.ones_like(s), s)
        bary[idx] = torch.stack([a / s, b / s, c / s], 1)
    return findices.view(height, width), bary.view(height, width, 3)


def interpolate(col, findices, barycentric, tri):
    """Blends a per-vertex attribute (col[1, N, C]) across each pixel's triangle. Empty pixels read face 0."""
    face = (findices.long() - 1).clamp(min=0)
    corners = col[0][tri.long()[face]]                 # [H, W, 3, C]
    out = (barycentric.unsqueeze(-1) * corners).sum(-2)
    return out.unsqueeze(0)
