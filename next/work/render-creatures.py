"""Render pose contact sheets directly from each GLB's skin and animation data."""
import io
import json
import math
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

project = Path(__file__).resolve().parent.parent


def render_creature(filename, output, columns):
    data = (project / "public" / filename).read_bytes()
    json_length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + json_length])
    binary = memoryview(data)[28 + json_length:]

    def accessor(index):
        item = gltf["accessors"][index]
        view = gltf["bufferViews"][item["bufferView"]]
        dtype = np.dtype({5121: "u1", 5123: "<u2", 5125: "<u4", 5126: "<f4"}[item["componentType"]])
        width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[item["type"]]
        return np.ndarray((item["count"], width), dtype=dtype, buffer=binary,
                          offset=view.get("byteOffset", 0) + item.get("byteOffset", 0),
                          strides=(view.get("byteStride", dtype.itemsize * width), dtype.itemsize)).copy()

    primitive = gltf["meshes"][0]["primitives"][0]
    positions = accessor(primitive["attributes"]["POSITION"])
    # Enough points to inspect deformation without rendering 750k dog vertices per frame.
    selection = np.arange(0, len(positions), max(1, len(positions) // 200000))
    positions = positions[selection]
    uv = accessor(primitive["attributes"]["TEXCOORD_0"])[selection]
    skin = gltf.get("skins", [None])[0]
    if skin:
        joints = accessor(primitive["attributes"]["JOINTS_0"])[selection].astype(int)
        weights = accessor(primitive["attributes"]["WEIGHTS_0"])[selection]
        inverse_bind = accessor(skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
    material = gltf["materials"][primitive.get("material", 0)]
    texture = material["pbrMetallicRoughness"]["baseColorTexture"]["index"]
    image = gltf["images"][gltf["textures"][texture]["source"]]
    image_view = gltf["bufferViews"][image["bufferView"]]
    image_offset = image_view.get("byteOffset", 0)
    texture_image = np.asarray(Image.open(io.BytesIO(binary[image_offset:image_offset + image_view["byteLength"]])).convert("RGB"))
    h, w = texture_image.shape[:2]
    colors = texture_image[np.clip((uv[:, 1] * h).astype(int), 0, h - 1), np.clip((uv[:, 0] * w).astype(int), 0, w - 1)]
    parents = {child: i for i, node in enumerate(gltf["nodes"]) for child in node.get("children", [])}

    def quat_matrix(q):
        x, y, z, w = q / np.linalg.norm(q)
        return np.array([[1 - 2*y*y - 2*z*z, 2*x*y - 2*z*w, 2*x*z + 2*y*w],
                         [2*x*y + 2*z*w, 1 - 2*x*x - 2*z*z, 2*y*z - 2*x*w],
                         [2*x*z - 2*y*w, 2*y*z + 2*x*w, 1 - 2*x*x - 2*y*y]])

    def pose(animation, phase):
        if not skin:
            return positions.copy()
        properties = {
            "rotation": [np.array(node.get("rotation", [0, 0, 0, 1]), float) for node in gltf["nodes"]],
            "translation": [np.array(node.get("translation", [0, 0, 0]), float) for node in gltf["nodes"]],
            "scale": [np.array(node.get("scale", [1, 1, 1]), float) for node in gltf["nodes"]],
        }
        for channel in animation["channels"]:
            sampler = animation["samplers"][channel["sampler"]]
            times = accessor(sampler["input"]).ravel()
            values = accessor(sampler["output"])
            time = phase * times[-1]
            i = max(0, min(np.searchsorted(times, time, side="right") - 1, len(times) - 2))
            u = np.clip((time - times[i]) / (times[i + 1] - times[i]), 0, 1)
            properties[channel["target"]["path"]][channel["target"]["node"]] = (1 - u) * values[i] + u * values[i + 1]
        worlds = {}

        def world(i):
            if i not in worlds:
                matrix = np.eye(4)
                matrix[:3, :3] = quat_matrix(properties["rotation"][i]) @ np.diag(properties["scale"][i])
                matrix[:3, 3] = properties["translation"][i]
                worlds[i] = world(parents[i]) @ matrix if i in parents else matrix
            return worlds[i]

        matrices = np.stack([world(i) for i in skin["joints"]]) @ inverse_bind
        vertices = np.zeros_like(positions)
        for slot in range(4):
            selected = matrices[joints[:, slot]]
            vertices += (np.einsum("nij,nj->ni", selected[:, :3, :3], positions) + selected[:, :3, 3]) * weights[:, slot, None]
        assert np.isfinite(vertices).all(), animation["name"]
        return vertices

    animations = gltf.get("animations") or [{"name": "Rest pose", "channels": [], "samplers": []}]
    poses = [pose(animation, 0.35) for animation in animations]
    all_vertices = np.concatenate(poses)
    center = (all_vertices.min(axis=0) + all_vertices.max(axis=0)) / 2
    size = np.linalg.norm(all_vertices.max(axis=0) - all_vertices.min(axis=0))
    forward = -np.array([2.8, 0.35, 1.0] if filename.startswith(("lebron", "keanu")) else [1.0, 0.5, 2.8])
    forward /= np.linalg.norm(forward)
    right = np.cross(forward, [0, 1, 0]); right /= np.linalg.norm(right)
    up = np.cross(right, forward)
    width, height = 320, 280
    scale = 300 / size
    sheet = Image.new("RGB", (columns * width, math.ceil(len(poses) / columns) * height), "white")
    for index, (vertices, animation) in enumerate(zip(poses, animations)):
        relative = vertices - center
        x = np.rint(width / 2 + relative @ right * scale).astype(int)
        y = np.rint(height / 2 + 10 - relative @ up * scale).astype(int)
        valid = (x >= 0) & (x < width) & (y >= 0) & (y < height)
        order = np.flatnonzero(valid)[np.argsort((relative @ forward)[valid])[::-1]]
        pixels = np.full((height, width, 3), 245, dtype=np.uint8)
        occupied = np.zeros((height, width), bool)
        pixels[y[order], x[order]] = colors[order]; occupied[y[order], x[order]] = True
        original_pixels, original_occupied = pixels.copy(), occupied.copy()
        for dy, dx in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
            close = (~occupied) & np.roll(original_occupied, (dy, dx), axis=(0, 1))
            pixels[close] = np.roll(original_pixels, (dy, dx), axis=(0, 1))[close]
            occupied[close] = True
        image = Image.fromarray(pixels)
        draw = ImageDraw.Draw(image)
        draw.text((12, 12), animation["name"], fill="#222222")
        draw.text((12, 28), "Loop" if animation.get("extras", {}).get("loop") else "Once", fill="#777777")
        sheet.paste(image, ((index % columns) * width, (index // columns) * height))
    sheet.save(project / "work" / output)
    print(f"Saved {output}")


if __name__ == "__main__":
    render_creature("Pikachu.glb", "pikachu-animation-contact.png", 5)
    render_creature("dog-animated.glb", "dog-reactions-contact.png", 4)
    render_creature("lebron-animated.glb", "lebron-animation-contact.png", 4)
    render_creature("keanu-animated.glb", "keanu-animation-contact.png", 4)
