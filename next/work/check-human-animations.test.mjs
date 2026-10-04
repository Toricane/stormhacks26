import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { CharacterAnimationPlayer, describeAnimation } from "../lib/character-animation-player.ts";
import { loadAnimatedHuman } from "./human-animation-validation.mjs";
import { readGlb, meshComponents } from "./glb-tools.mjs";

const wave = new THREE.AnimationClip("Wave", 1, [new THREE.NumberKeyframeTrack(".position[x]", [0, 0.5, 1], [0, 1, 0])]);
wave.userData = { loop: false, in_place: true, description: "Wave once" };
const idle = new THREE.AnimationClip("Idle", 2, [new THREE.NumberKeyframeTrack(".position[x]", [0, 1, 2], [0, -1, 0])]);
idle.userData = { loop: true };

test("one-shots finish at rest and replay; uploaded clips default to looping", () => {
  const root = new THREE.Object3D(), player = new CharacterAnimationPlayer(root, [wave]);
  player.play("Wave", 0); player.update(0.5); assert.equal(root.position.x, 1);
  player.update(1.2); assert.equal(root.position.x, 0);
  player.play("Wave", 0); player.update(0.5); assert.equal(root.position.x, 1);
  assert.equal(describeAnimation(wave).loop, false);
  assert.equal(describeAnimation(wave).inPlace, true);
  assert.equal(describeAnimation(new THREE.AnimationClip("Uploaded", 1, [])).loop, true);
  player.dispose(); assert.equal(root.position.x, 0);
});

test("looping, pause, speed, missing clips and pose restoration", () => {
  const root = new THREE.Object3D(), player = new CharacterAnimationPlayer(root, [idle]);
  player.play("Idle", 0); player.update(2.5); assert.equal(root.position.x, -0.5);
  player.setPlayback(false); player.update(0.4); assert.equal(root.position.x, -0.5);
  player.setPlayback(true, 2); player.update(0.25); assert.equal(root.position.x, -1);
  assert.equal(player.play("Missing"), false); assert.equal(root.position.x, -1);
  player.stop(); assert.equal(root.position.x, 0); player.dispose();
});

test("rapid crossfades and repeating a gesture preserve the visible pose", () => {
  const root = new THREE.Object3D(), player = new CharacterAnimationPlayer(root, [idle, wave]);
  player.play("Wave", 0); player.update(0.4);
  const previous = root.position.x;
  player.play("Wave"); player.update(0); assert.ok(Math.abs(root.position.x - previous) < 1e-7);
  player.update(0.04); player.play("Idle"); player.update(0.04);
  const interrupted = root.position.x;
  player.play("Wave"); player.update(0); assert.ok(Math.abs(root.position.x - interrupted) < 1e-7);
  player.update(0.3);
  assert.equal(player.mixer.clipAction(idle).isScheduled(), false);
  player.dispose();
});

