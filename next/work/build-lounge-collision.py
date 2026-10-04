"""Bake a small collision/floor grid from the study lounge's captured mesh.

The source is a textured reconstruction, not a collision-ready room. Level its
floor, discard exterior capture debris, and conservatively close furniture gaps.
Requires NumPy and Pillow; no changes are made to the source GLB.
"""
import hashlib
import json
import math
import struct
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "public/university-study-lounge.glb"
data = SOURCE.read_bytes()
json_length = struct.unpack_from("<I", data, 12)[0]
gltf = json.loads(data[20:20 + json_length])
binary = memoryview(data)[28 + json_length:]


def accessor(index):
    a = gltf["accessors"][index]
    v = gltf["bufferViews"][a["bufferView"]]
    return np.frombuffer(binary, "<f4", a["count"] * 3, v["byteOffset"]).reshape(-1, 3)


positions = accessor(0)
normals = accessor(1)
# The embedded +90 degree X rotation leaves this scan upside down. Correct it
# with another 180 degrees about X BEFORE measuring the real floor.
flip = np.diag([1., -1., -1.])
points = np.stack([positions[:, 0], positions[:, 2], -positions[:, 1]], axis=1)
normals = np.stack([normals[:, 0], normals[:, 2], -normals[:, 1]], axis=1)
mask = ((points[:, 1] > -1.23) & (points[:, 1] < -.98) & (abs(normals[:, 1]) > .8)
        & (points[:, 0] > -5) & (points[:, 0] < 2) & (points[:, 2] > -6) & (points[:, 2] < 3))
sample = points[mask][::10]
for _ in range(5):
    design = np.c_[sample[:, 0], sample[:, 2], np.ones(len(sample))]
    plane = np.linalg.lstsq(design, sample[:, 1], rcond=None)[0]
    sample = sample[abs(design @ plane - sample[:, 1]) < .045]

# Rodrigues: level the measured floor normal, then face the window-side desks.
normal = np.array([-plane[0], 1, -plane[1]])
normal /= np.linalg.norm(normal)
axis = np.cross(normal, [0, 1, 0])
skew = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
level = np.eye(3) + skew + skew @ skew / (1 + normal[1])
yaw = math.radians(110)
turn = np.array([[math.cos(yaw), 0, math.sin(yaw)], [0, 1, 0], [-math.sin(yaw), 0, math.cos(yaw)]])
rotation = turn @ level
scale = 1.95  # Base calibration 1.5, enlarged 30% relative to user/characters.
origin = np.array([-2, plane @ [-2, -1, 1], -1])
translation = -rotation @ origin * scale
world = points @ rotation.T * scale + translation

cell = .13
minimum = np.array([-13., -11.7])
width, depth = 220, 180
xi = np.floor((world[:, 0] - minimum[0]) / cell).astype(int)
zi = np.floor((world[:, 2] - minimum[1]) / cell).astype(int)
inside = (xi >= 0) & (xi < width) & (zi >= 0) & (zi < depth)
# The finite captured interior; floor support below further excludes holes and
# incompletely scanned margins instead of treating the entire scan AABB as room.
interior = ((points[:, 0] > -5.7) & (points[:, 0] < 3.2)
            & (points[:, 2] > -6.3) & (points[:, 2] < 4.7))
valid = inside & interior


def count(mask):
    return np.bincount((zi[mask] * width + xi[mask]), minlength=width * depth).reshape(depth, width)


def dilate(mask):
    padded = np.pad(mask, 1)
    return np.logical_or.reduce([padded[z:z + depth, x:x + width] for z in range(3) for x in range(3)])


def erode(mask):
    return ~dilate(~mask)


floor = valid & (world[:, 1] > -.13) & (world[:, 1] < .143)
support = count(floor) >= 2
support = erode(dilate(dilate(support)))
# Any visible surface at body height blocks movement, including table tops,
# chair backs, partitions and columns. Fill scan holes by one cell, then close gaps.
obstacles = count(valid & (world[:, 1] > .22) & (world[:, 1] < 3.25)) >= 3
obstacles = erode(dilate(dilate(obstacles)))
walkable = support & ~obstacles

# Keep only floor connected to the window-side aisle. Tiny isolated capture
# islands and surfaces outside walls cannot become reachable walkable areas.
seed = (int(-minimum[0] / cell), int(-minimum[1] / cell))
near = [(x, z) for z in range(seed[1] - 12, seed[1] + 13) for x in range(seed[0] - 12, seed[0] + 13)
        if walkable[z, x]]
sx, sz = min(near, key=lambda p: (p[0] - seed[0]) ** 2 + (p[1] - seed[1]) ** 2)
connected = np.zeros_like(walkable)
queue = deque([(sx, sz)])
connected[sz, sx] = True
while queue:
    x, z = queue.popleft()
    for dx, dz in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
        nx, nz = x + dx, z + dz
        if 0 <= nx < width and 0 <= nz < depth and walkable[nz, nx] and not connected[nz, nx]:
            connected[nz, nx] = True
            queue.append((nx, nz))
walkable = connected

# Estimate local ground height only from floor samples; never snap onto tables.
height_count = count(floor).ravel()
heights = np.full(width * depth, -np.inf)
np.maximum.at(heights, zi[floor] * width + xi[floor], world[floor, 1])
heights[height_count == 0] = 0
heights = np.clip(heights, -.091, .143) + .015

matrix = np.eye(4)
matrix[:3, :3] = rotation @ flip * scale
matrix[:3, 3] = translation
output = {
    "version": 1, "source": SOURCE.name, "sourceSha256": hashlib.sha256(data).hexdigest(),
    "cellSize": cell, "width": width, "depth": depth, "minX": float(minimum[0]), "minZ": float(minimum[1]),
    "transform": matrix.T.ravel().tolist(), "floorPlane": plane.tolist(),
    "walkable": "".join("1" if v else "0" for v in walkable.ravel()),
    "floorHeights": np.round(heights, 3).tolist(),
    "spawn": {"player": [0, 0, 0], "subject": [-1.55, 0, .564],
              "lookDirection": [-math.sin(yaw), 0, -math.cos(yaw)]},
}
(ROOT / "public/university-study-lounge.collision.json").write_text(json.dumps(output, separators=(",", ":")) + "\n")
diagnostic = np.full((depth, width, 3), [230, 230, 230], dtype=np.uint8)
diagnostic[support] = [140, 145, 150]
diagnostic[obstacles & support] = [140, 65, 50]
diagnostic[walkable] = [200, 225, 205]
diagnostic[sz-1:sz+2, sx-1:sx+2] = [30, 100, 240]
(ROOT / "work/lounge").mkdir(exist_ok=True)
Image.fromarray(diagnostic).resize((width * 5, depth * 5)).save(ROOT / "work/lounge/collision-map.png")
print(f"Floor: {plane}; walkable cells: {walkable.sum()}; seed: {sx},{sz}; transform: {matrix.T.ravel().tolist()}")
