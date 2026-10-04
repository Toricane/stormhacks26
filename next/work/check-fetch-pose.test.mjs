import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { FetchCharacterPose } from "../lib/fetch/character-pose.ts";
import { readGlb, readAccessor } from "./glb-tools.mjs";

const ASSETS = [
  ["keanu-animated.glb", "human", 1.8, -0.5],
  ["lebron-animated.glb", "human", 2.06, -0.5],
  ["Pikachu.glb", "pikachu", 1.2 / 1.902332, -0.952179],
  ["dog-animated.glb", "dog", 1.2, 0],
];

// Read real hierarchy/bind rotations and animation tracks, without decoding the
// large textures or creating a renderer. These are GLTFLoader's sanitized names.
function asset([file, kind, scale, floor]) {
  const { gltf, binary } = readGlb(new URL(`../public/${file}`, import.meta.url));
  const indices = new Set(gltf.skins.flatMap(skin => skin.joints));
  const nodes = gltf.nodes.map((node, i) => {
    const object = indices.has(i) ? new THREE.Bone() : new THREE.Object3D();
    object.name = THREE.PropertyBinding.sanitizeNodeName(node.name ?? `node_${i}`);
    if (node.matrix) new THREE.Matrix4().fromArray(node.matrix).decompose(object.position, object.quaternion, object.scale);
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
    return object;
  });
  gltf.nodes.forEach((node, i) => node.children?.forEach(child => nodes[i].add(nodes[child])));
  const root = new THREE.Group(), actor = new THREE.Group();
  gltf.scenes[gltf.scene ?? 0].nodes.forEach(i => root.add(nodes[i]));
  actor.add(root);
  const profile = { kind, name: file, forwardYaw: kind === "pikachu" ? 0 : Math.PI / 2 };
  const pose = new FetchCharacterPose(root, profile);
  // The production viewer normalizes only after constructing its controllers.
  root.scale.setScalar(scale); root.position.y = -floor * scale;
  actor.position.set(2, 0, -1); actor.rotation.y = 0.73; actor.updateMatrixWorld(true);
  const feet = nodes.filter(node => /Foot|ToeBase|tripo.*Limb_[123]/.test(node.name) && node.children.length === 0);
  assert.ok(feet.length >= 2, `${file}: inspect real foot joints`);
  const animation = gltf.animations.find(clip => clip.name === "Walk");
  const tracks = animation.channels.map(channel => {
    const sampler = animation.samplers[channel.sampler];
    const property = { rotation: "quaternion", translation: "position", scale: "scale" }[channel.target.path];
    const Track = property === "quaternion" ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    return new Track(`${nodes[channel.target.node].name}.${property}`, readAccessor(gltf, binary, sampler.input), readAccessor(gltf, binary, sampler.output));
  });
  const mixer = new THREE.AnimationMixer(root);
  const clip = new THREE.AnimationClip("Walk", -1, tracks);
  return { root, actor, profile, pose, nodes, feet, mixer, clip, gltf, binary, file, scale };
}

test("all four ball sockets are calibrated against the shipped hand or mouth surface", () => {
  for (const spec of ASSETS) {
    const f = asset(spec);
    const contactPose = new FetchCharacterPose(f.root, f.profile, 0);
    const local = f.root.worldToLocal(contactPose.socket(new THREE.Vector3()));
    const positions = readAccessor(f.gltf, f.binary, f.gltf.meshes[0].primitives[0].attributes.POSITION);
    let nearest = Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      nearest = Math.min(nearest, Math.hypot(positions[i] - local.x, positions[i + 1] - local.y, positions[i + 2] - local.z));
    }
    assert.ok(nearest < 0.015, `${f.file}: socket must touch the visible mesh, got ${nearest}`);
    assert.equal(f.pose.holdingPart, f.profile.kind === "human" ? "hand" : "mouth");
    const withBall = f.pose.socket(new THREE.Vector3());
    assert.ok(Math.abs(withBall.distanceTo(contactPose.socket(new THREE.Vector3())) - 0.09 * 0.65) < 1e-7);
    assert.ok(f.pose.pickupReach() > 0.25 && f.pose.pickupReach() < 0.8);
  }
});

