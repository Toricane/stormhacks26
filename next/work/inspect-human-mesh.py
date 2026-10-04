"""Orthographic source views for placing a rig in mesh coordinates."""
import io
import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

project = Path(__file__).resolve().parent.parent

def inspect(name):
    raw = (project / "public" / f"{name}.glb").read_bytes()
    length = struct.unpack_from("<I", raw, 12)[0]
    gltf = json.loads(raw[20:20 + length])
    binary = memoryview(raw)[28 + length:]
    def read(index):
        a = gltf["accessors"][index]
        v = gltf["bufferViews"][a["bufferView"]]
        width = {"VEC3":3,"VEC2":2,"SCALAR":1}[a["type"]]
        return np.ndarray((a["count"],width), dtype="<f4", buffer=binary, offset=v.get("byteOffset",0)).copy()
    primitive = gltf["meshes"][0]["primitives"][0]
    p = read(primitive["attributes"]["POSITION"])
    uv = read(primitive["attributes"]["TEXCOORD_0"])
    m = gltf["materials"][0]
    tex = gltf["textures"][m["pbrMetallicRoughness"]["baseColorTexture"]["index"]]
    v = gltf["bufferViews"][gltf["images"][tex["source"]]["bufferView"]]
    off = v.get("byteOffset",0)
    texture = np.asarray(Image.open(io.BytesIO(binary[off:off+v["byteLength"]])).convert("RGB"))
    h,w = texture.shape[:2]
    colors = texture[np.clip((uv[:,1]*h).astype(int),0,h-1),np.clip((uv[:,0]*w).astype(int),0,w-1)]
    sheet = Image.new("RGB",(1500,1100),"white")
    for i,(xaxis,depth,reverse,label) in enumerate([(2,0,True,"Front: +X (horizontal Z)"),(0,2,True,"Side: +Z (horizontal X)"),(2,0,False,"Back: -X")]):
        x = np.rint(250+p[:,xaxis]*950).astype(int)
        y = np.rint(555-p[:,1]*950).astype(int)
        order = np.argsort(p[:,depth])
        if not reverse: order = order[::-1]
        pixels = np.full((1100,500,3),245,dtype=np.uint8)
        pixels[y[order],x[order]] = colors[order]
        img = Image.fromarray(pixels)
        draw = ImageDraw.Draw(img)
        for height in np.arange(-.5,.51,.05):
            ytick = round(555-height*950)
            draw.line((0,ytick,500,ytick),fill=(200,210,220))
            draw.text((5,ytick+2),f"{height:.2f}",fill="blue")
        for z in np.arange(-.2,.21,.05):
            xtick = round(250+z*950)
            draw.line((xtick,0,xtick,1100),fill=(200,210,220))
            draw.text((xtick+2,1070),f"{z:.2f}",fill="blue")
        draw.text((5,20),label,fill="black")
        sheet.paste(img,(i*500,0))
    sheet.save(project/"work"/f"{name}-anatomy.png")

if __name__ == "__main__":
    inspect("lebron")
    inspect("keanu")
