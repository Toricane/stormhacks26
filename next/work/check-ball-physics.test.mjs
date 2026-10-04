import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import * as THREE from "three";
import { CollisionWorld } from "../lib/environments/collision-world.ts";
import { BallPhysics } from "../lib/fetch/ball-physics.ts";
import { readGlb, readAccessor } from "./glb-tools.mjs";

function advance(ball, seconds, fps = 60) {
  for (let i = 0; i < seconds * fps; i++) ball.update(1 / fps);
}

function box(root, size, position) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size));
  mesh.position.set(...position);
  root.add(mesh);
  return mesh;
}

test("a thrown ball falls, bounces, rolls to rest and wakes on a new throw", () => {
  const ball = new BallPhysics(new CollisionWorld());
  ball.throw(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(3, 0, 0));
  let bounced = false;
  for (let i = 0; i < 180; i++) {
    const before = ball.velocity.y;
    ball.update(1 / 120);
    bounced ||= before < -.5 && ball.velocity.y > .5;
    assert.ok(ball.position.y >= ball.radius);
  }
  assert.ok(bounced, "The floor produces an upward rebound");
  advance(ball, 12);
  assert.equal(ball.resting, true);
  assert.ok(ball.position.x > 1, "A thrown ball travels horizontally");
  assert.deepEqual(ball.velocity.toArray(), [0, 0, 0]);
  const restingPosition = ball.position.clone();
  advance(ball, 2);
  assert.deepEqual(ball.position, restingPosition);
  ball.throw(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 3, 1));
  assert.equal(ball.resting, false);
  ball.update(.02);
  assert.ok(ball.position.y > 1);
});

test("fixed steps give the same flight at common rendering framerates", () => {
  const balls = [30, 60, 120].map(fps => {
    const ball = new BallPhysics(new CollisionWorld());
    ball.throw(new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(2, 4, -3));
    advance(ball, 3, fps);
    return ball;
  });
  for (const ball of balls) assert.ok(ball.position.distanceTo(balls[0].position) < 1e-8);
});

test("a fast throw cannot tunnel through a thin mesh wall even during a long frame", () => {
  const root = new THREE.Group();
  box(root, [.01, 5, 8], [1, 2.5, 0]);
  const ball = new BallPhysics(new CollisionWorld());
  ball.setEnvironment(root);
  ball.throw(new THREE.Vector3(0, 2, 0), new THREE.Vector3(24, 0, 0));
  ball.update(.25);
  assert.ok(ball.position.x < .91);
  assert.ok(ball.velocity.x < 0, "The wall reflects horizontal velocity");
  assert.ok(Math.abs(ball.velocity.x) < 24, "A wall bounce loses energy");
});

test("mesh furniture has a real top and does not act like an infinite-height wall", () => {
  const root = new THREE.Group();
  box(root, [2, .12, 2], [0, .9, 0]);
  const ball = new BallPhysics(new CollisionWorld());
  ball.setEnvironment(root);
  ball.throw(new THREE.Vector3(0, 2, 0), new THREE.Vector3());
  advance(ball, 8);
  assert.ok(Math.abs(ball.position.y - (1.05 + .00001)) < .001);
  assert.equal(ball.resting, true);
  ball.throw(new THREE.Vector3(-2, 2.2, 0), new THREE.Vector3(7, 2, 0));
  advance(ball, .5);
  assert.ok(ball.position.x > 1, "A high throw clears the table footprint");
});

test("real ceiling triangles reflect upward throws; the empty scene has no ceiling", () => {
  const root = new THREE.Group();
  box(root, [10, .04, 10], [0, 2.8, 0]);
  const ball = new BallPhysics(new CollisionWorld());
  ball.setEnvironment(root);
  ball.throw(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 12, 0));
  advance(ball, .2);
  assert.ok(ball.velocity.y < 0);
  assert.ok(ball.position.y < 2.7);
  ball.setEnvironment(null);
  ball.throw(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 12, 0));
  advance(ball, .3);
  assert.ok(ball.position.y > 3.5);
  assert.ok(ball.velocity.y > 0);
});