test("pickup visibly reaches down, keeps all planted feet, and ends in the carry pose", () => {
  for (const spec of ASSETS) {
    const f = asset(spec), points = f.feet.map(foot => foot.getWorldPosition(new THREE.Vector3()));
    const initial = f.pose.socket(new THREE.Vector3());
    f.pose.apply("pickup", 0.5, 1 / 60); f.actor.updateMatrixWorld(true);
    const pickup = f.pose.socket(new THREE.Vector3());
    assert.ok(pickup.y < initial.y - 0.18, `${f.file}: visible reach downward: ${initial.y} -> ${pickup.y}`);
    assert.ok(pickup.y > -0.04 && pickup.y < 0.22, `${f.file}: ball reaches near the floor, got ${pickup.y}`);
    f.feet.forEach((foot, i) => assert.ok(foot.getWorldPosition(new THREE.Vector3()).distanceTo(points[i]) < 1e-5,
      `${f.file}: ${foot.name} remains planted`));
    f.pose.apply("pickup", 1, 1 / 60); const finished = f.pose.socket(new THREE.Vector3());
    f.pose.apply("carry", 0, 1 / 60);
    assert.ok(finished.distanceTo(f.pose.socket(new THREE.Vector3())) < 1e-7, `${f.file}: no socket pop when beginning return`);
    f.pose.apply("offer", 1, 1 / 60);
    const offered = f.pose.socket(new THREE.Vector3());
    assert.ok(offered.toArray().every(Number.isFinite));
    if (f.profile.kind === "human") {
      const direction = new THREE.Vector3(Math.sin(f.profile.forwardYaw), 0, Math.cos(f.profile.forwardYaw))
        .applyQuaternion(f.root.getWorldQuaternion(new THREE.Quaternion()));
      assert.ok(offered.clone().sub(finished).dot(direction) > 0.12, `${f.file}: hand extends toward visitor`);
    }
  }
});

test("restoration is exact and runtime fetch cannot accumulate into locomotion", () => {
  for (const spec of ASSETS) {
    const f = asset(spec); f.mixer.clipAction(f.clip).play();
    for (let frame = 0; frame < 240; frame++) {
      f.pose.restore(); f.mixer.update(1 / 60); f.actor.updateMatrixWorld(true);
      const before = f.nodes.map(node => ({ q: node.quaternion.toArray(), p: node.position.toArray(), s: node.scale.toArray() }));
      const feet = f.feet.map(foot => foot.getWorldPosition(new THREE.Vector3()));
      const phase = frame < 80 ? "pickup" : frame < 160 ? "carry" : "offer";
      f.pose.apply(phase, (frame % 80) / 79, 1 / 60);
      f.actor.updateMatrixWorld(true);
      assert.ok(f.pose.socket(new THREE.Vector3()).toArray().every(Number.isFinite), `${f.file}: finite animated socket`);
      f.feet.forEach((foot, i) => assert.ok(foot.getWorldPosition(new THREE.Vector3()).distanceTo(feet[i]) < 1e-5,
        `${f.file}: overlay must preserve current gait foot at frame ${frame}`));
      f.pose.reset();
      f.nodes.forEach((node, i) => {
        assert.deepEqual(node.quaternion.toArray(), before[i].q);
        assert.deepEqual(node.position.toArray(), before[i].p);
        assert.deepEqual(node.scale.toArray(), before[i].s);
      });
    }
  }
});

test("socket follows later actor translation, rotation and uniform model rescaling", () => {
  for (const spec of ASSETS) {
    const f = asset(spec);
    f.pose.apply("carry", 1, 1 / 60);
    const initial = f.actor.worldToLocal(f.pose.socket(new THREE.Vector3()));
    f.actor.position.set(-3, 0, 4); f.actor.rotation.y = -1.4; f.actor.updateMatrixWorld(true);
    assert.ok(f.actor.worldToLocal(f.pose.socket(new THREE.Vector3())).distanceTo(initial) < 1e-7);
    const reach = f.pose.pickupReach(); f.root.scale.multiplyScalar(1.7);
    assert.ok(Math.abs(f.pose.pickupReach() / reach - 1.7) < 1e-7);
    assert.ok(f.pose.socket(new THREE.Vector3()).toArray().every(Number.isFinite));
  }
});

test("unknown models, missing arms, and invalid inputs remain safe", () => {
  const root = new THREE.Group();
  const pose = new FetchCharacterPose(root, { kind: "generic", name: "Unknown", forwardYaw: 0 });
  pose.apply("pickup", NaN, 0.1); pose.apply("carry", 1, -1); pose.apply("carry", 1, 1 / 60);
  assert.ok(pose.socket(new THREE.Vector3()).toArray().every(Number.isFinite));
  pose.reset(); assert.deepEqual(root.position.toArray(), [0, 0, 0]);
});
