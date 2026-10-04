import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { CharacterAnimationPlayer, describeAnimation } from "../lib/character-animation-player.ts";
import { characterProfile } from "../lib/lifelike/controller.ts";
import { CollisionWorld, PLAYER_RADIUS } from "../lib/environments/collision-world.ts";
import { loungeSpawns } from "../lib/environments/study-lounge.ts";
import { FetchController } from "../lib/fetch/controller.ts";
import { ThrowSamples, gripPosition, liveHands } from "../lib/fetch/hand-ball.ts";
import { readGlb, readAccessor } from "./glb-tools.mjs";

const viewport = { width: 960, height: 640, videoWidth: 640, videoHeight: 480 };
const STEP = 1 / 60;

function trackedHand(camera, local = new THREE.Vector3(.15, -.15, -.9), overrides = {}) {
  camera.updateMatrixWorld(true);
  const position = local.clone().applyMatrix4(camera.matrixWorld);
  const projected = position.clone().project(camera);
  const point = { x: (projected.x + 1) * viewport.width / 2, y: (1 - projected.y) * viewport.height / 2 };
  return { id: 1, label: "Right", points: Array.from({ length: 21 }, () => ({ ...point })),
    world: Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 })),
    pose: "pinch", closed: true, palm: point, pinchPoint: point, velocity: { x: 0, y: 0 },
    growth: 0, pxPerMeter: 600, reach: (local.length() - .8) / 4, size: 50, stale: false, presence: 1, ...overrides };
}

function handAt(f, worldPoint, overrides = {}) {
  const local = f.camera.worldToLocal(worldPoint.clone());
  assert.ok(local.length() >= .25 && local.length() <= 2.2, `offered ball must be within calibrated reach (${local.length()})`);
  return trackedHand(f.camera, local, overrides);
}

function frame(hands, sampleTime) { return { hands, viewport, sampleTime }; }

function fixture(model, asset = { file: "generic.glb" }) {
  const scene = new THREE.Scene(), actor = new THREE.Group(), group = new THREE.Group();
  const root = model ? clone(model.scene) : new THREE.Group();
  if (!model) root.add(new THREE.Mesh(new THREE.BoxGeometry(.35, .8, .35), new THREE.MeshBasicMaterial()));
  group.add(root); actor.add(group); scene.add(actor); scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  const scale = asset.height === undefined ? 1.2 / Math.max(size.x, size.y, size.z) : asset.height / size.y;
  group.scale.setScalar(scale); group.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  const camera = new THREE.PerspectiveCamera(65, viewport.width / viewport.height, .05, 150);
  camera.position.set(0, 1.6, 3); camera.lookAt(0, 1, 0); camera.updateMatrixWorld(true);
  const bones = []; root.traverse(object => { if (object.isBone) bones.push(object); });
  const profile = characterProfile(asset.file, bones);
  const clips = model?.animations ?? ["Idle", "Walk", "Jog"].map(name => new THREE.AnimationClip(name, 1, []));
  const player = new CharacterAnimationPlayer(root, clips);
  const control = { taken: 0, released: 0 };
  const controller = new FetchController({ scene, actor, root, camera, player,
    animations: clips.map(describeAnimation), profile,
    onTakeControl: () => { control.taken++; player.stop(); }, onReleaseControl: () => { control.released++; } });
  const radius = Math.max(.3, Math.hypot(size.x, size.z) * scale * .5 + .05);
  controller.setWorld(new CollisionWorld(), radius);
  const f = { scene, actor, root, camera, player, controller, control, profile, radius, now: 0, label: "" };
  f.tick = (hands = [], sampleTime) => {
    f.now += STEP * 1000;
    controller.beforeAnimationUpdate(); player.update(STEP);
    f.label = controller.update(STEP, f.now, hands === null ? null : frame(hands, sampleTime ?? f.now));
    return controller.state;
  };
  f.until = (state, seconds = 30, inspect) => {
    const visited = new Set([controller.state]);
    for (let i = 0; i < seconds / STEP && controller.state !== state; i++) {
      f.tick(); visited.add(controller.state); inspect?.();
    }
    assert.equal(controller.state, state, `expected ${state}; got ${controller.state}: ${f.label}`);
    return visited;
  };
  f.dispose = () => { controller.dispose(); player.dispose(); };
  return f;
}

