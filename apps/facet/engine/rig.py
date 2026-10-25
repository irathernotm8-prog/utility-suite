"""Facet rigging: a humanoid skeleton, skin weights and a few animations for a character mesh.

Works on a mesh that stands on y = 0, faces +z and is roughly in an A- or T-pose (Facet's Character style asks for
that). Eight markers, the same ones Mixamo uses, pin the skeleton: chin, both wrists, both elbows, both knees and the
groin. Facet guesses them from the silhouette; the person can drag them before rigging.

Joint names follow Mixamo ("mixamorig:Hips" …), which Unity's Humanoid avatar, Unreal's IK retargeter, Blender
add-ons and three.js examples all recognise, so Mixamo animations retarget onto Facet rigs.
The character's left is +x (it faces the viewer).
"""
import math
import os
import struct
import io
import numpy as np
from PIL import Image, ImageDraw

MARKERS = ["chin", "lwrist", "rwrist", "lelbow", "relbow", "lknee", "rknee", "groin"]
P = "mixamorig:"


# ───────────────────────── marker guess ─────────────────────────
def _silhouette(V, F, res):
    y0, y1 = V[:, 1].min(), V[:, 1].max()
    x0, x1 = V[:, 0].min(), V[:, 0].max()
    span = max(y1 - y0, x1 - x0) * 1.04
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    k = res / span
    px = (V[:, 0] - cx) * k + res / 2
    py = res / 2 - (V[:, 1] - cy) * k
    # front-most depth per pixel (painter's algorithm, far faces first): capes and hair hanging behind the
    # body sit further back than the arms and legs, which lets the guess look past them
    zc = V[F].mean(1)[:, 2]
    zim = Image.new("F", (res, res), -1e9)
    dr = ImageDraw.Draw(zim)
    for fi in np.argsort(zc):
        f = F[fi]
        dr.polygon([(px[f[0]], py[f[0]]), (px[f[1]], py[f[1]]), (px[f[2]], py[f[2]])], fill=float(zc[fi]))
    zmap = np.asarray(zim)
    m = zmap > -1e8
    to_x = lambda c: (c - res / 2) / k + cx
    to_y = lambda r: (res / 2 - r) / k + cy
    to_c = lambda x: int(round((x - cx) * k + res / 2))
    to_r = lambda y: int(round(res / 2 - (y - cy) * k))
    return m, zmap, to_x, to_y, to_c, to_r


def _runs(row):
    d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]]))
    s, e = np.where(d == 1)[0], np.where(d == -1)[0]
    return list(zip(s, e))   # [start, end)


