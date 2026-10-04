import { createRequire } from "node:module";
import { smooth } from "./creature-animation-tools.mjs";

export function readSkinAccessor(gltf, binary, index) {
  const item = gltf.accessors[index], view = gltf.bufferViews[item.bufferView];
  const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[item.type];
  const size = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[item.componentType];
  const values = new Float64Array(item.count * width);
  for (let i = 0; i < values.length; i++) {
    const offset = (view.byteOffset ?? 0) + (item.byteOffset ?? 0) + Math.floor(i / width) * (view.byteStride ?? width * size) + i % width * size;
    values[i] = item.componentType === 5126 ? binary.readFloatLE(offset) : item.componentType === 5125 ? binary.readUInt32LE(offset)
      : item.componentType === 5123 ? binary.readUInt16LE(offset) : binary.readUInt8(offset);
  }
  return values;
}

// Surface distance separates a sleeve/hand from nearby torso panels even when
// their Euclidean positions overlap. Smooth ownership along the actual mesh
// avoids long triangles connecting a raised hand back to the jacket/shorts.
export async function armOwnership(gltf, binary, primitive, character) {
  const read = index => readSkinAccessor(gltf, binary, index);
  const positions = read(primitive.attributes.POSITION), uv = read(primitive.attributes.TEXCOORD_0);
  const triangles = read(primitive.indices), count = positions.length / 3;
  const require = createRequire(import.meta.url);
  const sharp = require(require.resolve("sharp", { paths: [require.resolve("next/package.json")] }));
  const material = gltf.materials[primitive.material ?? 0];
  const image = gltf.images[gltf.textures[material.pbrMetallicRoughness.baseColorTexture.index].source];
  const imageView = gltf.bufferViews[image.bufferView], start = imageView.byteOffset ?? 0;
  const { data, info } = await sharp(binary.subarray(start, start + imageView.byteLength)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const valid = new Uint8Array(count), armSeeds = [], bodySeeds = [];
  for (let i = 0; i < count; i++) {
    const y = positions[i * 3 + 1], z = Math.abs(positions[i * 3 + 2]);
    if (y < 0.36 || y > 0.87) continue;
    valid[i] = 1;
    const u = Math.max(0, Math.min(info.width - 1, Math.floor(uv[i * 2] * info.width)));
    const v = Math.max(0, Math.min(info.height - 1, Math.floor(uv[i * 2 + 1] * info.height)));
    const pixel = (v * info.width + u) * info.channels;
    const r = data[pixel], g = data[pixel + 1], b = data[pixel + 2];
    const skin = r > 55 && g > 25 && r > g * 1.15 && r > b * 1.25;
    const clothing = (r > 135 && g > 100 && b < 110 && g > b * 1.35)
      || (b > 60 && b > r * 1.15 && b > g * 1.1) || (r > 180 && g > 180 && b > 180);
    const hand = skin && y < 0.535 && z > 0.115;
    const outerArm = y > 0.55 && y < 0.795 && z > (character === "LeBron James" ? 0.135 : 0.143)
      && (character !== "LeBron James" || !clothing);
    if (hand || outerArm) armSeeds.push(i);
    else if (z < 0.075 || (character === "LeBron James" && clothing && y < 0.76)) bodySeeds.push(i);
  }
  if (!armSeeds.length || !bodySeeds.length) throw new Error(`${character}: missing arm/body skinning anchors`);
  const offsets = new Uint32Array(count + 1);
  function edges(callback) {
    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i], b = triangles[i + 1], c = triangles[i + 2];
      if (valid[a] && valid[b]) { callback(a, b); callback(b, a); }
      if (valid[b] && valid[c]) { callback(b, c); callback(c, b); }
      if (valid[c] && valid[a]) { callback(c, a); callback(a, c); }
    }
  }
  edges(a => offsets[a + 1]++);
  for (let i = 1; i <= count; i++) offsets[i] += offsets[i - 1];
  const adjacent = new Uint32Array(offsets[count]), cursors = offsets.slice();
  edges((a, b) => { adjacent[cursors[a]++] = b; });
  function distances(seeds) {
    const distance = new Float64Array(count); distance.fill(Infinity);
    const heap = [];
    function push(vertex, value) {
      let index = heap.length; heap.push([vertex, value]);
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (heap[parent][1] <= value) break;
        heap[index] = heap[parent]; index = parent;
      }
      heap[index] = [vertex, value];
    }
    for (const seed of seeds) { distance[seed] = 0; push(seed, 0); }
    while (heap.length) {
      const [vertex, value] = heap[0], last = heap.pop();
      if (heap.length) {
        let index = 0;
        while (true) {
          const left = index * 2 + 1;
          if (left >= heap.length) break;
          const right = left + 1, child = right < heap.length && heap[right][1] < heap[left][1] ? right : left;
          if (heap[child][1] >= last[1]) break;
          heap[index] = heap[child]; index = child;
        }
        heap[index] = last;
      }
      if (value > distance[vertex]) continue;
      for (let i = offsets[vertex]; i < offsets[vertex + 1]; i++) {
        const neighbor = adjacent[i];
        const candidate = value + Math.hypot(positions[vertex * 3] - positions[neighbor * 3],
          positions[vertex * 3 + 1] - positions[neighbor * 3 + 1], positions[vertex * 3 + 2] - positions[neighbor * 3 + 2]);
        if (candidate < distance[neighbor]) { distance[neighbor] = candidate; push(neighbor, candidate); }
      }
    }
    return distance;
  }
  const armDistance = distances(armSeeds), bodyDistance = distances(bodySeeds);
  const ownership = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    ownership[i] = !valid[i] ? 0 : !Number.isFinite(armDistance[i]) ? 0 : !Number.isFinite(bodyDistance[i]) ? 1
      : smooth((bodyDistance[i] - armDistance[i] + 0.012) / 0.024);
  }
  return ownership;
}