function toss(f) {
  const hand = trackedHand(f.camera, new THREE.Vector3(.1, -.12, -.7));
  f.controller.recall(frame([hand], f.now), f.now);
  f.tick([hand]);
  f.tick([trackedHand(f.camera, new THREE.Vector3(.1, -.12, -.76))]);
  f.tick([trackedHand(f.camera, new THREE.Vector3(.1, -.12, -.82), { pose: "open", closed: false })]);
  assert.equal(f.controller.state, "flying");
}

function room(obstacle) {
  const width = 60, depth = 60, cellSize = .2, minX = -6, minZ = -6;
  const walkable = Array.from({ length: width * depth }, (_, index) => {
    const x = index % width, z = Math.floor(index / width);
    return x > 0 && z > 0 && x < width - 1 && z < depth - 1 && !obstacle(minX + (x + .5) * cellSize, minZ + (z + .5) * cellSize) ? "1" : "0";
  }).join("");
  return new CollisionWorld({ version: 1, width, depth, cellSize, minX, minZ, walkable,
    floorHeights: Array(width * depth).fill(0), transform: new THREE.Matrix4().toArray(),
    spawn: { player: [0, 0, 3], subject: [0, 0, 0], lookDirection: [0, 0, -1] } });
}

test("grips use mirrored screen coordinates, finite reach, and only fresh reliable hand frames", () => {
  const camera = new THREE.PerspectiveCamera(65, viewport.width / viewport.height, .05, 150);
  camera.updateMatrixWorld(true);
  const hand = trackedHand(camera, new THREE.Vector3(.2, -.1, -1));
  assert.ok(gripPosition(hand, frame([hand], 100), camera, new THREE.Vector3()).distanceTo(new THREE.Vector3(.2, -.1, -1)) < 1e-9);
  assert.equal(liveHands(frame([hand], 100), 320).length, 1);
  assert.equal(liveHands(frame([hand], 100), 321).length, 0);
  assert.equal(liveHands(frame([{ ...hand, stale: true }, { ...hand, presence: .2 }], 100), 100).length, 0);
  assert.equal(liveHands({ ...frame([hand], 100), viewport: { ...viewport, width: 0 } }, 100).length, 0);
  assert.equal(liveHands(null, 100).length, 0);
  assert.ok(Math.abs(gripPosition({ ...hand, reach: 100 }, frame([hand], 100), camera, new THREE.Vector3()).length() - 2.2) < 1e-9);
});

test("throw velocity follows the camera-local hand motion and is capped without deriving force from walking or looking", () => {
  const camera = new THREE.PerspectiveCamera(), samples = new ThrowSamples(), out = new THREE.Vector3();
  const local = new THREE.Vector3(.2, -.2, -.8);
  camera.updateMatrixWorld(true); samples.add(100, camera.localToWorld(local.clone()), camera);
  camera.position.set(3, 1, -4); camera.rotation.y = .8; camera.updateMatrixWorld(true);
  samples.add(180, camera.localToWorld(local.clone()), camera);
  assert.ok(samples.velocity(camera, out).length() < 1e-10, "moving the viewer with a still hand must not fling the ball");
  samples.clear();
  samples.add(200, camera.localToWorld(local.clone()), camera);
  samples.add(280, camera.localToWorld(local.clone().add(new THREE.Vector3(.08, .12, -.4))), camera);
  const cameraLocal = samples.velocity(camera, out).clone().applyQuaternion(camera.quaternion.clone().invert());
  assert.ok(cameraLocal.x > 0 && cameraLocal.y > 0 && cameraLocal.z < 0, "right/up/forward hand movement must preserve all three throw directions");
  samples.add(281, camera.localToWorld(new THREE.Vector3(50, 0, 0)), camera);
  assert.ok(samples.velocity(camera, out).length() <= 12 + 1e-9);
  samples.clear(); samples.add(500, local, camera); samples.add(500, local.clone().addScalar(20), camera);
  assert.equal(samples.velocity(camera, out).length(), 0, "duplicate samples do not invent throw force");
});

