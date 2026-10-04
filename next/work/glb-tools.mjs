import fs from "node:fs";
import assert from "node:assert/strict";

export function readGlb(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.toString("ascii", 0, 4), "glTF");
  assert.equal(bytes.readUInt32LE(4), 2);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
  const binary = bytes.subarray(28 + jsonLength, 28 + jsonLength + gltf.buffers[0].byteLength);
  return { gltf, binary };
}

export function readAccessor(gltf, binary, index) {
  const item = gltf.accessors[index], view = gltf.bufferViews[item.bufferView];
  const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[item.type];
  const size = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[item.componentType];
  const ArrayType = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[item.componentType];
  const offset = (view.byteOffset ?? 0) + (item.byteOffset ?? 0);
  const stride = view.byteStride ?? width * size;
  if (stride === width * size && (binary.byteOffset + offset) % size === 0) {
    return new ArrayType(binary.buffer, binary.byteOffset + offset, item.count * width);
  }
  const values = new ArrayType(item.count * width);
  for (let row = 0; row < item.count; row++) {
    for (let column = 0; column < width; column++) {
      const address = offset + row * stride + column * size;
      values[row * width + column] = item.componentType === 5126 ? binary.readFloatLE(address)
        : item.componentType === 5125 ? binary.readUInt32LE(address)
        : item.componentType === 5123 ? binary.readUInt16LE(address) : binary.readUInt8(address);
    }
  }
  return values;
}

export function glbWriter(gltf, originalBinary) {
  const parts = [originalBinary];
  let length = originalBinary.length;
  function accessor(values, type, count, componentType = 5126) {
    const padding = (4 - length % 4) % 4;
    if (padding) { parts.push(Buffer.alloc(padding)); length += padding; }
    const ArrayType = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[componentType];
    const data = Buffer.from(new ArrayType(values).buffer);
    const bufferView = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: data.length });
    const index = gltf.accessors.length;
    gltf.accessors.push({ bufferView, componentType, type, count });
    parts.push(data); length += data.length;
    return index;
  }
  function write(file) {
    gltf.buffers[0].byteLength = length;
    const json = Buffer.from(JSON.stringify(gltf));
    const paddedJson = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
    const binary = Buffer.concat([...parts, Buffer.alloc((4 - length % 4) % 4)]);
    const header = Buffer.alloc(20);
    header.write("glTF"); header.writeUInt32LE(2, 4);
    header.writeUInt32LE(28 + paddedJson.length + binary.length, 8);
    header.writeUInt32LE(paddedJson.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binary.length); binHeader.writeUInt32LE(0x004e4942, 4);
    fs.writeFileSync(file, Buffer.concat([header, paddedJson, binHeader, binary]));
  }
  return { accessor, write };
}

// Weld UV seams for weight assignment, without changing the mesh or UVs.
export function meshComponents(positions, triangles, eligible = () => true) {
  const count = positions.length / 3, parent = Uint32Array.from({ length: count }, (_, i) => i);
  const valid = Uint8Array.from({ length: count }, (_, i) => eligible(i) ? 1 : 0);
  function find(i) {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }
  function join(a, b) {
    if (!valid[a] || !valid[b]) return;
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  const weld = new Map();
  for (let i = 0; i < count; i++) {
    if (!valid[i]) continue;
    const key = [0, 1, 2].map(axis => Math.round(positions[i * 3 + axis] * 1e6)).join(",");
    const match = weld.get(key);
    if (match !== undefined) join(i, match);
    else weld.set(key, i);
  }
  for (let i = 0; i < triangles.length; i += 3) {
    join(triangles[i], triangles[i + 1]); join(triangles[i + 1], triangles[i + 2]); join(triangles[i + 2], triangles[i]);
  }
  for (let i = 0; i < count; i++) parent[i] = valid[i] ? find(i) : 0xffffffff;
  return parent;
}
