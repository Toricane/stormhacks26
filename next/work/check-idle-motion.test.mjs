import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { IdleMotion } from "../lib/lifelike/idle-motion.ts";
import { readGlb, readAccessor } from "./glb-tools.mjs";

function seededRandom() {
  let seed = 74931;
  return () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 0x100000000; };
}

// Read the shipped skeletons and idle tracks without loading images or a GPU.
function asset(file, kind) {
  const { gltf, binary } = readGlb(new URL(`../public/${file}`, import.meta.url));
  const jointIndices = new Set(gltf.skins.flatMap(skin => skin.joints));
  const nodes = gltf.nodes.map((node, index) => {
    const object = jointIndices.has(index) ? new THREE.Bone() : new THREE.Object3D();
    object.name = THREE.PropertyBinding.sanitizeNodeName(node.name ?? `node_${index}`);
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
    return object;
  });
  gltf.nodes.forEach((node, index) => node.children?.forEach(child => nodes[index].add(nodes[child])));
  const root = new THREE.Group(), actor = new THREE.Group();
  for (const node of gltf.scenes[gltf.scene ?? 0].nodes) root.add(nodes[node]);
  actor.add(root); actor.rotation.y = 0.73; root.scale.setScalar(kind === "dog" ? 1.1 : 2.2);
  const animation = gltf.animations.find(clip => clip.name === "Idle");
  const tracks = animation.channels.map(channel => {
    const sampler = animation.samplers[channel.sampler], property = { rotation: "quaternion", translation: "position", scale: "scale" }[channel.target.path];
    const Track = property === "quaternion" ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    return new Track(`${nodes[channel.target.node].name}.${property}`,
      readAccessor(gltf, binary, sampler.input), readAccessor(gltf, binary, sampler.output));
  });
  const mixer = new THREE.AnimationMixer(root);
  const idle = new THREE.AnimationClip("Idle", -1, tracks);
  const motion = new IdleMotion(root, { kind, forwardYaw: kind === "pikachu" ? 0 : Math.PI / 2 }, seededRandom());
  mixer.clipAction(idle).play(); mixer.update(0);
  return { root, actor, nodes, mixer, motion, idle };
}

test("all shipped characters have bounded, changing idle motion without shifting planted feet", () => {
  for (const [file, kind] of [["keanu-animated.glb", "human"], ["lebron-animated.glb", "human"], ["Pikachu.glb", "pikachu"], ["dog-animated.glb", "dog"]]) {
    const f = asset(file, kind);
    const feet = f.nodes.filter(node => /Foot|ToeBase|tripo.*Limb_[123]/.test(node.name) && node.children.length === 0);
    assert.ok(feet.length >= 2, `${file}: test must inspect real foot joints`);
    const head = f.nodes.find(node => node.name === "Head" || node.name === "tripoHead_1");
    let mostHeadMotion = 0;
    const snapshots = [];
    for (let frame = 0; frame < 720; frame++) {
      f.motion.restore(); f.mixer.update(1 / 60); f.actor.updateMatrixWorld(true);
      const positions = feet.map(foot => foot.getWorldPosition(new THREE.Vector3()));
      const headBefore = head.getWorldQuaternion(new THREE.Quaternion());
      const bases = f.nodes.map(node => ({ q: node.quaternion.clone(), p: node.position.clone(), s: node.scale.clone() }));
      f.motion.update(1 / 60, frame * 1000 / 60, 1);
      f.actor.updateMatrixWorld(true);
      for (let index = 0; index < feet.length; index++) {
        assert.ok(feet[index].getWorldPosition(new THREE.Vector3()).distanceTo(positions[index]) < 1e-9, `${file}: ${feet[index].name} moved`);
      }
      const turn = head.getWorldQuaternion(new THREE.Quaternion()).angleTo(headBefore);
      mostHeadMotion = Math.max(mostHeadMotion, turn);
      assert.ok(turn < 0.45, `${file}: head exceeds natural idle turn bounds`);
      if (frame === 287 || frame === 575) snapshots.push(head.quaternion.clone());
      f.motion.restore();
      f.nodes.forEach((node, index) => {
        assert.deepEqual(node.quaternion.toArray(), bases[index].q.toArray(), `${file}: base rotation restoration`);
        assert.deepEqual(node.position.toArray(), bases[index].p.toArray(), `${file}: base position restoration`);
        assert.deepEqual(node.scale.toArray(), bases[index].s.toArray(), `${file}: base scale restoration`);
      });
    }
    assert.ok(mostHeadMotion > 0.04, `${file}: attention movement should be visible`);
    assert.ok(snapshots[0].angleTo(snapshots[1]) > 0.01, `${file}: idle must not repeat the 4.8 second cycle`);
  }
});

