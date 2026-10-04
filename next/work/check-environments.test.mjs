import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { test } from "node:test";
import * as THREE from "three";
import { CollisionWorld, PLAYER_RADIUS } from "../lib/environments/collision-world.ts";
import { loungeSpawns } from "../lib/environments/study-lounge.ts";
import { moveFirstPerson, EYE_HEIGHT } from "../lib/first-person.ts";
import { LifelikeController } from "../lib/lifelike/controller.ts";
import { readGlb, readAccessor } from "./glb-tools.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../public/university-study-lounge.collision.json", import.meta.url)));
const lounge = { data, world: new CollisionWorld(data) };

function room(width = 24, depth = 24, obstacle = (x, z) => x >= 4 && x <= 7 && z >= 9 && z <= 10) {
  const walkable = Array.from({ length: width * depth }, (_, i) => {
    const x = i % width, z = Math.floor(i / width);
    return x > 0 && z > 0 && x < width - 1 && z < depth - 1 && !obstacle(x, z) ? "1" : "0";
  }).join("");
  return new CollisionWorld({ version: 1, width, depth, cellSize: 1, minX: 0, minZ: 0, walkable,
    floorHeights: new Array(width * depth).fill(.04), transform: new THREE.Matrix4().toArray(),
    spawn: { player: [5, 0, 5], subject: [5, 0, 7], lookDirection: [0, 0, 1] } });
}

test("lounge proxy matches the source asset and puts the actual floor below the ceiling", () => {
  const url = new URL("../public/university-study-lounge.glb", import.meta.url);
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(url)).digest("hex"), data.sourceSha256);
  const { gltf, binary } = readGlb(url), vertices = readAccessor(gltf, binary, 0);
  const transform = new THREE.Matrix4().fromArray(data.transform).multiply(new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion().fromArray(gltf.nodes[0].rotation)));
  let floorTotal = 0, ceilingTotal = 0, floorCount = 0, ceilingCount = 0;
  const point = new THREE.Vector3();
  for (let i = 0; i < vertices.length; i += 30) {
    const x = vertices[i], rawY = vertices[i + 1], rawZ = vertices[i + 2];
    if (x < -4 || x > 1 || rawY < -2 || rawY > 4) continue;
    point.set(x, rawY, rawZ).applyMatrix4(transform);
    if (rawZ > -1.15 && rawZ < -1.04) { floorTotal += point.y; floorCount++; }
    if (rawZ > .70 && rawZ < .82) { ceilingTotal += point.y; ceilingCount++; }
  }
  assert.ok(floorCount > 1000 && ceilingCount > 1000);
  assert.ok(Math.abs(floorTotal / floorCount) < .1, "The real scanned floor is at ground level");
  assert.ok(ceilingTotal / ceilingCount > 2.6, "The ceiling is above the viewer, never below it");
});

test("every supplied character fits ahead of the user in the window-side aisle", () => {
  const direction = new THREE.Vector3().fromArray(data.spawn.lookDirection).normalize();
  for (const radius of [.425, .47, .689, .72]) {
    const spawn = loungeSpawns(lounge, radius);
    assert.ok(lounge.world.canStand(spawn.player.x, spawn.player.z, PLAYER_RADIUS));
    assert.ok(lounge.world.canStand(spawn.subject.x, spawn.subject.z, radius));
    const ahead = spawn.subject.clone().sub(spawn.player).setY(0);
    assert.ok(Math.abs(ahead.length() - 1.65) < 1e-7);
    assert.ok(ahead.normalize().dot(direction) > .999);
    assert.ok(lounge.world.clearSegment(spawn.player, spawn.subject, PLAYER_RADIUS));
  }
});

test("swept movement cannot tunnel through a table or leave the captured floor", () => {
  const world = room(), body = new THREE.Vector3(5.5, 100, 5.5);
  world.move(body, new THREE.Vector3(0, -200, 15), .3);
  assert.ok(body.z < 9 && body.z > 6);
  assert.equal(body.y, .04);
  for (let i = 0; i < 100; i++) {
    world.move(body, new THREE.Vector3(Math.sin(i) * 8, 0, Math.cos(i) * 8), .3);
    assert.ok(world.canStand(body.x, body.z, .3));
    assert.equal(body.y, .04);
  }
});

test("the viewer stops against the character and keeps its eyes above the floor", () => {
  const world = new CollisionWorld(), object = new THREE.Object3D(); object.position.set(0, EYE_HEIGHT, 3);
  const controls = { object,
    moveForward: amount => { object.position.z -= amount; }, moveRight: amount => { object.position.x += amount; } };
  moveFirstPerson(controls, new Set(["KeyW"]), 5, { world, subject: new THREE.Vector3(), subjectRadius: .6 });
  assert.ok(object.position.z >= .85 && object.position.z < .9);
  assert.equal(object.position.y, EYE_HEIGHT);
});

