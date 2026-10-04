import fs from "node:fs";
import assert from "node:assert/strict";
import * as THREE from "three";
import { creature, smooth } from "./creature-animation-tools.mjs";
import { armOwnership } from "./arm-skinning.mjs";

// The supplied Keanu asset has a coarse 15-joint rig. Its upper arms are mostly
// weighted to the spine and its forearm pivots are near the waist. Add shoulder
// joints and repair arm weights locally; retain the mesh and texture binary.
export async function prepareKeanuRig(file) {
  const bytes = fs.readFileSync(file), jsonLength = bytes.readUInt32LE(12);
  const current = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
  const previousRepair = current.extras?.humanoidRigRepair;
  if (previousRepair?.version === 3) return;
  const originalViews = previousRepair && current.bufferViews.findIndex(view => view.byteOffset >= previousRepair.originalBinaryLength);
  const originalAccessors = previousRepair && current.accessors.findIndex(item => item.bufferView >= originalViews);
  const rig = creature(file, previousRepair ? { binaryLength: previousRepair.originalBinaryLength,
    bufferViewCount: originalViews, accessorCount: originalAccessors } : undefined);
  const { gltf, nodes, rest, scene, accessor } = rig;
  assert.equal(gltf.skins.length, 1);
  assert.equal(gltf.skins[0].joints.length, previousRepair ? 18 : 15, "Expected the supplied Keanu rig");
  const source = { ...gltf.extras.creatureAnimationSource };
  const binary = bytes.subarray(28 + jsonLength);
  function readAccessor(index) {
    const item = gltf.accessors[index], view = gltf.bufferViews[item.bufferView];
    const width = { VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[item.type];
    const size = { 5121: 1, 5123: 2, 5126: 4 }[item.componentType];
    const result = new Array(item.count * width);
    for (let row = 0; row < item.count; row++) {
      for (let column = 0; column < width; column++) {
        const offset = (view.byteOffset ?? 0) + (item.byteOffset ?? 0) + row * (view.byteStride ?? width * size) + column * size;
        result[row * width + column] = item.componentType === 5126 ? binary.readFloatLE(offset)
          : item.componentType === 5123 ? binary.readUInt16LE(offset) : binary.readUInt8(offset);
      }
    }
    return result;
  }
  const skin = gltf.skins[0];
  const originalInverseBind = readAccessor(gltf.accessors.findIndex(item => item.type === "MAT4" && item.count === 15));
  const originalJoints = skin.joints.slice(0, 15);
  function place(index, parentIndex, name, position) {
    // Reconstruct local TRS from a world-space rest transform, preserving the
    // pose despite the source root's rotation and armature's offset.
    gltf.nodes.forEach(node => { if (node.children) node.children = node.children.filter(child => child !== index); });
    const parent = nodes[parentIndex];
    parent.add(nodes[index]);
    (gltf.nodes[parentIndex].children ??= []).push(index);
    const local = parent.matrixWorld.clone().invert().multiply(new THREE.Matrix4().makeTranslation(...position));
    local.decompose(nodes[index].position, nodes[index].quaternion, nodes[index].scale);
    nodes[index].name = name;
    Object.assign(gltf.nodes[index], {
      name, translation: nodes[index].position.toArray(), rotation: nodes[index].quaternion.toArray(), scale: nodes[index].scale.toArray(),
    });
    delete gltf.nodes[index].matrix;
    scene.updateMatrixWorld(true);
  }
  function add(parent, name, position) {
    const index = nodes.length;
    nodes.push(new THREE.Object3D()); gltf.nodes.push({}); skin.joints.push(index);
    place(index, parent, name, position);
    return index;
  }
  const armL = previousRepair ? gltf.nodes.findIndex(node => node.name === "L_Upperarm") : add(2, "L_Upperarm", [0.012, 0.80, -0.112]);
  const armR = previousRepair ? gltf.nodes.findIndex(node => node.name === "R_Upperarm") : add(2, "R_Upperarm", [0.012, 0.80, 0.112]);
  place(11, armL, "L_Forearm", [0.025, 0.635, -0.14]);
  place(13, armR, "R_Forearm", [-0.018, 0.635, 0.14]);
  place(12, 13, "R_Hand", [-0.02, 0.495, 0.14]);
  const handL = previousRepair ? gltf.nodes.findIndex(node => node.name === "L_Hand") : add(11, "L_Hand", [0.06, 0.495, -0.14]);
  const indexOf = node => skin.joints.indexOf(node);
  const oldArmIndices = new Set([11, 12, 13].map(indexOf));
  const sides = {
    left: [armL, 11, handL].map(indexOf),
    right: [armR, 13, 12].map(indexOf),
  };
  for (const mesh of gltf.meshes) {
    for (const primitive of mesh.primitives) {
      const positions = readAccessor(primitive.attributes.POSITION);
      const oldIndices = readAccessor(previousRepair ? 3 : primitive.attributes.JOINTS_0);
      const oldWeights = readAccessor(previousRepair ? 4 : primitive.attributes.WEIGHTS_0);
      const ownership = await armOwnership(gltf, binary, primitive, "Keanu Reeves");
      const indices = [], weights = [];
      for (let vertex = 0; vertex < positions.length / 3; vertex++) {
        const y = positions[vertex * 3 + 1], z = positions[vertex * 3 + 2];
        const entries = Array.from({ length: 4 }, (_, slot) => ({
          joint: oldIndices[vertex * 4 + slot], weight: oldWeights[vertex * 4 + slot],
        }));
        const oldArmWeight = entries.filter(entry => oldArmIndices.has(entry.joint)).reduce((sum, entry) => sum + entry.weight, 0);
        const armWeight = ownership[vertex];
        if (armWeight > 0.000001) {
          const [upper, forearm, hand] = z < 0 ? sides.left : sides.right;
          const upperWeight = smooth((y - 0.605) / 0.065);
          const handWeight = 1 - smooth((y - 0.475) / 0.05);
          const candidates = entries.filter(entry => !oldArmIndices.has(entry.joint)).map(entry => ({
            joint: entry.joint, weight: entry.weight * (1 - armWeight) / Math.max(1 - oldArmWeight, 0.000001),
          }));
          if (oldArmWeight > 0.999999) candidates.push({ joint: indexOf(y > 0.61 ? 2 : 14), weight: 1 - armWeight });
          candidates.push({ joint: upper, weight: armWeight * upperWeight },
            { joint: forearm, weight: armWeight * (1 - upperWeight - handWeight) },
            { joint: hand, weight: armWeight * handWeight });
          const strongest = candidates.sort((a, b) => b.weight - a.weight).slice(0, 4);
          const total = strongest.reduce((sum, entry) => sum + entry.weight, 0);
          assert.ok(total > 0 && Number.isFinite(total));
          indices.push(...strongest.map(entry => entry.joint));
          weights.push(...strongest.map(entry => entry.weight / total));
        } else if (oldArmWeight > 0) {
          // Keep the inner coat panels on the torso even if the coarse source
          // rig assigned them to a nearby hand. This prevents long coat spikes.
          const torso = indexOf(y > 0.61 ? 2 : 14);
          const corrected = entries.filter(entry => !oldArmIndices.has(entry.joint));
          corrected.push({ joint: torso, weight: oldArmWeight });
          corrected.sort((a, b) => b.weight - a.weight);
          while (corrected.length < 4) corrected.push({ joint: torso, weight: 0 });
          indices.push(...corrected.slice(0, 4).map(entry => entry.joint));
          weights.push(...corrected.slice(0, 4).map(entry => entry.weight));
        } else {
          indices.push(...entries.map(entry => entry.joint));
          weights.push(...entries.map(entry => entry.weight));
        }
      }
      const count = positions.length / 3;
      primitive.attributes.JOINTS_0 = accessor(indices, "VEC4", count, {}, 5123);
      primitive.attributes.WEIGHTS_0 = accessor(weights, "VEC4", count);
    }
  }
  const changed = new Set([11, 12, 13, armL, armR, handL]);
  const inverseBind = skin.joints.flatMap((node, index) => changed.has(node)
    ? nodes[node].matrixWorld.clone().invert().toArray()
    : originalInverseBind.slice(index * 16, index * 16 + 16));
  skin.inverseBindMatrices = accessor(inverseBind, "MAT4", skin.joints.length);
  nodes.forEach((node, index) => {
    rest[index] = { position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(),
      worldPosition: node.getWorldPosition(new THREE.Vector3()), worldQuaternion: node.getWorldQuaternion(new THREE.Quaternion()) };
  });
  gltf.extras.humanoidRigRepair = { version: 3, originalJoints: originalJoints.length, joints: skin.joints.length,
    originalBinaryLength: source.binaryLength, description: "Shoulder/elbow pivots and arm weights repaired for humanoid motion." };
  // The repaired skin becomes the animation generator's new stable input.
  delete gltf.extras.creatureAnimationSource;
  rig.write();
}