test("B summons one ball at the tracked grip, or at a stable camera-relative fallback", () => {
  const f = fixture();
  try {
    const hand = trackedHand(f.camera);
    f.controller.recall(frame([hand], 0), 0);
    assert.equal(f.controller.state, "held"); assert.equal(f.controller.ball.visible, true);
    assert.ok(f.controller.ball.position.distanceTo(gripPosition(hand, frame([hand], 0), f.camera, new THREE.Vector3())) < 1e-9);
    f.controller.recall(null, 20);
    f.camera.position.x += 2; f.tick(null);
    assert.ok(f.controller.ball.position.distanceTo(f.camera.localToWorld(new THREE.Vector3(.22, -.18, -.7))) < 1e-9);
    assert.equal(f.scene.children.filter(object => object.name === "Fetch ball").length, 1);
    assert.equal(f.control.taken, 2);
  } finally { f.dispose(); }
});

test("pinch-and-release launches forward, while tracking loss and frozen video never release a held ball", () => {
  const f = fixture();
  try {
    toss(f);
    const cameraVelocity = f.controller.physics.velocity.clone().applyQuaternion(f.camera.quaternion.clone().invert());
    assert.ok(cameraVelocity.z < -3, `throw must leave the hand forward: ${cameraVelocity.toArray()}`);
    assert.ok(f.controller.physics.velocity.length() <= 12.2);
    f.controller.recall(null, f.now);
    const closed = trackedHand(f.camera), opened = { ...closed, pose: "open", closed: false };
    const frozenAt = f.now;
    f.tick([closed], frozenAt);
    for (let i = 0; i < 10; i++) f.tick([opened], frozenAt);
    assert.equal(f.controller.state, "held", "changing an object inside a duplicate frame cannot throw");
    f.now += 300; f.tick([closed], frozenAt);
    assert.equal(f.controller.state, "held", "an expired frame cannot throw");
    f.tick([opened]);
    assert.equal(f.controller.state, "held", "tracking reacquisition in an open pose cannot throw");
    f.tick([closed]); f.tick(null); f.tick([opened]);
    assert.equal(f.controller.state, "held", "explicit tracking loss disarms release");
    f.tick([closed]); f.tick([opened]);
    assert.equal(f.controller.state, "flying", "a fresh close/open after recovery can throw again");
  } finally { f.dispose(); }
});

for (const interrupted of ["flying", "retrieving", "pickup", "returning", "offered"]) {
  test(`B immediately cancels ${interrupted}, and C releases control without leaving delayed fetch actions`, () => {
    const f = fixture();
    try {
      toss(f); f.until(interrupted);
      f.controller.recall(null, f.now);
      const stopped = f.actor.position.clone();
      assert.equal(f.controller.state, "held"); assert.equal(f.controller.physics.velocity.length(), 0);
      for (let i = 0; i < 300; i++) f.tick(null);
      assert.equal(f.controller.state, "held"); assert.ok(f.actor.position.distanceTo(stopped) < 1e-9);
      assert.equal(f.control.released, 0);
      f.controller.clear();
      assert.equal(f.controller.state, "absent"); assert.equal(f.controller.active, false); assert.equal(f.controller.ball.visible, false);
      assert.equal(f.control.released, 1); assert.equal(f.controller.physics.velocity.length(), 0);
      for (let i = 0; i < 30; i++) assert.equal(f.tick(), "absent");
      f.controller.clear(); assert.equal(f.control.released, 1, "clearing twice must not resume the prior controller twice");
      f.controller.recall(null, f.now); assert.equal(f.controller.state, "held"); assert.equal(f.controller.ball.visible, true);
    } finally { f.dispose(); }
  });
}

