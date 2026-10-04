"""Render the baked skin and clips for visual deformation checks (NumPy/Pillow)."""
import io
import json
import math
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

project = Path(__file__).resolve().parent.parent

def render_character(name):
    raw = (project / "public" / f"{name}-animated.glb").read_bytes()
    length = struct.unpack_from("<I", raw, 12)[0]
    gltf = json.loads(raw[20:20+length])
    binary = memoryview(raw)[28+length:]
    def read(index):
        item = gltf["accessors"][index]; view = gltf["bufferViews"][item["bufferView"]]
        dtype = np.dtype({5121:"u1",5123:"<u2",5125:"<u4",5126:"<f4"}[item["componentType"]])
        width = {"SCALAR":1,"VEC2":2,"VEC3":3,"VEC4":4,"MAT4":16}[item["type"]]
        return np.ndarray((item["count"],width),dtype=dtype,buffer=binary,
            offset=view.get("byteOffset",0)+item.get("byteOffset",0),
            strides=(view.get("byteStride",dtype.itemsize*width),dtype.itemsize)).copy()
    primitive = gltf["meshes"][0]["primitives"][0]
    selection = np.arange(0,gltf["accessors"][primitive["attributes"]["POSITION"]]["count"],2)
    positions = read(primitive["attributes"]["POSITION"])[selection]
    uv = read(primitive["attributes"]["TEXCOORD_0"])[selection]
    joints = read(primitive["attributes"]["JOINTS_0"])[selection].astype(int)
    weights = read(primitive["attributes"]["WEIGHTS_0"])[selection]
    skin = gltf["skins"][0]
    inverse = read(skin["inverseBindMatrices"]).reshape(-1,4,4).transpose(0,2,1)
    material = gltf["materials"][0]
    texture = gltf["textures"][material["pbrMetallicRoughness"]["baseColorTexture"]["index"]]
    view = gltf["bufferViews"][gltf["images"][texture["source"]]["bufferView"]]; off = view.get("byteOffset",0)
    texture = np.asarray(Image.open(io.BytesIO(binary[off:off+view["byteLength"]])).convert("RGB"))
    h,w = texture.shape[:2]
    colors = texture[np.clip((uv[:,1]*h).astype(int),0,h-1),np.clip((uv[:,0]*w).astype(int),0,w-1)]
    parents = {child:i for i,n in enumerate(gltf["nodes"]) for child in n.get("children",[])}
    def quat_matrix(q):
        x,y,z,w = q/np.linalg.norm(q)
        return np.array([[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w],
            [2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w],[2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y]])
    def pose(animation,phase):
        properties = {"rotation":[np.array(n.get("rotation",[0,0,0,1]),float) for n in gltf["nodes"]],
            "translation":[np.array(n.get("translation",[0,0,0]),float) for n in gltf["nodes"]],
            "scale":[np.array(n.get("scale",[1,1,1]),float) for n in gltf["nodes"]]}
        for channel in animation["channels"]:
            sampler = animation["samplers"][channel["sampler"]]; times = read(sampler["input"]).ravel(); values = read(sampler["output"])
            time = phase*times[-1]; i = max(0,min(np.searchsorted(times,time,side="right")-1,len(times)-2))
            alpha = np.clip((time-times[i])/(times[i+1]-times[i]),0,1)
            properties[channel["target"]["path"]][channel["target"]["node"]] = (1-alpha)*values[i]+alpha*values[i+1]
        worlds = {}
        def world(i):
            if i not in worlds:
                matrix = np.eye(4); matrix[:3,:3] = quat_matrix(properties["rotation"][i])@np.diag(properties["scale"][i]); matrix[:3,3] = properties["translation"][i]
                worlds[i] = world(parents[i])@matrix if i in parents else matrix
            return worlds[i]
        matrices = np.stack([world(i) for i in skin["joints"]])@inverse
        vertices = np.zeros_like(positions)
        for slot in range(4):
            m = matrices[joints[:,slot]]
            vertices += (np.einsum("nij,nj->ni",m[:,:3,:3],positions)+m[:,:3,3])*weights[:,slot,None]
        assert np.isfinite(vertices).all()
        return vertices
    def tile(vertices,label,eye=(2.8,.12,1),palette=None):
        forward = -np.array(eye,float); forward /= np.linalg.norm(forward)
        right = np.cross(forward,[0,1,0]); right /= np.linalg.norm(right); up = np.cross(right,forward)
        width,height = 400,420; scale = 340
        x = np.rint(width/2+vertices@right*scale).astype(int); y = np.rint(235-vertices@up*scale).astype(int)
        valid = (x>=0)&(x<width)&(y>=0)&(y<height)
        order = np.flatnonzero(valid)[np.argsort((vertices@forward)[valid])[::-1]]
        pixels = np.full((height,width,3),245,dtype=np.uint8); occupied = np.zeros((height,width),bool)
        pixels[y[order],x[order]] = colors[order] if palette is None else palette[order]; occupied[y[order],x[order]] = True
        original,mask = pixels.copy(),occupied.copy()
        for dy,dx in [(0,1),(0,-1),(1,0),(-1,0)]:
            close = (~occupied)&np.roll(mask,(dy,dx),axis=(0,1)); pixels[close] = np.roll(original,(dy,dx),axis=(0,1))[close]; occupied[close] = True
        image = Image.fromarray(pixels); ImageDraw.Draw(image).text((12,12),label,fill="black")
        return image
    animations = gltf["animations"]
    sheet = Image.new("RGB",(1600,math.ceil(len(animations)/4)*420),"white")
    for i,animation in enumerate(animations): sheet.paste(tile(pose(animation,.38),animation["name"]),((i%4)*400,(i//4)*420))
    sheet.save(project/"work"/f"{name}-animation-contact.png")
    wave = next(a for a in animations if a["name"]=="Wave")
    sheet = Image.new("RGB",(2400,840),"white")
    for row,eye in enumerate([(3,.05,.4),(.4,.05,3)]):
        for i,phase in enumerate([0,.12,.25,.45,.65,.86]): sheet.paste(tile(pose(wave,phase),f"Wave {phase:.2f}",eye), (i*400,row*420))
    sheet.save(project/"work"/f"{name}-wave-check.png")
    arm_joint = np.array(["Upperarm" in gltf["nodes"][node]["name"] or "Forearm" in gltf["nodes"][node]["name"] or "_Hand" in gltf["nodes"][node]["name"] for node in skin["joints"]])
    ownership = np.sum(arm_joint[joints]*weights,axis=1)
    palette = np.round(np.array([50,110,220])[None,:]*(1-ownership[:,None])+np.array([230,75,50])[None,:]*ownership[:,None]).astype(np.uint8)
    tile(positions,"Arm ownership: red arms / blue body",palette=palette).save(project/"work"/f"{name}-skin-check.png")
    print(f"Rendered {name} clips, wave sequence, and skin ownership")

if __name__ == "__main__":
    render_character("lebron")
    render_character("keanu")
