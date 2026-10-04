import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { HandGestures } from "../lib/lifelike/hand-gestures.ts";
import { LifelikeController, characterProfile } from "../lib/lifelike/controller.ts";

const viewport = { width: 880, height: 420, videoWidth: 640, videoHeight: 480 };

function hand({ id = 1, x = 440, y = 140, pose = "open", upright = true, reach = 0, velocity = 0 } = {}) {
  const world = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  world[0].y = 0.08;
  for (let finger = 0; finger < 4; finger++) {
    const mcp = 5 + finger * 4;
    const ys = pose === "fist" ? [0, -0.025, 0, 0.025] : [0, -0.03, -0.055, -0.08];
    for (let joint = 0; joint < 4; joint++) world[mcp + joint] = { x: (finger - 1.5) * 0.02, y: ys[joint], z: 0 };
  }
  for (let i = 1; i <= 4; i++) world[i] = { x: -0.05 - i * 0.01, y: 0.06 - i * 0.02, z: 0 };
  const points = world.map(p => ({ x: x + p.x * 1000, y: y + (upright ? p.y : p.x) * 1000 }));
  return { id, label: id === 1 ? "Left" : "Right", points, world, pose, closed: pose === "fist",
    palm: { x, y }, pinchPoint: { x, y }, velocity: { x: velocity, y: 0 }, growth: 0,
    pxPerMeter: 1000, reach, size: 80, stale: false, presence: 1 };
}

test("a stationary raised hand is not a wave; waving triggers once with a cooldown", () => {
  const gestures = new HandGestures();
  for (let t = 0; t < 900; t += 33) assert.deepEqual(gestures.update([hand()], t), []);
  const events = [];
  for (let t = 900; t < 2800; t += 33) events.push(...gestures.update([hand({ x: 440 + Math.sin((t - 900) / 180) * 85 })], t));
  assert.equal(events.filter(event => event.type === "wave").length, 1);
  gestures.reset();
  assert.deepEqual(gestures.update([hand({ x: 650 })], 3000), []);
});

test("beckoning requires an open-palm hold before curling; either hand can signal", () => {
  const gestures = new HandGestures();
  assert.deepEqual(gestures.update([hand({ pose: "fist" })], 0), []);
  gestures.reset();
  gestures.update([hand({ id: 2 })], 0);
  gestures.update([hand({ id: 2 })], 4000);
  assert.deepEqual(gestures.update([hand({ id: 2, pose: "fist" })], 4200), [{ type: "beckon", handId: 2 }]);
  assert.deepEqual(gestures.update([hand({ id: 2, pose: "fist" })], 4233), []);
  gestures.update([], 4300);
  assert.deepEqual(gestures.update([hand({ id: 2, pose: "fist" })], 4400), []);
});

test("a little open-hand wave is a petting stroke rather than a distant greeting", () => {
  const gestures = new HandGestures();
  const events = [];
  for (let t = 0; t <= 900; t += 33) events.push(...gestures.update([hand({ x: 440 + Math.sin(t / 70) * 18 })], t));
  assert.equal(events.filter(event => event.type === "wave").length, 0);
  assert.equal(gestures.stroking(1, 900), true);
  assert.equal(gestures.stroking(1, 2000), false);
});

test("back-facing, horizontal hands can beckon using only the index finger", () => {
  const gestures = new HandGestures();
  const h = hand({ upright: false });
  h.world = h.world.map(p => ({ x: -p.x, y: p.y, z: -p.z }));
  gestures.update([h], 0); gestures.update([h], 250);
  const curled = hand({ pose: "fist", upright: false });
  const onlyIndex = { ...h, pose: "relaxed", world: h.world.map((p, i) => i >= 5 && i <= 8
    ? { x: -curled.world[i].x, y: curled.world[i].y, z: -curled.world[i].z } : p) };
  assert.deepEqual(gestures.update([onlyIndex], 300), [{ type: "beckon", handId: 1 }]);
  assert.deepEqual(gestures.update([onlyIndex], 350), []);
});

