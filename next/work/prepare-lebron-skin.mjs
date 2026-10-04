import fs from "node:fs";
import { creature } from "./creature-animation-tools.mjs";
import { armOwnership, readSkinAccessor } from "./arm-skinning.mjs";

// Separate the arms from nearby jersey and shorts along the mesh surface,
// preserving the original full humanoid skeleton and bind pose.
export async function prepareLebronSkin(file) {
  const bytes = fs.readFileSync(file), jsonLength = bytes.readUInt32LE(12);
  const current = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
  const previous = current.extras?.humanoidSkinRepair;
  if (previous?.version === 2) return;
  const views = previous && current.bufferViews.findIndex(view => view.byteOffset >= previous.originalBinaryLength);
  const accessors = previous && current.accessors.findIndex(item => item.bufferView >= views);
  const rig = creature(file, previous ? { binaryLength: previous.originalBinaryLength,
    bufferViewCount: views, accessorCount: accessors } : undefined);
  const { gltf, accessor } = rig, binary = bytes.subarray(28 + jsonLength);
  const read = index => readSkinAccessor(gltf, binary, index);
  const skin = gltf.skins[0];
  const joint = name => skin.joints.findIndex(index => gltf.nodes[index].name === name);
  const armIndices = new Set(skin.joints.map((node, index) => /^([LR])_(Upperarm|Forearm|Hand)/.test(gltf.nodes[node].name) ? index : -1));
  let correctedVertices = 0;
  for (const mesh of gltf.meshes) {
    for (const primitive of mesh.primitives) {
      const positions = read(primitive.attributes.POSITION);
      const indices = read(previous ? 3 : primitive.attributes.JOINTS_0);
      const weights = read(previous ? 4 : primitive.attributes.WEIGHTS_0);
      const ownership = await armOwnership(gltf, binary, primitive, "LeBron James");
      for (let vertex = 0; vertex < positions.length / 3; vertex++) {
        const y = positions[vertex * 3 + 1], z = positions[vertex * 3 + 2];
        const entries = Array.from({ length: 4 }, (_, slot) => ({ joint: indices[vertex * 4 + slot], weight: weights[vertex * 4 + slot] }));
        const arm = entries.filter(entry => armIndices.has(entry.joint));
        const body = entries.filter(entry => !armIndices.has(entry.joint));
        const oldArmWeight = arm.reduce((sum, entry) => sum + entry.weight, 0);
        const oldBodyWeight = body.reduce((sum, entry) => sum + entry.weight, 0);
        const amount = ownership[vertex];
        if (Math.abs(amount - oldArmWeight) < 0.000001) continue;
        const side = z < 0 ? "L" : "R";
        const fallbackBody = joint(y > 0.64 ? "Spine01" : y > 0.51 ? "Waist" : `${side}_ThighTwist01`);
        const fallbackArm = joint(y > 0.655 ? `${side}_UpperarmTwist01` : y > 0.515 ? `${side}_ForearmTwist01` : `${side}_Hand`);
        const candidates = [
          ...(oldArmWeight > 0.000001 ? arm.map(entry => ({ joint: entry.joint, weight: entry.weight * amount / oldArmWeight })) : [{ joint: fallbackArm, weight: amount }]),
          ...(oldBodyWeight > 0.000001 ? body.map(entry => ({ joint: entry.joint, weight: entry.weight * (1 - amount) / oldBodyWeight })) : [{ joint: fallbackBody, weight: 1 - amount }]),
        ].sort((a, b) => b.weight - a.weight).slice(0, 4);
        while (candidates.length < 4) candidates.push({ joint: fallbackBody, weight: 0 });
        const total = candidates.reduce((sum, entry) => sum + entry.weight, 0);
        for (let slot = 0; slot < 4; slot++) {
          indices[vertex * 4 + slot] = candidates[slot].joint;
          weights[vertex * 4 + slot] = candidates[slot].weight / total;
        }
        correctedVertices++;
      }
      const count = positions.length / 3;
      primitive.attributes.JOINTS_0 = accessor(indices, "VEC4", count, {}, 5121);
      primitive.attributes.WEIGHTS_0 = accessor(weights, "VEC4", count);
    }
  }
  gltf.extras.humanoidSkinRepair = { version: 2, correctedVertices,
    originalBinaryLength: gltf.extras.creatureAnimationSource.binaryLength,
    description: "Arm/torso influences separated using mesh surface distances." };
  delete gltf.extras.creatureAnimationSource;
  rig.write();
}
