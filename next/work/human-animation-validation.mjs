import * as THREE from "three";
import { readGlb, readAccessor } from "./glb-tools.mjs";

// Evaluate the baked GLB, independently of the authoring pose functions.
export function loadAnimatedHuman(file) {
  const { gltf, binary } = readGlb(file);
  const read = index => readAccessor(gltf, binary, index);
  const primitive = gltf.meshes[0].primitives[0], skin = gltf.skins[0];
  const positions = read(primitive.attributes.POSITION), triangles = read(primitive.indices);
  const joints = read(primitive.attributes.JOINTS_0), weights = read(primitive.attributes.WEIGHTS_0);
  const inverse = read(skin.inverseBindMatrices);
  const nodes = gltf.nodes.map(n => {
    const node = new THREE.Object3D();
    if (n.translation) node.position.fromArray(n.translation);
    if (n.rotation) node.quaternion.fromArray(n.rotation);
    if (n.scale) node.scale.fromArray(n.scale);
    return node;
  });
  gltf.nodes.forEach((n, i) => n.children?.forEach(child => nodes[i].add(nodes[child])));
  const root = new THREE.Group(); gltf.scenes[gltf.scene ?? 0].nodes.forEach(i => root.add(nodes[i])); root.updateMatrixWorld(true);
  const rest = nodes.map(n => ({ position: n.position.clone(), quaternion: n.quaternion.clone(), scale: n.scale.clone() }));
  const tracks = new Map(gltf.animations.map(a => [a.name, a.channels.map(channel => {
    const sampler = a.samplers[channel.sampler];
    return { ...channel.target, times: read(sampler.input), values: read(sampler.output) };
  })]));
  function reset() {
    nodes.forEach((n, i) => { n.position.copy(rest[i].position); n.quaternion.copy(rest[i].quaternion); n.scale.copy(rest[i].scale); });
    root.updateMatrixWorld(true);
  }
  function pose(name, phase) {
    reset();
    for (const track of tracks.get(name)) {
      const time = phase * track.times.at(-1);
      let frame = 0;
      while (frame < track.times.length - 2 && track.times[frame + 1] <= time) frame++;
      const alpha = (time - track.times[frame]) / (track.times[frame + 1] - track.times[frame]);
      const node = nodes[track.node];
      if (track.path === "rotation") node.quaternion.fromArray(track.values, frame * 4)
        .slerp(new THREE.Quaternion().fromArray(track.values, (frame + 1) * 4), alpha);
      else node[track.path === "translation" ? "position" : "scale"].fromArray(track.values, frame * 3)
        .lerp(new THREE.Vector3().fromArray(track.values, (frame + 1) * 3), alpha);
    }
    root.updateMatrixWorld(true);
  }
  function palette() {
    return skin.joints.map((node, i) => nodes[node].matrixWorld.clone().multiply(new THREE.Matrix4().fromArray(inverse, i * 16)));
  }
  function vertices() {
    const matrices = palette().map(m => m.elements), output = new Float64Array(positions.length);
    for (let i = 0; i < positions.length / 3; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      for (let slot = 0; slot < 4; slot++) {
        const w = weights[i * 4 + slot]; if (!w) continue;
        const m = matrices[joints[i * 4 + slot]];
        output[i * 3] += w * (m[0] * x + m[4] * y + m[8] * z + m[12]);
        output[i * 3 + 1] += w * (m[1] * x + m[5] * y + m[9] * z + m[13]);
        output[i * 3 + 2] += w * (m[2] * x + m[6] * y + m[10] * z + m[14]);
      }
    }
    return output;
  }
  const edgeLengths = new Float32Array(triangles.length);
  for (let i = 0; i < triangles.length; i++) {
    const a = triangles[i] * 3, b = triangles[i - i % 3 + (i + 1) % 3] * 3;
    edgeLengths[i] = Math.hypot(positions[a] - positions[b], positions[a + 1] - positions[b + 1], positions[a + 2] - positions[b + 2]);
  }
  function edgeStats(vertices) {
    let maxLength = 0, maxGrowth = 0, maxRatio = 0;
    for (let i = 0; i < triangles.length; i++) {
      const a = triangles[i] * 3, b = triangles[i - i % 3 + (i + 1) % 3] * 3;
      const length = Math.hypot(vertices[a] - vertices[b], vertices[a + 1] - vertices[b + 1], vertices[a + 2] - vertices[b + 2]);
      maxLength = Math.max(maxLength, length); maxGrowth = Math.max(maxGrowth, length - edgeLengths[i]);
      if (edgeLengths[i] > 1e-5) maxRatio = Math.max(maxRatio, length / edgeLengths[i]);
    }
    return { maxLength, maxGrowth, maxRatio };
  }
  return { gltf, binary, read, positions, triangles, joints, weights, nodes, root, rest, tracks, reset, pose, palette, vertices, edgeStats };
}