function fixture(kind = "human", cameraX = 3, random = () => 0, name) {
  const actor = new THREE.Group(), root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.8, 0.4));
  mesh.position.y = 0.9; root.add(mesh);
  const bones = new Map();
  for (const [name, x, y, z] of [["Head", 0, 1.6, 0], ["Chest", 0, 1, 0], ["R_Clavicle", 0, 1.4, 0.2], ["R_Hand", 0, 0.9, 0.2]]) {
    const bone = new THREE.Bone(); bone.name = name; bone.position.set(x, y, z); root.add(bone); bones.set(name, bone);
  }
  actor.add(root); actor.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(65, viewport.width / viewport.height, 0.05, 150);
  camera.position.set(cameraX, 1.6, 0); camera.lookAt(0, 1.6, 0); camera.updateMatrixWorld(true);
  const calls = [];
  const player = { play: name => { calls.push(name); return true; }, stop: () => {}, setPlayback: () => {} };
  const names = kind === "human" ? ["Idle", "Wave", "Walk", "Curious", "Shrug", "Drowsy", "High five", "Petting"]
    : kind === "dog" ? ["Idle", "Walk", "Play bow", "Sniff", "Tail wag", "Happy", "Headpat"]
    : ["Idle", "Wave", "Walk", "Curious", "Drowsy", "Headpat", "Petting", "Happy"];
  const animations = names.map(name => ({ name, duration: 3, loop: ["Idle", "Walk", "Petting", "Tail wag", "Happy", "Drowsy", "Sniff"].includes(name) }));
  const profile = { kind, name: name ?? (kind === "human" ? "Keanu" : kind === "dog" ? "Dog" : "Pikachu"), forwardYaw: Math.PI / 2 };
  const controller = new LifelikeController({ actor, root, camera, player, animations, profile, random });
  controller.activate(0);
  const frame = (hands, time) => ({ hands, viewport, sampleTime: time });
  const at = (point, options = {}) => {
    const projected = point.clone().project(camera);
    return hand({ x: (projected.x + 1) / 2 * viewport.width, y: (1 - projected.y) / 2 * viewport.height,
      reach: (point.distanceTo(camera.position) - 0.8) / 4, ...options });
  };
  return { controller, camera, actor, bones, calls, frame, at, animations };
}

test("a later wave can replay a long greeting without restarting on every frame", () => {
  const f = fixture();
  f.animations.find(clip => clip.name === "Wave").duration = 10;
  for (let t = 0; t <= 5500; t += 33) {
    f.controller.update(0.033, t, f.frame([hand({ x: 440 + Math.sin(t / 180) * 85 })], t));
  }
  assert.equal(f.calls.filter(name => name === "Wave").length, 2);
});

test("screen overlap at a distance cannot pet; reachable strokes pet and lost tracking ends the reaction", () => {
  const f = fixture("human", 3);
  const distant = f.at(new THREE.Vector3(0, 1.6, 0), { upright: false, velocity: 120 });
  assert.equal(f.controller.update(0.033, 33, f.frame([distant], 33)), "Keanu: Idle");
  f.camera.position.x = 1; f.camera.updateMatrixWorld(true);
  const near = f.at(new THREE.Vector3(0, 1.6, 0), { upright: false, velocity: 120 });
  assert.equal(f.controller.update(0.033, 66, f.frame([near], 66)), "Keanu: Enjoying a pet");
  assert.equal(f.calls.at(-1), "Petting");
  const stale = { ...near, stale: true };
  assert.equal(f.controller.update(0.033, 700, f.frame([stale], 700)), "Keanu: Idle");
});

