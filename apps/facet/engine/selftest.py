"""Facet engine self-test: texturing and rigging on a synthetic A-pose figure. No models or GPU needed.
Run with the engine's Python:  <python> engine/selftest.py    (exit 0 = pass, 3 = libraries missing)"""
import math
import os
import sys
import tempfile

try:
    import numpy as np
    import trimesh
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit(3)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import rig
    import texture
    import xatlas  # noqa: F401
    import pygltflib  # noqa: F401
except ImportError:
    sys.exit(3)


def limb(a, b, r):
    a, b = np.array(a, float), np.array(b, float)
    c = trimesh.creation.cylinder(radius=r, segment=[a, b], sections=16)
    return c


def figure():
    parts = [
        trimesh.creation.box(extents=[0.34, 0.42, 0.18], transform=trimesh.transformations.translation_matrix([0, 1.18, 0])),  # torso
        trimesh.creation.icosphere(subdivisions=3, radius=0.11).apply_translation([0, 1.55, 0]),                                  # head
        limb([0, 1.38, 0], [0, 1.46, 0], 0.05),                                                                                   # neck
        limb([0.09, 0.95, 0], [0.11, 0.05, 0], 0.07), limb([-0.09, 0.95, 0], [-0.11, 0.05, 0], 0.07),                             # legs
        limb([0.19, 1.36, 0], [0.42, 0.95, 0], 0.045), limb([-0.19, 1.36, 0], [-0.42, 0.95, 0], 0.045),                          # arms
        trimesh.creation.box(extents=[0.34, 0.12, 0.2], transform=trimesh.transformations.translation_matrix([0, 0.92, 0])),     # pelvis
    ]
    m = trimesh.util.concatenate(parts)
    m.apply_translation([0, -m.bounds[0][1], 0])
    return m


def main():
    m = figure()
    # a front "photo": the silhouette in two colours, so we can check the texture landed
    img = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    # draw the figure's own silhouette as the picture: top half red, bottom half blue
    H = m.bounds[1][1]
    sil = Image.new("L", (512, 512), 0)
    sd = ImageDraw.Draw(sil)
    k = 512 / (H * 1.25)
    V = np.asarray(m.vertices)
    px, py = 256 + V[:, 0] * k, 512 - 40 - V[:, 1] * k
    for f in m.faces:
        sd.polygon([(px[i], py[i]) for i in f], fill=255)
    top = Image.new("RGBA", (512, 512), (220, 40, 40, 255))
    bottom = Image.new("RGBA", (512, 512), (40, 60, 220, 255))
    mid = int(512 - 40 - 0.9 * k)
    img.paste(top.crop((0, 0, 512, mid)), (0, 0), sil.crop((0, 0, 512, mid)))
    img.paste(bottom.crop((0, mid, 512, 512)), (0, mid), sil.crop((0, mid, 512, 512)))

    key, iou = texture.find_front(img, np.asarray(m.vertices), np.asarray(m.faces))
    assert iou > 0.8, f"silhouette fit too low: {iou}"
    tm, painted = texture.bake(m, [(img, [0, 0, 1])], size=512)
    assert painted > 0.25, f"too little painted: {painted}"
    col = tm.visual.to_color().vertex_colors[:, :3].astype(int)
    head = np.asarray(tm.vertices)[:, 1] > 1.45
    feet = np.asarray(tm.vertices)[:, 1] < 0.3
    assert col[head, 0].mean() > col[head, 2].mean(), "head should be red"
    assert col[feet, 2].mean() > col[feet, 0].mean(), "feet should be blue"

    mk = rig.guess_markers(m)
    assert abs(mk["groin"][1] - 0.92) < 0.15, mk
    assert mk["lwrist"][0] > 0.2 and mk["rwrist"][0] < -0.2, mk
    assert mk["lknee"][0] > 0 and mk["rknee"][0] < 0, mk
    joints = rig.build_skeleton(m, mk)
    J, W = rig.skin_weights(m, joints)
    names = [n for n, _, _ in joints]
    dom = np.array([J[i, W[i].argmax()] for i in range(len(J))])
    hand_side = (np.asarray(m.vertices)[:, 0] > 0.38) & (np.asarray(m.vertices)[:, 1] < 1.05)
    assert all(names[j].endswith(("LeftForeArm", "LeftHand")) for j in dom[hand_side]), "left hand weights"
    head_v = np.asarray(m.vertices)[:, 1] > 1.5
    assert all(names[j].endswith(("Head", "Neck")) for j in dom[head_v]), "head weights"
    out = os.path.join(tempfile.mkdtemp(), "rig.glb")
    rig.write_glb(out, m, joints, J, W)
    g = pygltflib.GLTF2().load(out)
    assert len(g.skins[0].joints) == len(joints) and len(g.animations) == 3
    print(f"selftest ok: front {key} iou {iou:.2f}, painted {painted:.2f}, {len(joints)} joints")


if __name__ == "__main__":
    main()
