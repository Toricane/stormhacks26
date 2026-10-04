import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { CharacterAnimationPlayer, describeAnimation } from "../lib/character-animation-player.ts";
import { LifelikeController, characterProfile } from "../lib/lifelike/controller.ts";
import { readGlb } from "./glb-tools.mjs";

const viewport = { width: 880, height: 420, videoWidth: 640, videoHeight: 480 };
const assets = [
  { file: "Pikachu.glb" },
  { file: "dog-animated.glb" },
  { file: "keanu-animated.glb", height: 1.72 },
  { file: "lebron-animated.glb", height: 2.06 },
];

async function loadGeometry(file) {
  const { gltf, binary } = readGlb(new URL(`../public/${file}`, import.meta.url));
  // Keep the actual mesh, bind matrices, hierarchy and animation. Only omit
  // textures so GLTFLoader can load the production asset without a browser.
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  gltf.materials = []; gltf.images = []; gltf.textures = [];
  const jsonBytes = Buffer.from(JSON.stringify(gltf));
  const json = Buffer.concat([jsonBytes, Buffer.alloc((4 - jsonBytes.length % 4) % 4, 32)]);
  const header = Buffer.alloc(20), binaryHeader = Buffer.alloc(8);
  header.write("glTF"); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + json.length + binary.length, 8);
  header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  binaryHeader.writeUInt32LE(binary.length); binaryHeader.writeUInt32LE(0x004e4942, 4);
  const bytes = Buffer.concat([header, json, binaryHeader, binary]);
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
}

function weightedHeadBounds(root) {
  const headSurface = new THREE.Box3(), point = new THREE.Vector3();
  root.traverse(object => {
    if (!object.isSkinnedMesh) return;
    object.skeleton.update();
    const indices = object.geometry.attributes.skinIndex, weights = object.geometry.attributes.skinWeight;
    for (let i = 0; i < indices.count; i++) {
      let headWeight = 0;
      for (let j = 0; j < 4; j++) {
        const name = object.skeleton.bones[indices.getComponent(i, j)].name;
        if (["Head", "tripoHead_1", "tripoHead_2"].includes(name)) headWeight += weights.getComponent(i, j);
      }
      if (headWeight > 0.5) headSurface.expandByPoint(object.getVertexPosition(i, point).applyMatrix4(object.matrixWorld));
    }
  });
  return headSurface;
}

function fixture(asset, model, far = false) {
  const actor = new THREE.Group(), group = new THREE.Group(), root = clone(model.scene);
  group.add(root); actor.add(group); actor.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const dimensions = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  // Match the production First person/Lifelike scale and ground placement.
  const scale = asset.height === undefined ? 1.2 / Math.max(dimensions.x, dimensions.y, dimensions.z) : asset.height / dimensions.y;
  group.scale.setScalar(scale);
  group.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  const bones = [];
  root.traverse(object => { if (object.isBone) bones.push(object); });
  const profile = characterProfile(asset.file, bones), human = profile.kind === "human";
  const distance = far ? 3 : human ? 0.95 : 0.8;
  const camera = new THREE.PerspectiveCamera(65, viewport.width / viewport.height, 0.05, 150);
  camera.position.set(human ? distance : 0, 1.6, human ? 0 : distance);
  camera.lookAt(0, human ? 1.6 : 0.6, 0); camera.updateMatrixWorld(true);
  // Summoned actors face the camera, including the dog's +X forward axis.
  actor.rotation.y = (human ? Math.PI / 2 : 0) - profile.forwardYaw;
  actor.updateMatrixWorld(true);
  const headSurface = weightedHeadBounds(root);
  assert.equal(headSurface.isEmpty(), false, `${asset.file}: real head vertices are required`);
  const player = new CharacterAnimationPlayer(root, model.animations);
  const controller = new LifelikeController({ actor, root, camera, player,
    animations: model.animations.map(describeAnimation), profile, random: () => 0.5 });
  controller.activate(0);
  return { actor, root, camera, controller, player, headSurface };
}

function strokeAt(point, camera, reach = 0) {
  const projected = point.clone().project(camera);
  const x = (projected.x + 1) * viewport.width / 2, y = (1 - projected.y) * viewport.height / 2;
  const world = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  world[0].y = 0.08;
  for (let finger = 0; finger < 4; finger++) for (let joint = 0; joint < 4; joint++) {
    world[5 + finger * 4 + joint] = { x: (finger - 1.5) * 0.02, y: [0, -0.03, -0.055, -0.08][joint], z: 0 };
  }
  for (let i = 1; i <= 4; i++) world[i] = { x: -0.05 - i * 0.01, y: 0.06 - i * 0.02, z: 0 };
  return { id: 1, label: "Left", world,
    points: world.map(p => ({ x: x - p.y * 650, y: y + p.x * 650 })),
    palm: { x, y }, pinchPoint: { x, y }, pose: "open", closed: false,
    velocity: { x: 120, y: 0 }, growth: 0, pxPerMeter: 650, reach, size: 52, stale: false, presence: 1 };
}