test("a high five is offered nearby and completes only on the animated hand; a held palm does not replay it", () => {
  const f = fixture("human", 3);
  const target = new THREE.Vector3(0, 1.52, 0.38);
  assert.equal(f.controller.update(0.033, 0, f.frame([f.at(target)], 0)), "Keanu: Idle");
  f.camera.position.x = 1; f.camera.updateMatrixWorld(true);
  const h = f.at(target);
  assert.equal(f.controller.update(0.033, 33, f.frame([h], 33)), "Keanu: Offering a high five");
  assert.equal(f.calls.at(-1), "High five");
  f.bones.get("R_Hand").position.copy(target);
  assert.equal(f.controller.update(0.033, 66, f.frame([h], 66)), "Keanu: High five!");
  f.controller.update(0.033, 3100, f.frame([h], 3100));
  f.controller.update(0.033, 4000, f.frame([h], 4000));
  assert.equal(f.calls.filter(name => name === "High five").length, 1);
  f.controller.update(0.033, 4100, f.frame([], 4100));
  f.controller.update(0.033, 4200, f.frame([h], 4200));
  assert.equal(f.calls.filter(name => name === "High five").length, 2);
});

test("a little wave at a nearby head pets, then Pikachu is happy and the dog wags after the headpat finishes", () => {
  for (const kind of ["dog", "pikachu"]) {
    const f = fixture(kind, 1);
    const base = f.at(new THREE.Vector3(0, 1.6, 0), { upright: false, velocity: 120 });
    let action;
    for (let t = 0; t <= 900; t += 33) {
      const h = hand({ x: base.palm.x + Math.sin(t / 70) * 18, y: base.palm.y, upright: true, reach: base.reach, velocity: 0 });
      action = f.controller.update(0.033, t, f.frame([h], t));
    }
    assert.equal(action, `${kind === "dog" ? "Dog" : "Pikachu"}: Enjoying a pet`);
    assert.equal(f.calls.at(-1), "Headpat");
    f.camera.position.x = 3; f.camera.updateMatrixWorld(true);
    for (let t = 1000; t <= 4500; t += 33) {
      const far = f.at(new THREE.Vector3(0, 1.6, 0), { upright: false, velocity: 120 });
      far.palm.x += Math.sin(t / 70) * 18;
      action = f.controller.update(0.033, t, f.frame([far], t));
    }
    assert.equal(action, kind === "dog" ? "Dog: Wagging tail" : "Pikachu: Happy");
    assert.equal(f.calls.at(-1), kind === "dog" ? "Tail wag" : "Happy");
    for (let t = 4533; t <= 8000; t += 33) action = f.controller.update(0.033, t, f.frame([], t));
    assert.equal(action, `${kind === "dog" ? "Dog" : "Pikachu"}: Idle`);
  }
});

test("beckoning moves the character on the ground and stops before the user", () => {
  const f = fixture();
  f.controller.update(0.033, 0, f.frame([hand()], 0));
  f.controller.update(0.2, 200, f.frame([hand()], 200));
  assert.equal(f.controller.update(0.033, 240, f.frame([hand({ pose: "fist" })], 240)), "Keanu: Walking over");
  assert.equal(f.calls.at(-1), "Walk");
  for (let t = 340; t <= 5340; t += 100) f.controller.update(0.1, t, f.frame([], t));
  assert.ok(Math.abs(f.actor.position.x - 2.05) < 1e-6);
  assert.equal(f.actor.position.y, 0);
  assert.equal(f.actor.position.z, 0);
  assert.equal(f.calls.at(-1), "Idle");
});

test("idle strolls stay nearby and on the ground; deactivation stops the controller", () => {
  const f = fixture();
  assert.equal(f.controller.update(0.033, 6001, null), "Keanu: Strolling nearby");
  assert.equal(f.calls.at(-1), "Walk");
  for (let t = 6034; t < 9000; t += 33) f.controller.update(0.033, t, null);
  assert.equal(f.controller.update(0.033, 9101, null), "Keanu: Idle");
  assert.ok(f.actor.position.length() > 0.1 && f.actor.position.length() <= 1.1);
  assert.equal(f.actor.position.y, 0);
  f.controller.deactivate();
  const count = f.calls.length;
  assert.equal(f.controller.update(0.033, 20000, null), "");
  assert.equal(f.calls.length, count);
});

