import fs from "node:fs";
import assert from "node:assert/strict";
import * as THREE from "three";

const source = "/Users/mba/Downloads/Auto_rig_-_output.model_url_-_tripo_rigging_3c506028-6bd1-449c-9115-5db7d6b8196b.glb";
const destination = new URL("../public/dog-animated.glb", import.meta.url);
const bytes = fs.readFileSync(source);
assert.equal(bytes.toString("ascii", 0, 4), "glTF");
const jsonLength = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
const binStart = 28 + jsonLength;
const oldBinary = bytes.subarray(binStart, binStart + bytes.readUInt32LE(20 + jsonLength));
const nodes = gltf.nodes.map(node => {
  const object = new THREE.Object3D();
  object.name = node.name;
  if (node.translation) object.position.fromArray(node.translation);
  if (node.rotation) object.quaternion.fromArray(node.rotation);
  if (node.scale) object.scale.fromArray(node.scale);
  return object;
});
gltf.nodes.forEach((node, i) => node.children?.forEach(child => nodes[i].add(nodes[child])));
const root = nodes[gltf.scenes[gltf.scene || 0].nodes[0]];
root.updateMatrixWorld(true);
const rest = nodes.map(node => ({ position: node.position.clone(), quaternion: node.quaternion.clone() }));
const restWorld = nodes.map(node => node.getWorldQuaternion(new THREE.Quaternion()));
const up = new THREE.Vector3(0, 1, 0);
const sideways = new THREE.Vector3(0, 0, 1);
const radians = THREE.MathUtils.degToRad;

// This rig's front-right shoulder is named Spine_2, and the hind-left hip is bone_12.
const legs = [
  { joints: [5, 4], toe: 3, phase: 0.25 },
  { joints: [8, 7], toe: 6, phase: 0.75 },
  { joints: [14, 13, 12], toe: 11, phase: 0 },
  { joints: [18, 17, 16], toe: 15, phase: 0.5 },
].map(leg => ({ ...leg, foot: nodes[leg.toe].getWorldPosition(new THREE.Vector3()) }));

function reset() {
  nodes.forEach((node, index) => {
    node.position.copy(rest[index].position);
    node.quaternion.copy(rest[index].quaternion);
  });
  root.updateMatrixWorld(true);
}

function worldRotation(index, axis, angle) {
  const node = nodes[index];
  const quaternion = node.getWorldQuaternion(new THREE.Quaternion());
  quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
  if (node.parent) quaternion.premultiply(node.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
  node.quaternion.copy(quaternion).normalize();
  root.updateMatrixWorld(true);
}

function solveLeg(leg, target) {
  // Constrain leg motion to its forward/up plane; retain the original sideways stance.
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
  }
  for (let iteration = 0; leg.joints.length > 2 && iteration < 80; iteration++) {
    for (const joint of [...leg.joints].reverse()) {
      const pivot = nodes[joint].getWorldPosition(new THREE.Vector3());
      const foot = nodes[leg.toe].getWorldPosition(new THREE.Vector3()).sub(pivot);
      const desired = target.clone().sub(pivot);
      let angle = Math.atan2(foot.x * desired.y - foot.y * desired.x, foot.x * desired.x + foot.y * desired.y);
      angle = THREE.MathUtils.clamp(angle, -0.12, 0.12);
      worldRotation(joint, sideways, angle);
    }
    if (nodes[leg.toe].getWorldPosition(new THREE.Vector3()).distanceTo(target) < 0.0005) break;
  }
  // Keep the paw level rather than inheriting every knee rotation.
  const parent = nodes[leg.toe].parent.getWorldQuaternion(new THREE.Quaternion());
  nodes[leg.toe].quaternion.copy(parent.invert().multiply(restWorld[leg.toe]));
  root.updateMatrixWorld(true);
}

let binaryLength = oldBinary.length;
const binaryParts = [oldBinary];
function accessor(values, type, count, bounds) {
  const padding = (4 - binaryLength % 4) % 4;
  if (padding) { binaryParts.push(Buffer.alloc(padding)); binaryLength += padding; }
  const data = Buffer.from(new Float32Array(values).buffer);
  const bufferView = gltf.bufferViews.length;
  gltf.bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: data.length });
  binaryParts.push(data); binaryLength += data.length;
  const index = gltf.accessors.length;
  gltf.accessors.push({ bufferView, componentType: 5126, count, type, ...bounds });
  return index;
}

