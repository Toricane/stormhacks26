import io
import json
import struct
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

project = Path(__file__).resolve().parent.parent
data = (project / "public/dog-animated.glb").read_bytes()
json_len = struct.unpack_from("<I", data, 12)[0]
g = json.loads(data[20:20 + json_len])
binary = memoryview(data)[28 + json_len:]

def accessor(index):
    a = g["accessors"][index]
    v = g["bufferViews"][a["bufferView"]]
    dtype = {5121: "u1", 5123: "<u2", 5125: "<u4", 5126: "<f4"}[a["componentType"]]
    width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
    offset = v.get("byteOffset", 0) + a.get("byteOffset", 0)
    item = np.dtype(dtype).itemsize
    return np.ndarray((a["count"], width), dtype=dtype, buffer=binary, offset=offset, strides=(v.get("byteStride", item * width), item)).copy()

primitive = g["meshes"][0]["primitives"][0]
pos = accessor(primitive["attributes"]["POSITION"])
uv = accessor(primitive["attributes"]["TEXCOORD_0"])
joints = accessor(primitive["attributes"]["JOINTS_0"]).astype(int)
weights = accessor(primitive["attributes"]["WEIGHTS_0"])
skin = g["skins"][0]
inverse_bind = accessor(skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
material = g["materials"][primitive.get("material", 0)]
texture = material["pbrMetallicRoughness"]["baseColorTexture"]["index"]
image_ref = g["images"][g["textures"][texture]["source"]]
image_view = g["bufferViews"][image_ref["bufferView"]]
offset = image_view.get("byteOffset", 0)
texture_image = np.asarray(Image.open(io.BytesIO(binary[offset:offset + image_view["byteLength"]])).convert("RGB"))
h, w = texture_image.shape[:2]
colors = texture_image[np.clip((uv[:, 1] * h).astype(int), 0, h - 1), np.clip((uv[:, 0] * w).astype(int), 0, w - 1)]
parents = {child: i for i, node in enumerate(g["nodes"]) for child in node.get("children", [])}

def quat_matrix(q):
    x, y, z, w = np.asarray(q) / np.linalg.norm(q)
    return np.array([[1 - 2*y*y - 2*z*z, 2*x*y - 2*z*w, 2*x*z + 2*y*w], [2*x*y + 2*z*w, 1 - 2*x*x - 2*z*z, 2*y*z - 2*x*w], [2*x*z - 2*y*w, 2*y*z + 2*x*w, 1 - 2*x*x - 2*y*y]])

def pose(animation, time):
    rotations = [np.array(node.get("rotation", [0, 0, 0, 1]), float) for node in g["nodes"]]
    positions = [np.array(node.get("translation", [0, 0, 0]), float) for node in g["nodes"]]
    for channel in animation["channels"]:
        sampler = animation["samplers"][channel["sampler"]]
        times = accessor(sampler["input"]).ravel()
        values = accessor(sampler["output"])
        i = min(np.searchsorted(times, time, side="right") - 1, len(times) - 2)
        i = max(i, 0)
        u = np.clip((time - times[i]) / (times[i + 1] - times[i]), 0, 1)
        value = (1 - u) * values[i] + u * values[i + 1]
        target = channel["target"]
        if target["path"] == "rotation": rotations[target["node"]] = value / np.linalg.norm(value)
        else: positions[target["node"]] = value
    worlds = {}
    def world(i):
        if i in worlds: return worlds[i]
        matrix = np.eye(4)
        matrix[:3, :3] = quat_matrix(rotations[i]) @ np.diag(g["nodes"][i].get("scale", [1, 1, 1]))
        matrix[:3, 3] = positions[i]
        worlds[i] = world(parents[i]) @ matrix if i in parents else matrix
        return worlds[i]
    matrices = np.stack([world(i) for i in skin["joints"]]) @ inverse_bind
    vertices = np.zeros_like(pos)
    for slot in range(4):
        selected = matrices[joints[:, slot]]
        transformed = np.einsum("nij,nj->ni", selected[:, :3, :3], pos) + selected[:, :3, 3]
        vertices += transformed * weights[:, slot, None]
    return vertices

eye = np.array([1.0, 0.55, 2.0])
forward = -eye / np.linalg.norm(eye)
right = np.cross(forward, [0, 1, 0]); right /= np.linalg.norm(right)
up = np.cross(right, forward)
width, height = 480, 320
center = np.array([0, 0.3, 0])

def render(vertices):
    relative = vertices - center
    screen_x = np.rint(width / 2 + relative @ right * 385).astype(int)
    screen_y = np.rint(height / 2 - relative @ up * 385).astype(int)
    depth = relative @ forward
    valid = (screen_x >= 0) & (screen_x < width) & (screen_y >= 0) & (screen_y < height)
    order = np.flatnonzero(valid)[np.argsort(depth[valid])[::-1]]
    pixels = np.full((height, width, 3), 245, dtype=np.uint8)
    occupied = np.zeros((height, width), bool)
    pixels[screen_y[order], screen_x[order]] = colors[order]
    occupied[screen_y[order], screen_x[order]] = True
    original_pixels, original_occupied = pixels.copy(), occupied.copy()
    for dy, dx in [(0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)]:
        neighbor = np.roll(original_occupied, (dy, dx), axis=(0, 1))
        close = (~occupied) & neighbor
        pixels[close] = np.roll(original_pixels, (dy, dx), axis=(0, 1))[close]
        occupied[close] = True
    return Image.fromarray(pixels)

frames = []
contact = Image.new("RGB", (width * 3, height * 3), "white")
for row, animation in enumerate(g["animations"]):
    duration = float(accessor(animation["samplers"][0]["input"])[-1, 0])
    print(f"Rendering {animation['name']}…", flush=True)
    sample_frames = []
    for frame in range(12):
        vertices = pose(animation, frame * duration / 12)
        image = render(vertices)
        ImageDraw.Draw(image).text((12, 12), animation["name"], fill="#222222")
        sample_frames.append(image)
    for column, frame in enumerate([0, 3, 7]): contact.paste(sample_frames[frame], (column * width, row * height))
    frames += sample_frames
contact.save(project / "work/dog-animation-contact.png")
frames[0].save(project / "public/dog-animation-preview.gif", save_all=True, append_images=frames[1:], duration=160, loop=0)
print("Saved contact sheet and animation preview.")