test("environment-only exploration crosses the origin without a character obstacle", () => {
  const world = new CollisionWorld(), object = new THREE.Object3D(); object.position.set(0, EYE_HEIGHT, 3);
  const controls = { object,
    moveForward: amount => { object.position.z -= amount; }, moveRight: amount => { object.position.x += amount; } };
  moveFirstPerson(controls, new Set(["KeyW"]), 2, { world });
  assert.ok(object.position.z < -.9, "An empty scene has no invisible character blocking the camera");
  assert.equal(object.position.y, EYE_HEIGHT);
  const scanned = room(); object.position.set(5.5, EYE_HEIGHT + .04, 5.5);
  moveFirstPerson(controls, new Set(["KeyS"]), 5, { world: scanned });
  assert.ok(object.position.z < 9, "Furniture collision still applies without a model");
  assert.equal(object.position.y, EYE_HEIGHT + .04);
});

test("paths bend around furniture with no diagonal corner cutting", () => {
  const world = room(), start = new THREE.Vector3(5.5, .04, 5.5), goal = new THREE.Vector3(5.5, .04, 14.5);
  assert.equal(world.clearSegment(start, goal, .3), false);
  const path = world.path(start, goal, .3); assert.ok(path.length >= 2);
  let previous = start;
  for (const point of path) { assert.ok(world.clearSegment(previous, point, .3)); previous = point; }
  assert.ok(previous.distanceTo(goal) < 1e-7);
});

test("characters navigate around a table when beckoned and stay grounded", () => {
  const world = room(), actor = new THREE.Group(), root = new THREE.Group(); actor.add(root);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(.4, 1.8, .4)); mesh.position.y = .9; root.add(mesh);
  const head = new THREE.Bone(); head.name = "Head"; head.position.y = 1.6; root.add(head);
  actor.position.set(5.5, .04, 5.5);
  const camera = new THREE.PerspectiveCamera(65, 2, .05, 100); camera.position.set(5.5, 1.64, 14.5); camera.lookAt(actor.position);
  const calls = [], player = { play: name => { calls.push(name); return true; }, stop() {}, setPlayback() {} };
  const animations = ["Idle", "Walk"].map(name => ({ name, duration: 3, loop: true }));
  const controller = new LifelikeController({ actor, root, camera, player, animations,
    profile: { kind: "human", name: "Keanu", forwardYaw: Math.PI / 2 }, random: () => .5 });
  controller.setWorld(world, .3); controller.activate(0);
  const hand = fist => {
    const world = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 })); world[0].y = .08;
    for (let f = 0; f < 4; f++) for (let j = 0; j < 4; j++) world[5 + f * 4 + j] = {
      x: (f - 1.5) * .02, y: (fist ? [0, -.025, 0, .025] : [0, -.03, -.055, -.08])[j], z: 0 };
    return { id: 1, world, points: world.map(p => ({ x: 300 + p.x * 700, y: 120 + p.y * 700 })),
      pose: fist ? "fist" : "open", closed: fist, palm: { x: 300, y: 120 }, reach: 0,
      pxPerMeter: 700, velocity: { x: 0, y: 0 }, stale: false };
  };
  const viewport = { width: 880, height: 420 };
  for (const t of [0, 150]) controller.update(.033, t, { hands: [hand(false)], viewport, sampleTime: t });
  assert.match(controller.update(.033, 200, { hands: [hand(true)], viewport, sampleTime: 200 }), /Walking over/);
  let action;
  for (let t = 250; t < 24500; t += 50) {
    controller.beforeAnimationUpdate(); action = controller.update(.05, t, null);
    assert.ok(world.canStand(actor.position.x, actor.position.z, .3)); assert.equal(actor.position.y, .04);
    if (!/Walking over/.test(action)) break;
  }
  assert.match(action, /Idle/);
  assert.ok(Math.hypot(actor.position.x - camera.position.x, actor.position.z - camera.position.z) < 1.2,
    `The character reaches the user after navigating: ${actor.position.toArray()}`);
  controller.deactivate(); mesh.geometry.dispose(); mesh.material.dispose();
});

test("real-room walks keep both user and character inside collision-free supported floor", () => {
  const spawn = loungeSpawns(lounge, .72), positions = [spawn.player, spawn.subject], radii = [.25, .72];
  for (let i = 0; i < 800; i++) for (let body = 0; body < 2; body++) {
    const point = positions[body], radius = radii[body];
    lounge.world.move(point, new THREE.Vector3(Math.sin(i * .35 + body) * .2, 0, Math.cos(i * .21 + body) * .2), radius,
      { position: positions[1 - body], radius: radii[1 - body] });
    assert.ok(lounge.world.canStand(point.x, point.z, radius));
    assert.equal(point.y, lounge.world.floorHeight(point.x, point.z, radius));
    assert.ok(Math.hypot(point.x - positions[1 - body].x, point.z - positions[1 - body].z) >= .97 - 1e-7);
  }
});

test("unsupported floor, malformed maps and oversized room spawns fail safely", () => {
  assert.equal(lounge.world.canStand(-100, -100, .25), false);
  assert.equal(lounge.world.canStand(NaN, 0, .25), false);
  assert.throws(() => new CollisionWorld({ ...data, walkable: "1" }), /invalid/);
  assert.throws(() => loungeSpawns(lounge, 20), /safe window-side spawn/);
});