for (const asset of assets) {
  const model = await loadGeometry(asset.file);
  for (const crown of [false, true]) {
    test(`${asset.file}: a stroke on the actual ${crown ? "crown" : "head"} pets at the summon stop without depth calibration`, () => {
      const f = fixture(asset, model);
      try {
        const point = f.headSurface.getCenter(new THREE.Vector3());
        if (crown) point.y = f.headSurface.max.y;
        const hand = strokeAt(point, f.camera);
        const action = f.controller.update(0.033, 33, { hands: [hand], viewport, sampleTime: 33 });
        assert.match(action, /Enjoying a pet$/, `${asset.file}: ${action}, surface point ${point.toArray()}`);
      } finally { f.player.dispose(); }
    });
  }
  test(`${asset.file}: screen overlap at three meters cannot pet even at maximum reach`, () => {
    const f = fixture(asset, model, true);
    try {
      const point = f.headSurface.getCenter(new THREE.Vector3());
      const hand = strokeAt(point, f.camera, 0.45);
      const action = f.controller.update(0.033, 33, { hands: [hand], viewport, sampleTime: 33 });
      assert.doesNotMatch(action, /Enjoying a pet/);
    } finally { f.player.dispose(); }
  });
  if (asset.height === undefined) for (const followApproach of [true, false]) {
    test(`${asset.file}: beckoning ${followApproach ? "keeps its real head in view" : "preserves manual camera control"} during approach`, () => {
      const f = fixture(asset, model, true);
      try {
        // Match the initial viewer exactly, before the dog turns toward us.
        f.actor.rotation.y = 0; f.actor.updateMatrixWorld(true);
        const startingRotation = f.camera.quaternion.clone(), startingPosition = f.camera.position.clone();
        const startingAngles = new THREE.Euler().setFromQuaternion(startingRotation, "YXZ");
        const open = strokeAt(new THREE.Vector3(0, 0.8, 0), f.camera);
        open.velocity.x = 0;
        const curled = { ...open, pose: "fist", closed: true, world: open.world.map(point => ({ ...point })) };
        for (let finger = 0; finger < 4; finger++) for (let joint = 0; joint < 4; joint++) {
          curled.world[5 + finger * 4 + joint].y = [0, -0.025, 0, 0.025][joint];
        }
        const update = (time, hands) => {
          f.controller.beforeAnimationUpdate();
          f.player.update(0.033);
          return f.controller.update(0.033, time, { hands, viewport, sampleTime: time }, followApproach);
        };
        for (let time = 0; time < 165; time += 33) update(time, [open]);
        let action = update(165, [curled]);
        assert.match(action, /Walking over$/);
        for (let time = 198; time < 7000 && /Walking over$/.test(action); time += 33) action = update(time, []);
        assert.match(action, /Idle$/, "The approach finishes before its timeout");
        assert.ok(Math.abs(f.actor.position.z - 2.2) < 0.01, "The character reaches its nearby stop");
        assert.equal(f.camera.position.distanceTo(startingPosition), 0, "Following does not move the viewer");
        if (followApproach) {
          const finalAngles = new THREE.Euler().setFromQuaternion(f.camera.quaternion, "YXZ");
          assert.ok(finalAngles.x < startingAngles.x - 0.25, "The camera looks down as the creature gets close");
          assert.ok(Math.abs(finalAngles.y - startingAngles.y) < 1e-10, "Following preserves yaw");
          assert.ok(Math.abs(finalAngles.z - startingAngles.z) < 1e-10, "Following preserves roll");
          f.camera.updateMatrixWorld(true); f.actor.updateMatrixWorld(true);
          const projected = weightedHeadBounds(f.root).getCenter(new THREE.Vector3()).project(f.camera);
          assert.ok(projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 0.9 && Math.abs(projected.y) < 0.9,
            `The animated head remains comfortably inside the viewport: ${projected.toArray()}`);
        } else {
          assert.ok(f.camera.quaternion.angleTo(startingRotation) < 1e-7, "Pointer-locked/manual viewing is never redirected");
        }
      } finally { f.controller.deactivate(); f.player.dispose(); }
    });
  }
}