test("fetch navigation goes around furniture, keeps body clearance, and returns without crossing the viewer", () => {
  const f = fixture(), world = room((x, z) => Math.abs(x) < 1.2 && z > -1.2 && z < -.8);
  try {
    f.controller.setWorld(world, .3); toss(f);
    // A valid resting throw across a table exercises routing independently of drag and bounce timing.
    f.controller.physics.throw(new THREE.Vector3(0, .09, -3), new THREE.Vector3());
    let widest = 0;
    f.until("offered", 30, () => {
      widest = Math.max(widest, Math.abs(f.actor.position.x));
      assert.ok(world.canStand(f.actor.position.x, f.actor.position.z, .3), "the character must retain wall clearance throughout its path");
      assert.ok(Math.hypot(f.actor.position.x - f.camera.position.x, f.actor.position.z - f.camera.position.z) >= .3 + PLAYER_RADIUS - 1e-9);
    });
    assert.ok(widest > 1.3, `the path should visibly detour around the table (${widest})`);
  } finally { f.dispose(); }
});

test("an unreachable throw cannot pull the character through a wall and remains recoverable with B or C", () => {
  const f = fixture(), world = room((_x, z) => z > -1.2 && z < -.8);
  try {
    f.controller.setWorld(world, .3); toss(f);
    f.controller.physics.throw(new THREE.Vector3(0, .09, -3), new THREE.Vector3());
    for (let i = 0; i < 420; i++) {
      f.tick(); assert.ok(f.actor.position.z > -.8, "an unreachable fetch must never traverse the separating wall");
    }
    assert.equal(f.controller.state, "retrieving"); assert.match(f.label, /out of reach.*B to recall.*C to clear/);
    f.controller.recall(null, f.now); assert.equal(f.controller.state, "held");
    f.controller.clear(false); assert.equal(f.control.released, 0); assert.equal(f.controller.active, false);
  } finally { f.dispose(); }
});

async function loadGeometry(file) {
  const { gltf, binary } = readGlb(new URL(`../public/${file}`, import.meta.url));
  // Real skinning, rig hierarchy, mesh dimensions and clips; textures alone are
  // omitted so the exact production model can run without a browser or GPU.
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  gltf.materials = []; gltf.images = []; gltf.textures = [];
  const jsonBytes = Buffer.from(JSON.stringify(gltf));
  const json = Buffer.concat([jsonBytes, Buffer.alloc((4 - jsonBytes.length % 4) % 4, 32)]);
  const header = Buffer.alloc(20), binaryHeader = Buffer.alloc(8);
  header.write("glTF"); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + binary.length, 8);
  header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  binaryHeader.writeUInt32LE(binary.length); binaryHeader.writeUInt32LE(0x004e4942, 4);
  const bytes = Buffer.concat([header, json, binaryHeader, binary]);
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
}

for (const asset of [
  { file: "keanu-animated.glb", height: 1.72 }, { file: "lebron-animated.glb", height: 2.06 },
  { file: "Pikachu.glb" }, { file: "dog-animated.glb" },
]) {
  const model = await loadGeometry(asset.file);
  test(`${asset.file}: real scaled rig fetches, carries in its ${asset.height ? "hand" : "mouth"}, and hands the ball to either tracked hand`, () => {
    for (const [id, label] of [[7, "Left"], [23, "Right"]]) {
      const f = fixture(model, asset);
      try {
        toss(f);
        const visited = f.until("offered");
        for (const phase of ["flying", "retrieving", "pickup", "returning", "offered"]) assert.ok(visited.has(phase), `${asset.file}: missing phase ${phase}`);
        assert.match(f.label, asset.height ? /hand/ : /mouth/);
        assert.ok(f.controller.ball.position.y > .15, "carrying must lift the ball above the floor");
        const carried = f.controller.ball.position.clone();
        const grab = handAt(f, carried, { id, label });
        f.tick([grab]); assert.equal(f.controller.state, "held", `${label} hand must be able to take the offered ball`);
        assert.ok(f.controller.ball.position.distanceTo(carried) < .01, "taking the ball should not jump away from the socket");
        f.tick([{ ...grab, pose: "open", closed: false }]);
        assert.equal(f.controller.state, "flying", "the retrieved ball is throwable again immediately");
      } finally { f.dispose(); }
    }
  });
}

test("dispose removes the single ball and does not reactivate the previous controller", () => {
  const f = fixture(); toss(f); f.dispose();
  assert.equal(f.controller.ball.parent, null); assert.equal(f.control.released, 0); assert.equal(f.controller.active, false);
});
