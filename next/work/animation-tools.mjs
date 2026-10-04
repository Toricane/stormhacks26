import assert from "node:assert/strict";
import * as THREE from "three";
import { readGlb, glbWriter } from "./glb-tools.mjs";

export const tau = Math.PI * 2;
export const radians = THREE.MathUtils.degToRad;
export const up = new THREE.Vector3(0, 1, 0);
export const forward = new THREE.Vector3(1, 0, 0);
export const sideways = new THREE.Vector3(0, 0, 1);
export const smooth = value => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };
export const envelope = (phase, attack = 0.18, release = 0.2) => smooth(phase / attack) * smooth((1 - phase) / release);

export function animationRig(file) {
  const { gltf, binary } = readGlb(file);
  const writer = glbWriter(gltf, binary);
  gltf.extras.animationSource = { binaryLength: binary.length, accessorCount: gltf.accessors.length, bufferViewCount: gltf.bufferViews.length };
  const nodes = gltf.nodes.map(node => {
    const object = new THREE.Object3D(); object.name = node.name;
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
    return object;
  });
  gltf.nodes.forEach((node, i) => node.children?.forEach(child => nodes[i].add(nodes[child])));
  const scene = new THREE.Group();
  gltf.scenes[gltf.scene ?? 0].nodes.forEach(i => scene.add(nodes[i])); scene.updateMatrixWorld(true);
  const rest = nodes.map(node => ({ position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(),
    worldPosition: node.getWorldPosition(new THREE.Vector3()), worldQuaternion: node.getWorldQuaternion(new THREE.Quaternion()) }));
  const joints = gltf.skins[0].joints;
  function reset() {
    nodes.forEach((node, i) => { node.position.copy(rest[i].position); node.quaternion.copy(rest[i].quaternion); node.scale.copy(rest[i].scale); });
    scene.updateMatrixWorld(true);
  }
  function worldRotation(index, axis, angle) {
    const node = nodes[index];
    const q = node.getWorldQuaternion(new THREE.Quaternion()).premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    if (node.parent) q.premultiply(node.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    node.quaternion.copy(q).normalize(); scene.updateMatrixWorld(true);
  }
  function clip(name, duration, loop, category, description, pose, armOnly = false) {
    const frames = Math.round(duration * 30) + 1;
    const times = Array.from({ length: frames }, (_, i) => i * duration / (frames - 1));
    const input = writer.accessor(times, "SCALAR", frames);
    Object.assign(gltf.accessors[input], { min: [0], max: [duration] });
    const tracks = joints.flatMap(index => [
      { index, path: "rotation", property: "quaternion", type: "VEC4", width: 4, values: [] },
      { index, path: "translation", property: "position", type: "VEC3", width: 3, values: [] },
      { index, path: "scale", property: "scale", type: "VEC3", width: 3, values: [] },
    ]);
    for (const time of times) {
      reset(); pose(time / duration);
      for (const track of tracks) {
        const value = nodes[track.index][track.property].clone();
        if (track.path === "rotation") {
          value.normalize();
          if (track.values.length && new THREE.Quaternion().fromArray(track.values, track.values.length - 4).dot(value) < 0) value.set(-value.x, -value.y, -value.z, -value.w);
        }
        track.values.push(...value.toArray());
      }
    }
    const animation = { name, samplers: [], channels: [], extras: {
      generator: "human-interactions-v1", duration, loop, fps: 30, in_place: true, category, description, arm_only: armOnly,
    } };
    for (const track of tracks) {
      assert.ok(track.values.every(Number.isFinite), `${name}: finite transforms`);
      const first = track.values.slice(0, track.width), last = track.values.slice(-track.width);
      assert.ok(first.every((v, i) => Math.abs(v - last[i]) < 1e-5), `${name}: matching endpoints`);
      if (!loop) assert.ok(first.every((v, i) => Math.abs(v - rest[track.index][track.property].toArray()[i]) < 1e-5), `${name}: returns to rest`);
      const sampler = animation.samplers.length;
      animation.samplers.push({ input, output: writer.accessor(track.values, track.type, frames), interpolation: "LINEAR" });
      animation.channels.push({ sampler, target: { node: track.index, path: track.path } });
    }
    (gltf.animations ??= []).push(animation);
  }
  function write() {
    reset(); writer.write(file);
    return { file: file.pathname, joints: joints.length, clips: gltf.animations.map(a => ({ name: a.name, ...a.extras })) };
  }
  return { gltf, nodes, rest, scene, reset, worldRotation, clip, write };
}