def guess_markers(mesh):
    V = np.asarray(mesh.vertices, float)
    F = np.asarray(mesh.faces)
    res = 320
    full, zmap, to_x, to_y, to_c, to_r = _silhouette(V, F[:: max(1, len(F) // 120000)], res)
    ymin, ymax = V[:, 1].min(), V[:, 1].max()
    H = ymax - ymin
    Y = lambda t: ymin + t * H
    head = V[V[:, 1] > Y(0.88)]
    xm = float(np.median(head[:, 0])) if len(head) else float(np.median(V[:, 0]))
    cm = to_c(xm)
    # the body's front layer: drop surfaces well behind the torso's front (capes, long hair, wings)
    chest = zmap[to_r(Y(0.72)) - 3: to_r(Y(0.55)) + 3, cm - 3: cm + 4]
    chest = chest[chest > -1e8]
    sil = full
    zfront = float(np.median(chest)) if len(chest) else None
    if len(chest):
        front = full & (zmap > float(np.median(chest)) - 0.07 * H)
        if front.sum() > 0.45 * full.sum():
            sil = front

    def central(y):
        r = min(max(to_r(y), 0), res - 1)
        for s, e in _runs(sil[r]):
            if s <= cm < e:
                return s, e
        return None

    def side_runs(y, sign):
        r = min(max(to_r(y), 0), res - 1)
        out = []
        for s, e in _runs(sil[r]):
            if s <= cm < e:
                continue
            c = (s + e) / 2
            if (c - cm) * sign > 0:
                out.append((abs(c - cm), s, e))
        return sorted(out)

    # groin: scanning up from the shins, where the gap between the legs closes
    groin = Y(0.47)
    for t in np.arange(0.18, 0.62, 0.004):
        if central(Y(t)) is not None:
            groin = Y(t)
            break
    if groin == Y(0.18):
        groin = Y(0.47)   # no gap between the legs (robe, dress): typical proportion

    # neck: narrowest point of the central body between the shoulders and the head
    sil, keep = full, sil   # the neck and groin read best from the whole outline
    # shoulders: coming down from the top of the head, the first row much wider than the head itself
    widths = []
    for t in np.arange(0.985, 0.55, -0.004):
        c = central(Y(t))
        widths.append((t, (c[1] - c[0]) if c else 0))
    head_w = [w for t, w in widths if 0.86 <= t <= 0.95 and w > 0]
    hw = float(np.median(head_w)) if head_w else 0
    shoulder_t = 0.82
    if hw:
        for t, w in widths:
            if t < 0.93 and w > 1.75 * hw:
                shoulder_t = t
                break
    neck_y = Y(min(shoulder_t + 0.012, 0.93))
    sil = keep
    chin = (xm, min(neck_y + 0.03 * H, Y(0.94)))
    shoulder_y = neck_y - 0.02 * H

    knee_y = groin * 0.5 + Y(0.04) * 0.5
    leg_w = 0.075 * H
    def knee(sign):
        runs = side_runs(knee_y, sign)
        if runs:
            _, s, e = runs[0]
            inner, outer = (to_x(s), to_x(e)) if sign > 0 else (to_x(e), to_x(s))
            # a leg merged with a cape or skirt makes one long run: stay a leg's width from the inner edge
            if abs(outer - inner) > 1.6 * leg_w:
                outer = inner + sign * leg_w
            return ((inner + outer) / 2, knee_y)
        return (xm + sign * 0.06 * H, knee_y)

    def arm(sign):
        c = central(shoulder_y)
        cw = (to_x(c[1]) - to_x(c[0])) if c else 0
        if cw > 0.6 * H:
            # T-pose: the arms are part of the shoulder row
            tip = to_x(c[1] - 1) if sign > 0 else to_x(c[0])
            wrist = (tip - sign * 0.075 * H, shoulder_y - 0.01 * H)
            sx = xm + sign * 0.09 * H
            elbow = ((sx + wrist[0]) / 2, shoulder_y - 0.005 * H)
            return wrist, elbow
        # A-pose: follow the arm's own silhouette down to the fingertips
        rows = []
        px_per = res / (H * 1.04)
        for t in np.arange(0.20, (shoulder_y - ymin) / H, 0.004):
            y = Y(t)
            runs = side_runs(y, sign)
            if y < groin:
                runs = runs[1:]   # the innermost run below the groin is the leg
            r = min(max(to_r(y), 0), res - 1)
            # an arm is a narrow run near the front of the body (a cape or sleeve sheet is wide or further back)
            runs = [(d, s, e) for d, s, e in runs if (e - s) < 0.11 * H * px_per and (zfront is None or zmap[r, s:e].max() > zfront - 0.06 * H)]
            if runs:
                rows.append((y, [to_x((s + e) / 2) for _, s, e in runs]))
        # follow one arm down from the shoulder, so a cape edge further out is never mistaken for it
        rows.sort(key=lambda r: -r[0])
        track, x, miss = [], None, 0
        for y, xs in rows:
            if x is None:
                if y < shoulder_y - 0.34 * H:
                    break
                x0 = xm + sign * 0.14 * H
                cand = min(xs, key=lambda c: abs(c - x0))
                if abs(cand - x0) > 0.12 * H:
                    continue
            else:
                cand = min(xs, key=lambda c: abs(c - x))
                if abs(cand - x) > 0.03 * H:
                    miss += 1
                    if miss > 4:
                        break
                    continue
            miss = 0
            x = cand
            track.append((y, cand))
        rows = sorted(track)
        if len(rows) >= 4:
            tip_y = rows[0][0]
            wy = tip_y + 0.075 * H
            wx = min(rows, key=lambda r: abs(r[0] - wy))[1]
            ey = (wy + shoulder_y) / 2
            near = [r for r in rows if abs(r[0] - ey) < 0.03 * H]
            ex = near[len(near) // 2][1] if near else (wx + xm + sign * 0.1 * H) / 2
            return (wx, wy), (ex, ey)
        # arms pressed to the body: fall back to typical proportions
        return (xm + sign * 0.17 * H, groin + 0.02 * H), (xm + sign * 0.15 * H, (groin + shoulder_y) / 2 + 0.03 * H)

    lw, le = arm(+1)
    rw, re_ = arm(-1)
    lk, rk = knee(+1), knee(-1)
    m = {"chin": chin, "lwrist": lw, "rwrist": rw, "lelbow": le, "relbow": re_, "lknee": lk, "rknee": rk, "groin": (xm, groin)}
    return {k: [round(float(v[0]), 5), round(float(v[1]), 5)] for k, v in m.items()}


# ───────────────────────── skeleton ─────────────────────────
def _depth(V, x, y, r):
    near = V[(np.abs(V[:, 0] - x) < r) & (np.abs(V[:, 1] - y) < r)]
    if len(near) < 3:
        near = V[np.argsort((V[:, 0] - x) ** 2 + (V[:, 1] - y) ** 2)[:30]]
    return float((near[:, 2].min() + near[:, 2].max()) / 2)


def build_skeleton(mesh, markers):
    """Returns [(name, parent_index, world_position)] in hierarchy order."""
    V = np.asarray(mesh.vertices, float)
    ymin, ymax = V[:, 1].min(), V[:, 1].max()
    H = ymax - ymin
    mk = {k: np.array(v, float) for k, v in markers.items()}
    xm = (mk["groin"][0] + mk["chin"][0]) / 2
    r = 0.035 * H

    def J(x, y, z=None):
        return np.array([x, y, _depth(V, x, y, r) if z is None else z])

    groin_y, chin_y = mk["groin"][1], mk["chin"][1]
    shoulder_y = chin_y - 0.055 * H
    hips = J(xm, groin_y + 0.035 * H)
    neck = J(xm, shoulder_y + 0.03 * H)
    head = J(xm, chin_y + 0.01 * H)
    top = np.array([xm, ymax, head[2]])
    spine = [hips + (neck - hips) * t for t in (0.22, 0.48, 0.74)]
    for s in spine:
        s[2] = _depth(V, s[0], s[1], r)

    joints = []
    def add(name, parent, pos):
        joints.append((P + name, parent, np.asarray(pos, float)))
        return len(joints) - 1

    h = add("Hips", -1, hips)
    s0 = add("Spine", h, spine[0]); s1 = add("Spine1", s0, spine[1]); s2 = add("Spine2", s1, spine[2])
    n = add("Neck", s2, neck); hd = add("Head", n, head); add("HeadTop_End", hd, top)
    for side, sign, w, e in (("Left", 1, "lwrist", "lelbow"), ("Right", -1, "rwrist", "relbow")):
        wrist, elbow = mk[w], mk[e]
        reach = abs(elbow[0] - xm)
        sx = xm + sign * min(0.09 * H, max(0.05 * H, reach * 0.55))
        sh = add(side + "Shoulder", s2, J(xm + sign * 0.035 * H, shoulder_y + 0.005 * H))
        ua = add(side + "Arm", sh, J(sx, shoulder_y - 0.005 * H))
        fa = add(side + "ForeArm", ua, J(elbow[0], elbow[1]))
        hand = J(wrist[0], wrist[1])
        hn = add(side + "Hand", fa, hand)
        dirv = hand - joints[fa][2]
        dirv = dirv / (np.linalg.norm(dirv) or 1)
        add(side + "HandEnd", hn, hand + dirv * 0.075 * H)
    for side, sign, k in (("Left", 1, "lknee"), ("Right", -1, "rknee")):
        knee = mk[k]
        hw = min(0.085 * H, max(0.03 * H, abs(knee[0] - xm) * 0.85))
        ul = add(side + "UpLeg", h, J(xm + sign * hw, groin_y))
        lg = add(side + "Leg", ul, J(knee[0], knee[1]))
        foot_v = V[(V[:, 1] < ymin + 0.08 * H) & (np.abs(V[:, 0] - knee[0]) < 0.08 * H)]
        if len(foot_v):
            fz_back, fz_front = float(foot_v[:, 2].min()), float(foot_v[:, 2].max())
        else:
            fz_back = float(joints[lg][2][2]) - 0.03 * H
            fz_front = fz_back + 0.1 * H
        ankle = np.array([knee[0], ymin + 0.045 * H, fz_back + (fz_front - fz_back) * 0.3])
        ft = add(side + "Foot", lg, ankle)
        toe = add(side + "ToeBase", ft, np.array([knee[0], ymin + 0.015 * H, fz_back + (fz_front - fz_back) * 0.72]))
        add(side + "Toe_End", toe, np.array([knee[0], ymin + 0.012 * H, fz_front]))
    return joints


# ───────────────────────── skin weights ─────────────────────────
def skin_weights(mesh, joints, progress=None):
    """Up to four joint influences per vertex, from distances measured along the surface (so an arm resting
    against the hip still moves with the arm), softened across each joint."""
    from scipy.sparse import csr_matrix, diags
    from scipy.sparse.csgraph import dijkstra
    from scipy.spatial import cKDTree

    V = np.asarray(mesh.vertices, float)
    n = len(V)
    H = V[:, 1].max() - V[:, 1].min()
    edges = np.asarray(mesh.edges_unique)
    lens = np.linalg.norm(V[edges[:, 0]] - V[edges[:, 1]], axis=1)
    G = csr_matrix((np.concatenate([lens, lens]), (np.concatenate([edges[:, 0], edges[:, 1]]), np.concatenate([edges[:, 1], edges[:, 0]]))), shape=(n, n))
    tree = cKDTree(V)
    xmid = float(joints[0][2][0])

    # one bone per joint that has a child: the segment from the joint to its child (ends are not deforming)
    bones = []   # (joint index, a, b)
    children = {}
    for i, (_, p, _) in enumerate(joints):
        if p >= 0:
            children.setdefault(p, []).append(i)
    for i, (name, _, pos) in enumerate(joints):
        kids = children.get(i, [])
        if not kids:
            continue
        for k in kids:
            if name.endswith("Hips") and not joints[k][0].endswith("Spine"):
                continue   # hips own the pelvis segment only
            bones.append((i, pos, joints[k][2]))
    D = np.full((len(joints), n), np.inf)
    for bi, (ji, a, b) in enumerate(bones):
        samples = a[None] + (b - a)[None] * np.linspace(0.05, 0.95, 9)[:, None]
        _, seeds = tree.query(samples, k=1)
        d = dijkstra(G, directed=False, indices=np.unique(seeds), min_only=True)
        # distance along the surface plus the straight distance from the seed to the bone axis
        ab = b - a
        t = np.clip(((V - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
        foot = a + t[:, None] * ab
        axis = np.linalg.norm(V - foot, axis=1)
        cost = d * 0.7 + axis * 0.3
        jn = joints[ji][0]
        if jn.endswith(("Arm", "ForeArm", "Hand")) and "Shoulder" not in jn:
            # an arm owns its own sleeve, not the side of the chest it rests against: anything nearer the
            # body's midline than the arm's inner surface costs extra
            sign = 1.0 if "Left" in jn else -1.0
            inner = sign * (foot[:, 0] - xmid) - 0.045 * H
            excess = np.maximum(0.0, inner - sign * (V[:, 0] - xmid))
            cost = cost + excess * 6.0
        # limbs are slim: surfaces far from the bone (a cape or skirt hanging beside it) belong to the body
        if jn.endswith(("Arm", "ForeArm", "Hand", "UpLeg", "Leg", "Foot")) and "Shoulder" not in jn:
            reach = (0.06 if jn.endswith(("Arm", "ForeArm", "Hand")) else 0.085) * H
            cost = cost + np.maximum(0.0, axis - reach) * 5.0
        D[ji] = np.minimum(D[ji], cost)
        progress and progress(bi / len(bones))
    # vertices in pieces the graph cannot reach fall back to straight distance
    bad = ~np.isfinite(D).any(0)
    if bad.any():
        for bi, (ji, a, b) in enumerate(bones):
            ab = b - a
            t = np.clip(((V[bad] - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
            D[ji, bad] = np.minimum(D[ji, bad], np.linalg.norm(V[bad] - (a + t[:, None] * ab), axis=1))
    D = np.where(np.isfinite(D), D, 1e9)
    sigma = 0.012 * H
    W = np.exp(-(D - D.min(0, keepdims=True)) / sigma)
    W[D > 1e8] = 0
    W /= W.sum(0, keepdims=True)
    # smooth across the surface so bends deform softly
    A = G.copy(); A.data[:] = 1.0
    deg = np.asarray(A.sum(1)).ravel()
    M = diags(1.0 / np.maximum(deg, 1)) @ A
    Wt = W.T.copy()
    for _ in range(6):
        Wt = 0.5 * Wt + 0.5 * (M @ Wt)
    # keep the four strongest
    top = np.argsort(-Wt, axis=1)[:, :4]
    tw = np.take_along_axis(Wt, top, 1)
    tw = np.where(tw < 0.01, 0, tw)
    tw /= np.maximum(tw.sum(1, keepdims=True), 1e-9)
    return top.astype(np.uint16), tw.astype(np.float32)


# ───────────────────────── animations ─────────────────────────
def _quat(ax, ay, az):
    """XYZ Euler (radians) -> quaternion [x, y, z, w]."""
    cx, sx = math.cos(ax / 2), math.sin(ax / 2)
    cy, sy = math.cos(ay / 2), math.sin(ay / 2)
    cz, sz = math.cos(az / 2), math.sin(az / 2)
    # q = qz * qy * qx
    w = cz * cy * cx + sz * sy * sx
    x = cz * cy * sx - sz * sy * cx
    y = cz * sy * cx + sz * cy * sx
    z = sz * cy * cx - cz * sy * sx
    return [x, y, z, w]


def _arm_down(joints, side):
    """Angle that brings an A/T-pose arm to hang by the side (rotation about z)."""
    names = {n: i for i, (n, _, _) in enumerate(joints)}
    a = joints[names[P + side + "Arm"]][2]
    e = joints[names[P + side + "ForeArm"]][2]
    v = e - a
    ang = math.atan2(v[0], -v[1])   # 0 when hanging straight down
    return -ang


def clips(joints, H):
    """Idle, Walk and Wave, defined as small rotations away from the bind pose."""
    S = math.sin
    la, ra = _arm_down(joints, "Left"), _arm_down(joints, "Right")
    def idle(t):
        b = S(t * 2 * math.pi / 3.0)
        return {"Spine1": (0.02 * b, 0, 0), "Neck": (-0.02 * b, 0.04 * S(t * 0.9), 0), "LeftArm": (0, 0, la * 0.85 + 0.03 * b), "RightArm": (0, 0, ra * 0.85 - 0.03 * b),
                "LeftForeArm": (-0.12, 0, 0), "RightForeArm": (-0.12, 0, 0)}, (0, 0.003 * H * b, 0)
    def walk(t):
        p = t * 2 * math.pi / 1.1
        s = S(p)
        return {"LeftUpLeg": (-0.45 * s, 0, 0), "RightUpLeg": (0.45 * s, 0, 0),
                "LeftLeg": (0.6 * max(0, S(p + 1.6)), 0, 0), "RightLeg": (0.6 * max(0, S(p + math.pi + 1.6)), 0, 0),
                "LeftFoot": (-0.15 * s, 0, 0), "RightFoot": (0.15 * s, 0, 0),
                "LeftArm": (0.4 * s, 0, la * 0.9), "RightArm": (-0.4 * s, 0, ra * 0.9),
                "LeftForeArm": (-0.25 - 0.15 * max(0, s), 0, 0), "RightForeArm": (-0.25 - 0.15 * max(0, -s), 0, 0),
                "Spine": (0.05, 0.08 * s, 0), "Spine2": (0, -0.12 * s, 0)}, (0, 0.012 * H * abs(S(p)), 0)
    def wave(t):
        p = t * 2 * math.pi / 1.0
        return {"RightArm": (0, 0, -2.15), "RightForeArm": (0, 0, -0.3 + 0.3 * S(p)), "LeftArm": (0, 0, la * 0.85),
                "Head": (0, -0.12, 0.05 * S(p)), "Spine2": (0, -0.05, 0)}, (0, 0, 0)
    return [("Idle", idle, 3.0), ("Walk", walk, 1.1), ("Wave", wave, 2.0)]


# ───────────────────────── GLB writer ─────────────────────────
def write_glb(path, mesh, joints, J, W, height_m=1.8, animations=True):
    """Writes a skinned, textured (or vertex-coloured) GLB with the skeleton and the clips above."""
    import pygltflib as g
    V = np.asarray(mesh.vertices, float)
    ymin = V[:, 1].min()
    H = V[:, 1].max() - ymin
    s = height_m / H
    Vs = ((V - [0, ymin, 0]) * s).astype(np.float32)
    jp = [((pos - [0, ymin, 0]) * s) for _, _, pos in joints]
    N = np.asarray(mesh.vertex_normals, np.float32)
    Fi = np.asarray(mesh.faces, np.uint32)

    blob = bytearray()
    views, accs = [], []
    def add(arr, target=None, comp=None, typ=None, minmax=False):
        arr = np.ascontiguousarray(arr)
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        blob.extend(arr.tobytes())
        views.append(g.BufferView(buffer=0, byteOffset=off, byteLength=arr.nbytes, target=target))
        a = g.Accessor(bufferView=len(views) - 1, componentType=comp, count=len(arr), type=typ)
        if minmax:
            a.min = np.atleast_1d(arr.min(0)).astype(float).tolist(); a.max = np.atleast_1d(arr.max(0)).astype(float).tolist()
        accs.append(a)
        return len(accs) - 1
    F32, U16, U32 = 5126, 5123, 5125
    a_pos = add(Vs, 34962, F32, "VEC3", True)
    a_nrm = add(N, 34962, F32, "VEC3")
    attrs = g.Attributes(POSITION=a_pos, NORMAL=a_nrm)
    images, textures, samplers = [], [], []
    material = g.Material(name="Facet", pbrMetallicRoughness=g.PbrMetallicRoughness(baseColorFactor=[1, 1, 1, 1], metallicFactor=0.0, roughnessFactor=0.85))
    vis = mesh.visual
    if getattr(vis, "kind", None) == "texture" and getattr(vis, "uv", None) is not None:
        uv = np.asarray(vis.uv, np.float32).copy()
        uv[:, 1] = 1 - uv[:, 1]   # glTF's v runs downward
        attrs.TEXCOORD_0 = add(uv, 34962, F32, "VEC2")
        img = vis.material.baseColorTexture if hasattr(vis.material, "baseColorTexture") else vis.material.image
        bio = io.BytesIO(); img.convert("RGB").save(bio, "PNG")
        while len(blob) % 4:
            blob.append(0)
        off = len(blob); blob.extend(bio.getvalue())
        views.append(g.BufferView(buffer=0, byteOffset=off, byteLength=len(bio.getvalue())))
        images.append(g.Image(bufferView=len(views) - 1, mimeType="image/png"))
        samplers.append(g.Sampler(magFilter=9729, minFilter=9987, wrapS=33071, wrapT=33071))
        textures.append(g.Texture(source=0, sampler=0))
        material.pbrMetallicRoughness.baseColorTexture = g.TextureInfo(index=0)
    elif getattr(vis, "kind", None) == "vertex":
        c = np.asarray(vis.vertex_colors, np.float64)[:, :3] / 255.0
        lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)
        attrs.COLOR_0 = add(lin, 34962, F32, "VEC3")
    attrs.JOINTS_0 = add(J.astype(np.uint16), 34962, U16, "VEC4")
    attrs.WEIGHTS_0 = add(W.astype(np.float32), 34962, F32, "VEC4")
    a_idx = add(Fi.reshape(-1), 34963, U32, "SCALAR")

    nodes = []
    for i, (name, parent, _) in enumerate(joints):
        local = jp[i] - (jp[parent] if parent >= 0 else 0)
        nodes.append(g.Node(name=name, translation=[float(x) for x in local], children=[]))
    for i, (_, parent, _) in enumerate(joints):
        if parent >= 0:
            nodes[parent].children.append(i)
    ibm = np.zeros((len(joints), 16), np.float32)
    for i, p in enumerate(jp):
        m = np.eye(4, dtype=np.float32); m[:3, 3] = -p
        ibm[i] = m.T.reshape(-1)   # column-major
    a_ibm = add(ibm, None, F32, "MAT4")
    mesh_node = len(nodes)
    nodes.append(g.Node(name="Body", mesh=0, skin=0))
    root = len(nodes)
    nodes.append(g.Node(name="Armature", children=[0, mesh_node]))

    anims = []
    if animations:
        names = {n: i for i, (n, _, _) in enumerate(joints)}
        for cname, fn, dur in clips(joints, H):
            fps = 24
            ts = np.arange(0, dur + 1e-6, 1 / fps, dtype=np.float32)
            frames = [fn(float(t)) for t in ts]
            a_t = add(ts, None, F32, "SCALAR", True)
            samplers_, channels = [], []
            for jn in sorted({k for fr, _ in frames for k in fr}):
                q = np.array([_quat(*fr.get(jn, (0, 0, 0))) for fr, _ in frames], np.float32)
                a_q = add(q, None, F32, "VEC4")
                samplers_.append(g.AnimationSampler(input=a_t, output=a_q, interpolation="LINEAR"))
                channels.append(g.AnimationChannel(sampler=len(samplers_) - 1, target=g.AnimationChannelTarget(node=names[P + jn], path="rotation")))
            hip = np.array([np.asarray(jp[0], np.float32) + np.asarray(off, np.float32) * s for _, off in frames], np.float32)
            a_h = add(hip, None, F32, "VEC3")
            samplers_.append(g.AnimationSampler(input=a_t, output=a_h, interpolation="LINEAR"))
            channels.append(g.AnimationChannel(sampler=len(samplers_) - 1, target=g.AnimationChannelTarget(node=0, path="translation")))
            anims.append(g.Animation(name=cname, samplers=samplers_, channels=channels))

    gltf = g.GLTF2(
        asset=g.Asset(generator="Facet", version="2.0"),
        scene=0, scenes=[g.Scene(nodes=[root])], nodes=nodes,
        meshes=[g.Mesh(name="Body", primitives=[g.Primitive(attributes=attrs, indices=a_idx, material=0)])],
        materials=[material], textures=textures, images=images, samplers=samplers,
        skins=[g.Skin(name="Armature", joints=list(range(len(joints))), inverseBindMatrices=a_ibm, skeleton=0)],
        animations=anims, accessors=accs, bufferViews=views, buffers=[g.Buffer(byteLength=len(blob))]
    )
    gltf.set_binary_blob(bytes(blob))
    gltf.save_binary(path)
    return path