test("each character mixes exactly the requested idle reactions", () => {
  for (const [kind, name, choices] of [["pikachu", "Pikachu", ["Curious", "Drowsy"]], ["dog", "Dog", ["Play bow", "Sniff"]],
    ["human", "LeBron", ["Curious", "Shrug", "Drowsy"]], ["human", "Keanu", ["Curious", "Drowsy"]]]) {
    choices.forEach((choice, index) => {
      const samples = [0, 0.9, (index + 0.1) / choices.length];
      const f = fixture(kind, 3, () => samples.shift() ?? 0.9, name);
      f.controller.update(0.033, 6001, null);
      assert.equal(f.calls.at(-1), choice);
    });
  }
});

test("a raised open hand doing a small wave over a human head pets instead of offering a high five", () => {
  const f = fixture("human", 1);
  const base = f.at(new THREE.Vector3(0, 1.6, 0));
  let action;
  for (let t = 0; t <= 900; t += 33) {
    const h = hand({ x: base.palm.x + Math.sin(t / 70) * 18, y: base.palm.y, upright: true, reach: base.reach });
    action = f.controller.update(0.033, t, f.frame([h], t));
  }
  assert.equal(action, "Keanu: Enjoying a pet");
  assert.equal(f.calls.includes("High five"), false);
});

test("all four supplied characters have explicit species and forward axes", () => {
  for (const [file, kind, yaw] of [["lebron.glb", "human", Math.PI / 2], ["keanu.glb", "human", Math.PI / 2], ["dog-animated.glb", "dog", Math.PI / 2], ["Pikachu.glb", "pikachu", 0]]) {
    const profile = characterProfile(file, []);
    assert.equal(profile.kind, kind); assert.equal(profile.forwardYaw, yaw);
  }
  const ear = new THREE.Bone(); ear.name = "EarTipL";
  assert.equal(characterProfile("uploaded.glb", [ear]).kind, "pikachu");
});

test("fingertip strokes and naturally relaxed palms pet without requiring the palm center", () => {
  const f = fixture("human", 1);
  const head = new THREE.Vector3(0, 1.6, 0);
  const tip = f.at(head);
  const h = f.at(new THREE.Vector3(0, 1.1, 0), { pose: "relaxed", velocity: 35, reach: 0 });
  h.points[12] = { ...tip.palm };
  assert.equal(f.controller.update(0.033, 33, f.frame([h], 33)), "Keanu: Enjoying a pet");
});

test("fists over the head and a frozen webcam frame cannot sustain petting", () => {
  const f = fixture("human", 1);
  const h = f.at(new THREE.Vector3(0, 1.6, 0), { pose: "fist", velocity: 100 });
  assert.equal(f.controller.update(0.033, 33, f.frame([h], 33)), "Keanu: Idle");
  const open = f.at(new THREE.Vector3(0, 1.6, 0), { velocity: 100 });
  const frozen = f.frame([open], 66);
  assert.equal(f.controller.update(0.033, 66, frozen), "Keanu: Enjoying a pet");
  assert.equal(f.controller.update(0.033, 1000, frozen), "Keanu: Idle");
});

test("idle overlay restores before the mixer and leaving Lifelike restores the source pose", () => {
  const f = fixture();
  const head = f.bones.get("Head"), original = head.quaternion.clone();
  for (let t = 0; t < 1000; t += 33) {
    f.controller.beforeAnimationUpdate();
    assert.ok(head.quaternion.angleTo(original) < 1e-7);
    f.controller.update(0.033, t, null);
  }
  assert.ok(head.quaternion.angleTo(original) > 0.001);
  f.controller.deactivate();
  assert.ok(head.quaternion.angleTo(original) < 1e-7);
});