test("collision triangles respect parent transforms and two-sided scanned faces", () => {
  const root = new THREE.Group();
  root.position.set(2, 0, 0);
  root.rotation.y = Math.PI / 2;
  root.scale.setScalar(2);
  // PlaneGeometry's default face normal is +Z, transformed to +X.
  root.add(new THREE.Mesh(new THREE.PlaneGeometry(4, 4)));
  const ball = new BallPhysics(new CollisionWorld());
  ball.setEnvironment(root);
  ball.throw(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(10, 0, 0));
  advance(ball, .25);
  assert.ok(ball.velocity.x < 0, "The reverse side of a scanned triangle also collides");
  assert.ok(ball.position.x < 2 - ball.radius);
});

test("the navigation proxy closes capture holes when no room mesh is available", () => {
  const width = 30, depth = 30;
  const world = new CollisionWorld({ version: 1, width, depth, cellSize: .2, minX: 0, minZ: 0,
    walkable: Array.from({ length: width * depth }, (_, i) => {
      const x = i % width, z = Math.floor(i / width);
      return x > 0 && x < width - 1 && z > 0 && z < depth - 1 && x !== 15 ? "1" : "0";
    }).join(""), floorHeights: new Array(width * depth).fill(.04),
    transform: new THREE.Matrix4().toArray(), spawn: { player: [1, 0, 1], subject: [1, 0, 2], lookDirection: [0, 0, 1] } });
  const ball = new BallPhysics(world);
  ball.throw(new THREE.Vector3(1.5, 1, 2), new THREE.Vector3(15, 0, 0));
  ball.update(.15);
  assert.ok(ball.position.x < 3);
  assert.ok(ball.velocity.x < 0);
  advance(ball, 10);
  assert.ok(world.canStand(ball.position.x, ball.position.z, ball.radius));
  assert.equal(ball.resting, true);
});

test("actual lounge geometry catches an upward throw and remains bounded", context => {
  const data = JSON.parse(fs.readFileSync(new URL("../public/university-study-lounge.collision.json", import.meta.url)));
  const { gltf, binary } = readGlb(new URL("../public/university-study-lounge.glb", import.meta.url));
  const primitive = gltf.meshes[0].primitives[0];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(readAccessor(gltf, binary, primitive.attributes.POSITION), 3));
  geometry.setIndex(new THREE.BufferAttribute(readAccessor(gltf, binary, primitive.indices), 1));
  const mesh = new THREE.Mesh(geometry);
  mesh.quaternion.fromArray(gltf.nodes[0].rotation);
  const root = new THREE.Group();
  root.matrix.fromArray(data.transform).decompose(root.position, root.quaternion, root.scale);
  root.add(mesh);
  const ball = new BallPhysics(new CollisionWorld(data));
  const start = performance.now();
  ball.setEnvironment(root);
  context.diagnostic(`Indexed ${geometry.index.count / 3} room triangles in ${Math.round(performance.now() - start)} ms`);
  ball.throw(new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(0, 12, 0));
  let maximum = ball.position.y, ceilingBounce = false;
  const simulationStart = performance.now();
  for (let i = 0; i < 600; i++) {
    const before = ball.velocity.y;
    ball.update(1 / 60);
    maximum = Math.max(maximum, ball.position.y);
    ceilingBounce ||= before > 5 && ball.velocity.y < 0;
    assert.ok(ball.position.y >= ball.radius - .08);
  }
  assert.ok(ceilingBounce, "The actual ceiling reverses the upward throw");
  assert.ok(maximum < 4.2, `The ball stays below the ceiling: ${maximum}`);
  assert.equal(ball.resting, true);
  context.diagnostic(`600 ball frames took ${Math.round(performance.now() - simulationStart)} ms`);
  geometry.dispose(); mesh.material.dispose();
});