const errors = [];
function clip(name, duration, animatedNodes, pose, translations = []) {
  const frames = Math.round(duration * 30) + 1;
  const times = Array.from({ length: frames }, (_, i) => i * duration / (frames - 1));
  const input = accessor(times, "SCALAR", frames, { min: [0], max: [duration] });
  const rotations = new Map(animatedNodes.map(index => [index, []]));
  const positions = new Map(translations.map(index => [index, []]));
  for (const time of times) {
    reset(); pose(time / duration);
    for (const [index, values] of rotations) {
      const q = nodes[index].quaternion.clone().normalize();
      if (values.length && new THREE.Quaternion().fromArray(values, values.length - 4).dot(q) < 0) {
        q.set(-q.x, -q.y, -q.z, -q.w);
      }
      values.push(...q.toArray());
    }
    for (const [index, values] of positions) values.push(...nodes[index].position.toArray());
  }
  const animation = { name, samplers: [], channels: [], extras: { loop: true, in_place: true } };
  for (const [index, values] of rotations) {
    assert.ok(values.every(Number.isFinite));
    const sampler = animation.samplers.length;
    animation.samplers.push({ input, output: accessor(values, "VEC4", frames), interpolation: "LINEAR" });
    animation.channels.push({ sampler, target: { node: index, path: "rotation" } });
    assert.ok(new THREE.Quaternion().fromArray(values).angleTo(new THREE.Quaternion().fromArray(values, values.length - 4)) < 0.0001, `${name}: seamless rotation loop`);
  }
  for (const [index, values] of positions) {
    const sampler = animation.samplers.length;
    animation.samplers.push({ input, output: accessor(values, "VEC3", frames), interpolation: "LINEAR" });
    animation.channels.push({ sampler, target: { node: index, path: "translation" } });
  }
  gltf.animations.push(animation);
}

gltf.animations = [];
const tau = Math.PI * 2;
clip("Idle", 4, [2, 19], phase => {
  worldRotation(2, up, radians(3) * Math.sin(tau * phase));
  worldRotation(2, sideways, radians(1.5) * Math.sin(tau * phase * 2));
  worldRotation(19, up, radians(4) * Math.sin(tau * phase));
});
clip("Tail wag", 2, [2, 19], phase => {
  worldRotation(19, up, radians(20) * Math.sin(tau * phase * 3));
  worldRotation(2, sideways, radians(1.5) * Math.sin(tau * phase * 2));
});
clip("Walk", 1.6, [2, 19, ...legs.flatMap(leg => [...leg.joints, leg.toe])], phase => {
  nodes[20].position.y -= 0.008 + 0.001 * Math.sin(tau * phase * 2);
  root.updateMatrixWorld(true);
  worldRotation(2, sideways, radians(1.5) * Math.sin(tau * phase * 2));
  worldRotation(19, up, radians(7) * Math.sin(tau * phase));
  const stride = 0.06, duty = 0.65, lift = 0.035;
  for (const leg of legs) {
    const cycle = (phase + leg.phase) % 1;
    const target = leg.foot.clone();
    if (cycle < duty) {
      target.x += stride / 2 - stride * cycle / duty;
    } else {
      const u = (cycle - duty) / (1 - duty);
      const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
      const h01 = -2 * u ** 3 + 3 * u ** 2;
      const h10 = u ** 3 - 2 * u ** 2 + u;
      const h11 = u ** 3 - u ** 2;
      target.x += h00 * (-stride / 2) + h01 * (stride / 2) + (h10 + h11) * (1 - duty) * (-stride / duty);
      target.y += lift * Math.sin(Math.PI * u) ** 2;
    }
    solveLeg(leg, target);
    const foot = nodes[leg.toe].getWorldPosition(new THREE.Vector3());
    errors.push({ leg: leg.toe, stance: cycle < duty, error: foot.distanceTo(target), heightError: Math.abs(foot.y - target.y) });
  }
}, [20]);
reset();
gltf.buffers[0].byteLength = binaryLength;
const json = Buffer.from(JSON.stringify(gltf));
const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const binary = Buffer.concat([...binaryParts, Buffer.alloc((4 - binaryLength % 4) % 4)]);
const header = Buffer.alloc(12);
header.write("glTF", 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binary.length, 8);
const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(jsonPadded.length); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binary.length); binHeader.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(destination, Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binary]));
const summary = {
  source, output: destination.pathname, joints: gltf.skins[0].joints.length,
  clips: gltf.animations.map(animation => ({ name: animation.name, channels: animation.channels.length })),
  preservedBinary: binary.subarray(0, oldBinary.length).equals(oldBinary),
  walkMaxFootError: Math.max(...errors.map(error => error.error)),
  walkMaxStanceHeightError: Math.max(...errors.filter(error => error.stance).map(error => error.heightError)),
  legs: legs.map(leg => ({ toe: leg.toe, maxError: Math.max(...errors.filter(error => error.leg === leg.toe).map(error => error.error)) })),
};
fs.writeFileSync(new URL("dog-animation-check.json", import.meta.url), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
