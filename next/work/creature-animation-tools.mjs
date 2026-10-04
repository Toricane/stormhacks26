import fs from "node:fs";
import assert from "node:assert/strict";
import * as THREE from "three";

const GENERATOR = "creature-animations-v1";
export const tau = Math.PI * 2;
export const radians = THREE.MathUtils.degToRad;
export const up = new THREE.Vector3(0, 1, 0);
export const forward = new THREE.Vector3(1, 0, 0);
export const sideways = new THREE.Vector3(0, 0, 1);
export const smooth = value => {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};
export const envelope = (phase, attack = 0.18, release = 0.2) =>
  smooth(phase / attack) * smooth((1 - phase) / release);

// Append animation data without re-exporting the mesh, textures, skin, or bind pose.
// The saved base offsets make regeneration idempotent, including the file size.
export function creature(file, sourceOverride) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.toString("ascii", 0, 4), "glTF");
  assert.equal(bytes.readUInt32LE(4), 2);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
  const binStart = 28 + jsonLength;
  const source = sourceOverride ?? gltf.extras?.creatureAnimationSource ?? {
    binaryLength: gltf.buffers[0].byteLength,
    accessorCount: gltf.accessors.length,
    bufferViewCount: gltf.bufferViews.length,
  };
  const binary = bytes.subarray(binStart, binStart + source.binaryLength);
  gltf.accessors.length = source.accessorCount;
  gltf.bufferViews.length = source.bufferViewCount;
  gltf.animations = (gltf.animations ?? []).filter(animation => animation.extras?.generator !== GENERATOR);
  gltf.extras = { ...gltf.extras, creatureAnimationSource: source };
  const nodes = gltf.nodes.map(node => {
    const object = new THREE.Object3D();
    object.name = node.name;
    if (node.matrix) new THREE.Matrix4().fromArray(node.matrix).decompose(object.position, object.quaternion, object.scale);
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
    return object;
  });
  gltf.nodes.forEach((node, i) => node.children?.forEach(child => nodes[i].add(nodes[child])));
  const scene = new THREE.Group();
  gltf.scenes[gltf.scene ?? 0].nodes.forEach(index => scene.add(nodes[index]));
  scene.updateMatrixWorld(true);
  const joints = [...new Set(gltf.skins.flatMap(skin => skin.joints))];
  const rest = nodes.map(node => ({
    position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(),
    worldPosition: node.getWorldPosition(new THREE.Vector3()),
    worldQuaternion: node.getWorldQuaternion(new THREE.Quaternion()),
  }));
  let binaryLength = binary.length;
  const parts = [binary];
  function accessor(values, type, count, bounds = {}, componentType = 5126) {
    const padding = (4 - binaryLength % 4) % 4;
    if (padding) { parts.push(Buffer.alloc(padding)); binaryLength += padding; }
    const ArrayType = { 5126: Float32Array, 5123: Uint16Array, 5121: Uint8Array }[componentType];
    assert.ok(ArrayType, "Supported accessor component type");
    const data = Buffer.from(new ArrayType(values).buffer);
    const bufferView = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: data.length });
    parts.push(data); binaryLength += data.length;
    const index = gltf.accessors.length;
    gltf.accessors.push({ bufferView, componentType, count, type, ...bounds });
    return index;
  }
  function reset() {
    nodes.forEach((node, index) => {
      node.position.copy(rest[index].position);
      node.quaternion.copy(rest[index].quaternion);
      node.scale.copy(rest[index].scale);
    });
    scene.updateMatrixWorld(true);
  }
  function worldRotation(index, axis, angle) {
    const node = nodes[index];
    const quaternion = node.getWorldQuaternion(new THREE.Quaternion());
    quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    if (node.parent) quaternion.premultiply(node.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    node.quaternion.copy(quaternion).normalize();
    scene.updateMatrixWorld(true);
  }
  function rotate(index, x = 0, y = 0, z = 0) {
    nodes[index].quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(radians(x), radians(y), radians(z))));
    scene.updateMatrixWorld(true);
  }
  function clip(name, duration, loop, category, description, pose) {
    assert.ok(!gltf.animations.some(animation => animation.name === name), `Duplicate clip: ${name}`);
    const frames = Math.round(duration * 30) + 1;
    const times = Array.from({ length: frames }, (_, i) => i * duration / (frames - 1));
    const input = accessor(times, "SCALAR", frames, { min: [0], max: [duration] });
    const tracks = joints.flatMap(index => [
      { index, path: "rotation", property: "quaternion", type: "VEC4", values: [] },
      { index, path: "translation", property: "position", type: "VEC3", values: [] },
      { index, path: "scale", property: "scale", type: "VEC3", values: [] },
    ]);
    for (const time of times) {
      reset(); pose(time / duration);
      for (const track of tracks) {
        const value = nodes[track.index][track.property].clone();
        if (track.path === "rotation") {
          value.normalize();
          if (track.values.length && new THREE.Quaternion().fromArray(track.values, track.values.length - 4).dot(value) < 0) {
            value.set(-value.x, -value.y, -value.z, -value.w);
          }
        }
        track.values.push(...value.toArray());
      }
    }
    const animation = {
      name, samplers: [], channels: [],
      extras: { generator: GENERATOR, loop, in_place: true, duration, fps: 30, category, description },
    };
    for (const track of tracks) {
      assert.ok(track.values.every(Number.isFinite), `${name}: finite ${track.path}`);
      const width = track.path === "rotation" ? 4 : 3;
      const first = track.values.slice(0, width), last = track.values.slice(-width);
      const gap = track.path === "rotation"
        ? new THREE.Quaternion().fromArray(first).angleTo(new THREE.Quaternion().fromArray(last))
        : new THREE.Vector3().fromArray(first).distanceTo(new THREE.Vector3().fromArray(last));
      assert.ok(gap < 0.00001, `${name}: matching endpoints for ${track.index}.${track.path} (${gap})`);
      if (!loop) {
        const restValue = rest[track.index][track.property];
        const restGap = track.path === "rotation"
          ? new THREE.Quaternion().fromArray(first).angleTo(restValue.clone().normalize())
          : new THREE.Vector3().fromArray(first).distanceTo(restValue);
        assert.ok(restGap < 0.00001, `${name}: one-shot returns to rest`);
      }
      const sampler = animation.samplers.length;
      animation.samplers.push({ input, output: accessor(track.values, track.type, frames), interpolation: "LINEAR" });
      animation.channels.push({ sampler, target: { node: track.index, path: track.path } });
    }
    gltf.animations.push(animation);
  }
  function write() {
    reset();
    gltf.buffers[0].byteLength = binaryLength;
    const json = Buffer.from(JSON.stringify(gltf));
    const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
    const outputBinary = Buffer.concat([...parts, Buffer.alloc((4 - binaryLength % 4) % 4)]);
    assert.ok(outputBinary.subarray(0, binary.length).equals(binary), "Original binary preserved");
    const header = Buffer.alloc(12);
    header.write("glTF"); header.writeUInt32LE(2, 4);
    header.writeUInt32LE(28 + jsonPadded.length + outputBinary.length, 8);
    const jsonHeader = Buffer.alloc(8);
    jsonHeader.writeUInt32LE(jsonPadded.length); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(outputBinary.length); binHeader.writeUInt32LE(0x004e4942, 4);
    fs.writeFileSync(file, Buffer.concat([header, jsonHeader, jsonPadded, binHeader, outputBinary]));
    return { file: file.pathname, joints: joints.length, clips: gltf.animations.map(animation => ({ name: animation.name, ...animation.extras })), preservedSourceBinary: true };
  }
  return { gltf, nodes, rest, scene, reset, rotate, worldRotation, clip, accessor, write };
}