for (const character of ["lebron", "keanu"]) {
  const file = new URL(`../public/${character}-animated.glb`, import.meta.url);
  const rig = loadAnimatedHuman(file);
  const { gltf, read, positions, joints, weights, nodes, pose, vertices, reset } = rig;

  test(`${character}: new rig preserves source geometry and its rest pose`, () => {
    const bytes = fs.readFileSync(file); assert.equal(bytes.readUInt32LE(8), bytes.length);
    const source = readGlb(new URL(`../public/${character}.glb`, import.meta.url));
    assert.ok(rig.binary.subarray(0, source.binary.length).equals(source.binary), "Source geometry/textures remain byte-identical");
    assert.equal(gltf.skins[0].joints.length, 23);
    reset();
    for (const matrix of rig.palette()) assert.ok(matrix.elements.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-7));
    const rest = vertices();
    for (let i = 0; i < rest.length; i++) assert.ok(Math.abs(rest[i] - positions[i]) < 1e-7, "Skin has an unchanged bind pose");
    for (let i = 0; i < weights.length; i += 4) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        assert.ok(joints[i + k] < gltf.skins[0].joints.length);
        assert.ok(Number.isFinite(weights[i + k]) && weights[i + k] >= 0); sum += weights[i + k];
      }
      assert.ok(Math.abs(sum - 1) < 1e-6, "Normalized skin weights");
    }
  });

  test(`${character}: clips have seamless loops and reactions return to rest`, () => {
    assert.equal(gltf.animations.length, 14);
    assert.equal(new Set(gltf.animations.map(a => a.name)).size, 14);
    for (const animation of gltf.animations) {
      assert.equal(animation.channels.length, 23 * 3);
      for (const channel of animation.channels) {
        const sampler = animation.samplers[channel.sampler], times = read(sampler.input), values = read(sampler.output);
        const width = channel.target.path === "rotation" ? 4 : 3;
        assert.ok(times.every((v, i) => Number.isFinite(v) && (!i || v > times[i - 1])));
        assert.ok(values.every(Number.isFinite)); assert.equal(values.length, times.length * width);
        assert.ok(values.subarray(0, width).every((v, i) => Math.abs(v - values[values.length - width + i]) < 1e-5), `${animation.name}: continuous endpoints`);
        if (width === 4) for (let i = 0; i < values.length; i += 4) assert.ok(Math.abs(Math.hypot(...values.subarray(i, i + 4)) - 1) < 1e-6);
        if (!animation.extras.loop) {
          const node = gltf.nodes[channel.target.node];
          const rest = node[channel.target.path] ?? (width === 4 ? [0, 0, 0, 1] : channel.target.path === "scale" ? [1, 1, 1] : [0, 0, 0]);
          assert.ok(values.subarray(0, width).every((v, i) => Math.abs(v - rest[i]) < 1e-6));
        }
      }
    }
  });

  test(`${character}: arm gestures leave torso, clothes, head and legs still`, () => {
    const cut = gltf.extras.humanoidRig.armCut;
    const components = meshComponents(positions, rig.triangles, i => positions[i * 3 + 1] < cut);
    const bodyComponents = new Set();
    for (let i = 0; i < components.length; i++) if (positions[i * 3 + 1] < -0.4) bodyComponents.add(components[i]);
    const protectedVertices = [];
    for (let i = 0; i < positions.length / 3; i++) {
      const y = positions[i * 3 + 1], z = Math.abs(positions[i * 3 + 2]);
      if ((y < cut && bodyComponents.has(components[i])) || z < 0.081 || y > 0.365) protectedVertices.push(i);
    }
    assert.ok(protectedVertices.length > positions.length / 3 * 0.7);
    for (const animation of gltf.animations.filter(a => a.extras.arm_only)) {
      for (const phase of [0.12, 0.3, 0.5, 0.7, 0.88]) {
        pose(animation.name, phase); const points = vertices();
        let maxMotion = 0, armMotion = 0;
        for (const i of protectedVertices) maxMotion = Math.max(maxMotion, Math.hypot(points[i * 3] - positions[i * 3], points[i * 3 + 1] - positions[i * 3 + 1], points[i * 3 + 2] - positions[i * 3 + 2]));
        assert.ok(maxMotion < 1e-7, `${animation.name}: body moved ${maxMotion}`);
        for (let i = 0; i < points.length; i++) armMotion = Math.max(armMotion, Math.abs(points[i] - positions[i]));
        assert.ok(armMotion > 0.02, `${animation.name}: arms actually move`);
        // Single-arm greetings also preserve the entire opposite arm chain.
        if (animation.name !== "Shrug") for (const name of ["L_Clavicle", "L_Upperarm", "L_Forearm", "L_Hand"]) {
          const i = gltf.nodes.findIndex(n => n.name === name);
          assert.ok(nodes[i].quaternion.angleTo(rig.rest[i].quaternion) < 1e-7);
        }
      }
    }
  });

  test(`${character}: baked deformation has no long clothing spikes`, () => {
    let maxGrowth = 0, maxLength = 0;
    for (const animation of gltf.animations) for (const phase of [0.12, 0.3, 0.5, 0.7, 0.88]) {
      pose(animation.name, phase); const stats = rig.edgeStats(vertices());
      maxGrowth = Math.max(maxGrowth, stats.maxGrowth); maxLength = Math.max(maxLength, stats.maxLength);
    }
    console.log(`${character}: longest posed edge ${maxLength.toFixed(6)}, maximum edge growth ${maxGrowth.toFixed(6)}`);
    assert.ok(maxGrowth < 0.01, `One-meter mesh: no edge gains more than 1 cm (${maxGrowth})`);
    assert.ok(maxLength < 0.02, `No long stretched triangles (${maxLength})`);
  });

  test(`${character}: walk and jog keep support feet on the floor`, () => {
    const feet = ["L_Foot", "R_Foot"].map(name => gltf.nodes.findIndex(n => n.name === name));
    reset(); const heights = feet.map(i => nodes[i].getWorldPosition(new THREE.Vector3()).y);
    for (const name of ["Walk", "Jog"]) for (let step = 0; step < 24; step++) {
      pose(name, step / 24);
      const offsets = feet.map((i, side) => nodes[i].getWorldPosition(new THREE.Vector3()).y - heights[side]);
      assert.ok(offsets.every(y => y > -0.0005), `${name}: feet remain above floor`);
      assert.ok(offsets.some(y => Math.abs(y) < 0.0005), `${name}: at least one planted foot`);
      const root = nodes[gltf.nodes.findIndex(n => n.name === "Root")];
      assert.equal(root.position.x, 0); assert.equal(root.position.z, 0);
    }
  });
}
