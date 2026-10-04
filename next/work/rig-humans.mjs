import assert from "node:assert/strict";
import * as THREE from "three";
import { readGlb, readAccessor, glbWriter } from "./glb-tools.mjs";
import { armOwnership, skinHumanoid } from "./human-skinning.mjs";

export const humanProfiles = [
  { source: "lebron.glb", file: "lebron-animated.glb", name: "LeBron James", armCut: 0.21,
    energy: 1, waveCount: 3, stride: 0.12, duck: 0.035, exuberant: true,
    shoulder: [-0.026, 0.307, 0.118], elbow: [-0.028, 0.145, 0.145], wrist: [0.012, 0.008, 0.158],
    hip: [-0.016, -0.025, 0.065], knee: [-0.028, -0.24, 0.086], ankle: [-0.02, -0.418, 0.096] },
  { source: "keanu.glb", file: "keanu-animated.glb", name: "Keanu Reeves", armCut: 0.16,
    energy: 0.72, waveCount: 2, stride: 0.10, duck: 0.025, exuberant: false,
    shoulder: [-0.026, 0.307, 0.116], elbow: [-0.032, 0.14, 0.145], wrist: [-0.008, 0.012, 0.165],
    hip: [-0.018, -0.045, 0.057], knee: [-0.034, -0.267, 0.073], ankle: [-0.025, -0.445, 0.078] },
];

// Rebuild from the unrigged source every time, leaving the user's input intact.
export function prepareHumanoidRig(profile) {
  const source = new URL(`../public/${profile.source}`, import.meta.url);
  const output = new URL(`../public/${profile.file}`, import.meta.url);
  const { gltf, binary } = readGlb(source);
  assert.equal(gltf.nodes.length, 1, "Expected one untransformed source mesh");
  assert.ok(!gltf.nodes[0].matrix && !gltf.nodes[0].translation && !gltf.nodes[0].rotation && !gltf.nodes[0].scale);
  assert.ok(!gltf.skins?.length, "Expected an unrigged replacement asset");
  const writer = glbWriter(gltf, binary), bones = {};
  gltf.nodes[0].name = profile.name;
  function joint(name, parent, position) {
    const node = gltf.nodes.length, index = node - 1;
    const origin = parent ? bones[parent].position : [0, 0, 0];
    gltf.nodes.push({ name, translation: position.map((v, axis) => v - origin[axis]) });
    if (parent) (gltf.nodes[bones[parent].node].children ??= []).push(node);
    bones[name] = { node, joint: index, position };
  }
  joint("Root", null, [0, 0, 0]);
  joint("Hip", "Root", [-0.016, profile.hip[1], 0]);
  joint("Waist", "Hip", [-0.016, 0.08, 0]);
  joint("Spine", "Waist", [-0.02, 0.17, 0]);
  joint("Chest", "Spine", [-0.024, 0.28, 0]);
  joint("Neck", "Chest", [-0.005, 0.355, 0]);
  joint("Head", "Neck", [0.005, 0.415, 0]);
  for (const [side, sign] of [["L", -1], ["R", 1]]) {
    const mirror = point => [point[0], point[1], point[2] * sign];
    joint(`${side}_Clavicle`, "Chest", [-0.026, 0.31, 0.055 * sign]);
    joint(`${side}_Upperarm`, `${side}_Clavicle`, mirror(profile.shoulder));
    joint(`${side}_Forearm`, `${side}_Upperarm`, mirror(profile.elbow));
    joint(`${side}_Hand`, `${side}_Forearm`, mirror(profile.wrist));
    joint(`${side}_Thigh`, "Hip", mirror(profile.hip));
    joint(`${side}_Calf`, `${side}_Thigh`, mirror(profile.knee));
    joint(`${side}_Foot`, `${side}_Calf`, mirror(profile.ankle));
    joint(`${side}_ToeBase`, `${side}_Foot`, [0.065, profile.ankle[1] - 0.035, profile.ankle[2] * sign]);
  }
  const primitive = gltf.meshes[0].primitives[0];
  const positions = readAccessor(gltf, binary, primitive.attributes.POSITION);
  const triangles = readAccessor(gltf, binary, primitive.indices);
  const { ownership } = armOwnership(positions, triangles, profile);
  const { joints, weights } = skinHumanoid(positions, ownership, bones, profile);
  primitive.attributes.JOINTS_0 = writer.accessor(joints, "VEC4", positions.length / 3, 5123);
  primitive.attributes.WEIGHTS_0 = writer.accessor(weights, "VEC4", positions.length / 3);
  const inverseBind = Object.values(bones).flatMap(b => new THREE.Matrix4().makeTranslation(...b.position).invert().toArray());
  gltf.skins = [{ name: `${profile.name} interaction rig`, skeleton: bones.Root.node,
    joints: Object.values(bones).map(b => b.node), inverseBindMatrices: writer.accessor(inverseBind, "MAT4", Object.keys(bones).length) }];
  gltf.nodes[0].skin = 0;
  gltf.scenes[gltf.scene ?? 0].nodes.push(bones.Root.node);
  gltf.extras = { ...gltf.extras, humanoidRig: {
    version: 1, source: profile.source, joints: Object.keys(bones).length,
    sourceBinaryLength: binary.length, armCut: profile.armCut,
    method: "Anatomical skeleton; surface-connected arm ownership with a blended shoulder band and hard body anchors.",
    forward: "+X", up: "+Y", left: "-Z",
  } };
  writer.write(output);
  return output;
}
