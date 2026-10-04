import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { CreatureAnimationPlayer, describeAnimation } from "../lib/creature-animation-player.ts";

const oneShot = new THREE.AnimationClip("Wave", 1, [new THREE.NumberKeyframeTrack(".position[x]", [0, 0.5, 1], [0, 1, 0])]);
oneShot.userData = { loop: false, description: "Wave once", in_place: true };
const idle = new THREE.AnimationClip("Idle", 2, [new THREE.NumberKeyframeTrack(".position[x]", [0, 1, 2], [0, -1, 0])]);
idle.userData = { loop: true };

test("one-shots finish at rest and can be replayed", () => {
  const root = new THREE.Object3D();
  const player = new CreatureAnimationPlayer(root, [oneShot]);
  player.play("Wave", 0); player.update(0.5);
  assert.equal(root.position.x, 1);
  player.update(1.2); assert.equal(root.position.x, 0);
  assert.equal(player.mixer.clipAction(oneShot).paused, true);
  player.play("Wave", 0); player.update(0.5);
  assert.equal(root.position.x, 1);
  player.dispose();
});

test("loops, pause, speed, and rest-pose reset work", () => {
  const root = new THREE.Object3D();
  const player = new CreatureAnimationPlayer(root, [idle]);
  player.play("Idle", 0); player.update(2.5);
  assert.equal(root.position.x, -0.5);
  player.setPlayback(false, 1); player.update(0.4);
  assert.equal(root.position.x, -0.5);
  player.setPlayback(true, 2); player.update(0.25);
  assert.equal(root.position.x, -1);
  player.stop(); assert.equal(root.position.x, 0);
  assert.equal(player.play("Missing clip"), false);
  player.dispose();
});

test("crossfades retire outgoing actions even after rapid selection and replay", () => {
  const root = new THREE.Object3D();
  const player = new CreatureAnimationPlayer(root, [idle, oneShot]);
  player.play("Idle", 0); player.update(0.5);
  player.play("Wave");
  assert.equal(root.position.x, -0.5, "Selection starts from the preceding pose");
  player.update(0.05); player.play("Idle");
  player.update(0.05); player.play("Wave");
  player.update(0.3);
  assert.equal(player.mixer.clipAction(idle).isScheduled(), false);
  assert.equal(player.mixer.clipAction(oneShot).getEffectiveWeight(), 1);
  player.play("Idle"); player.update(0.03); player.play("Idle", 0);
  assert.equal(player.mixer.clipAction(oneShot).isScheduled(), false);
  player.dispose();
});

test("clip metadata defaults preserve uploaded animation playback", () => {
  assert.equal(describeAnimation(new THREE.AnimationClip("Uploaded", 1, [])).loop, true);
  assert.equal(describeAnimation(oneShot).loop, false);
  assert.equal(describeAnimation(oneShot).inPlace, true);
});

for (const file of ["Pikachu.glb", "dog-animated.glb"]) {
  test(`${file}: valid embedded motion, seamless loops, original mesh data`, () => {
    const bytes = fs.readFileSync(new URL(`../public/${file}`, import.meta.url));
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    const jsonLength = bytes.readUInt32LE(12);
    const gltf = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
    const binary = bytes.subarray(28 + jsonLength);
    const source = gltf.extras.creatureAnimationSource;
    assert.ok(source.binaryLength < gltf.buffers[0].byteLength);
    assert.equal(new Set(gltf.animations.map(clip => clip.name)).size, gltf.animations.length);
    const values = index => {
      const accessor = gltf.accessors[index], view = gltf.bufferViews[accessor.bufferView];
      const width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[accessor.type];
      const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      assert.ok(offset + accessor.count * width * 4 <= gltf.buffers[0].byteLength);
      return Array.from(new Float32Array(binary.buffer, binary.byteOffset + offset, accessor.count * width));
    };
    for (const animation of gltf.animations) {
      for (const channel of animation.channels) {
        const sampler = animation.samplers[channel.sampler];
        const times = values(sampler.input), output = values(sampler.output);
        assert.ok(times.every((time, i) => Number.isFinite(time) && (!i || time > times[i - 1])));
        assert.ok(output.every(Number.isFinite));
        const width = channel.target.path === "rotation" ? 4 : 3;
        assert.equal(output.length, times.length * width);
        if (channel.target.path === "rotation") {
          for (let i = 0; i < output.length; i += 4) {
            assert.ok(Math.abs(Math.hypot(...output.slice(i, i + 4)) - 1) < 0.00001, `${animation.name}: unit quaternion`);
          }
        }
        if (animation.extras?.loop) {
          assert.ok(output.slice(0, width).every((value, i) => Math.abs(value - output[output.length - width + i]) < 0.00001), `${animation.name}: seamless loop`);
        }
      }
      if (animation.extras?.generator) assert.equal(animation.channels.length, gltf.skins[0].joints.length * 3);
    }
    // Geometry/skin accessors and texture bufferViews must still use the original prefix.
    const meshAccessors = gltf.meshes.flatMap(mesh => mesh.primitives.flatMap(primitive => [...Object.values(primitive.attributes), primitive.indices].filter(index => index !== undefined)));
    for (const index of [...meshAccessors, ...gltf.skins.map(skin => skin.inverseBindMatrices)]) {
      assert.ok(index < source.accessorCount);
    }
    for (const image of gltf.images) assert.ok(image.bufferView < source.bufferViewCount);
  });
}