test("attention follows the visitor for both source facing axes and an arbitrarily rotated actor", () => {
  for (const yaw of [0, Math.PI / 2]) {
    const actor = new THREE.Group(), root = new THREE.Group(), neck = new THREE.Bone(), head = new THREE.Bone();
    neck.name = "Neck"; head.name = "Head"; head.position.y = 0.2;
    actor.add(root); root.add(neck); neck.add(head); actor.rotation.y = 1.1;
    // A nontrivial bind rotation catches treating model axes as bone-local axes.
    neck.rotation.z = 0.21; head.rotation.x = -0.13; actor.updateMatrixWorld(true);
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const sourceToWorld = root.getWorldQuaternion(new THREE.Quaternion());
    const worldForward = forward.clone().applyQuaternion(sourceToWorld);
    const headForward = worldForward.clone().applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()).invert());
    const desired = worldForward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.25);
    const target = head.getWorldPosition(new THREE.Vector3()).addScaledVector(desired, 3);
    const motion = new IdleMotion(root, { kind: "human", forwardYaw: yaw }, () => 0.5);
    for (let frame = 0; frame < 240; frame++) motion.update(1 / 60, frame * 1000 / 60, 1, target);
    const gaze = headForward.applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
    assert.ok(gaze.angleTo(desired) < 0.06, `facing ${yaw}: gaze should converge toward the visitor`);
    motion.reset();
    assert.ok(head.quaternion.angleTo(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.13, 0, 0))) < 1e-7);
  }
});

test("Pikachu's sanitized arm, ear and ear-tip names all receive the procedural layer", () => {
  const f = asset("Pikachu.glb", "pikachu");
  const names = ["ArmL", "ArmR", "EarL", "EarR", "EarTipL", "EarTipR"];
  const bones = names.map(name => f.nodes.find(node => node.name === name));
  assert.ok(bones.every(Boolean), "the fixture must use the names emitted by GLTFLoader");
  const maximumTurns = bones.map(() => 0);
  for (let frame = 0; frame < 420; frame++) {
    f.motion.restore(); f.mixer.update(1 / 60);
    const before = bones.map(bone => bone.quaternion.clone());
    f.motion.update(1 / 60, frame * 1000 / 60, 1);
    bones.forEach((bone, index) => {
      maximumTurns[index] = Math.max(maximumTurns[index], bone.quaternion.angleTo(before[index]));
    });
  }
  maximumTurns.forEach((angle, index) => assert.ok(angle > 0.002, `${names[index]} must participate in the idle layer`));
});

test("untracked bones do not accumulate offsets and an action fades back to its exact mixer pose", () => {
  const root = new THREE.Group(), chest = new THREE.Bone(), head = new THREE.Bone();
  chest.name = "Chest"; head.name = "Head"; head.position.y = 0.4;
  root.add(chest); chest.add(head);
  const motion = new IdleMotion(root, { kind: "human", forwardYaw: Math.PI / 2 }, seededRandom());
  const mixer = new THREE.AnimationMixer(root);
  const clip = new THREE.AnimationClip("Partial idle", 2, [new THREE.NumberKeyframeTrack("Chest.position[y]", [0, 1, 2], [0, 0.01, 0])]);
  mixer.clipAction(clip).play();
  for (let frame = 0; frame < 1800; frame++) {
    motion.restore(); mixer.update(1 / 60);
    assert.deepEqual(head.quaternion.toArray(), [0, 0, 0, 1]);
    assert.deepEqual(head.scale.toArray(), [1, 1, 1]);
    motion.update(1 / 60, frame * 1000 / 60, frame < 1500 ? 1 : 0);
  }
  assert.deepEqual(head.quaternion.toArray(), [0, 0, 0, 1]);
  assert.deepEqual(chest.scale.toArray(), [1, 1, 1]);
  motion.reset(); assert.equal(head.position.y, 0.4);
});

test("skeletons without supported upper-body bones and invalid frame deltas remain safe", () => {
  const root = new THREE.Group(), leg = new THREE.Bone();
  leg.name = "Foot"; root.add(leg);
  const motion = new IdleMotion(root, { kind: "generic", forwardYaw: 0 });
  motion.update(NaN, 0, 1); motion.update(-1, 1, 1); motion.update(1 / 60, 2, 1); motion.reset();
  assert.deepEqual(leg.quaternion.toArray(), [0, 0, 0, 1]);
});