// Dog limbs bend in the forward/up plane. IK keeps supporting paws planted,
// rather than moving them along with the chest and leaving them above the floor.
export function dogLegs(rig) {
  const { nodes, rest, scene, worldRotation } = rig;
  const legs = [
    { joints: [5, 4], toe: 3, phase: 0.25 },
    { joints: [8, 7], toe: 6, phase: 0.75 },
    { joints: [14, 13, 12], toe: 11, phase: 0 },
    { joints: [18, 17, 16], toe: 15, phase: 0.5 },
  ].map(leg => ({ ...leg, foot: rest[leg.toe].worldPosition.clone() }));
  function solve(leg, target) {
    if (leg.joints.length === 2) {
      const [shoulder, elbow] = leg.joints;
      const hip = nodes[shoulder].getWorldPosition(new THREE.Vector3());
      const knee = nodes[elbow].getWorldPosition(new THREE.Vector3());
      const foot = nodes[leg.toe].getWorldPosition(new THREE.Vector3());
      const upper = new THREE.Vector2(knee.x - hip.x, knee.y - hip.y).length();
      const lower = new THREE.Vector2(foot.x - knee.x, foot.y - knee.y).length();
      const direction = new THREE.Vector2(target.x - hip.x, target.y - hip.y);
      const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(upper - lower) + 0.00001, upper + lower - 0.00001);
      direction.normalize();
      const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
      const perpendicular = Math.sqrt(Math.max(0, upper * upper - along * along));
      const desiredKnee = new THREE.Vector2(hip.x, hip.y).addScaledVector(direction, along)
        .addScaledVector(new THREE.Vector2(-direction.y, direction.x), -perpendicular);
      function align(joint, end, goal) {
        const pivot = nodes[joint].getWorldPosition(new THREE.Vector3());
        const vector = nodes[end].getWorldPosition(new THREE.Vector3()).sub(pivot);
        const desired = new THREE.Vector2(goal.x - pivot.x, goal.y - pivot.y);
        worldRotation(joint, sideways, Math.atan2(vector.x * desired.y - vector.y * desired.x, vector.x * desired.x + vector.y * desired.y));
      }
      align(shoulder, elbow, desiredKnee);
      align(elbow, leg.toe, target);
    } else {
      for (let iteration = 0; iteration < 80; iteration++) {
        for (const joint of [...leg.joints].reverse()) {
          const pivot = nodes[joint].getWorldPosition(new THREE.Vector3());
          const foot = nodes[leg.toe].getWorldPosition(new THREE.Vector3()).sub(pivot);
          const desired = target.clone().sub(pivot);
          const angle = THREE.MathUtils.clamp(Math.atan2(foot.x * desired.y - foot.y * desired.x, foot.x * desired.x + foot.y * desired.y), -0.12, 0.12);
          worldRotation(joint, sideways, angle);
        }
        if (nodes[leg.toe].getWorldPosition(new THREE.Vector3()).distanceTo(target) < 0.0005) break;
      }
    }
    nodes[leg.toe].quaternion.copy(nodes[leg.toe].parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rest[leg.toe].worldQuaternion));
    scene.updateMatrixWorld(true);
  }
  function plant() { legs.forEach(leg => solve(leg, leg.foot)); }
  function gait(phase, stride, lift, duty = 0.65, trot = false) {
    legs.forEach((leg, index) => {
      const cycle = (phase + (trot ? [0, 0.5, 0.5, 0][index] : leg.phase)) % 1;
      const target = leg.foot.clone();
      if (cycle < duty) target.x += stride / 2 - stride * cycle / duty;
      else {
        const t = (cycle - duty) / (1 - duty);
        const h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h01 = -2 * t ** 3 + 3 * t ** 2;
        const h10 = t ** 3 - 2 * t ** 2 + t, h11 = t ** 3 - t ** 2;
        target.x += h00 * (-stride / 2) + h01 * stride / 2 + (h10 + h11) * (1 - duty) * (-stride / duty);
        target.y += lift * Math.sin(Math.PI * t) ** 2;
      }
      solve(leg, target);
    });
  }
  return { legs, solve, plant, gait };
}
