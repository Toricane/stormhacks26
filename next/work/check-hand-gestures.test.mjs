import assert from "node:assert/strict";
import { test } from "node:test";
import { HandGestures, fingerCurl, indexCurl, openPalm } from "../lib/lifelike/hand-gestures.ts";

/** Bent 3-D phalanges, including naturally splayed fingers and rigid hand rotation. */
function hand({ id = 1, x = 440, y = 140, pose = "open", curls = [0.12, 0.12, 0.12, 0.12], roll = 0,
  tilt = 0, mirror = 1, scale = 1000, stale = false } = {}) {
  const world = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  world[0].y = 0.08;
  for (let finger = 0; finger < 4; finger++) {
    const mcp = 5 + finger * 4;
    world[mcp] = { x: (finger - 1.5) * 0.02, y: 0, z: 0 };
    for (let joint = 1; joint < 4; joint++) {
      const bend = curls[finger] * Math.PI * joint / 3;
      const length = [0, 0.035, 0.026, 0.021][joint];
      const previous = world[mcp + joint - 1];
      world[mcp + joint] = { x: previous.x, y: previous.y - Math.cos(bend) * length,
        z: previous.z + Math.sin(bend) * length };
    }
  }
  for (let i = 1; i <= 4; i++) world[i] = { x: -0.05 - i * 0.01, y: 0.06 - i * 0.02, z: 0 };
  const rotated = world.map(p => {
    const yy = p.y * Math.cos(tilt) - p.z * Math.sin(tilt);
    const zz = p.y * Math.sin(tilt) + p.z * Math.cos(tilt);
    return { x: mirror * (p.x * Math.cos(roll) - yy * Math.sin(roll)),
      y: p.x * Math.sin(roll) + yy * Math.cos(roll), z: zz };
  });
  const points = rotated.map(p => ({ x: x + p.x * scale, y: y + p.y * scale }));
  return { id, label: id === 1 ? "Left" : "Right", points, world: rotated, pose,
    closed: pose === "fist" || pose === "pinch", palm: { x, y }, pinchPoint: { x, y },
    velocity: { x: 0, y: 0 }, growth: 0, pxPerMeter: scale, reach: 0, size: 80 * scale / 1000,
    stale, presence: stale ? 0 : 1 };
}

function sample(gestures, duration, interval, frame, offset = 0) {
  const signals = [];
  for (let t = 0; t <= duration; t += interval) {
    const hands = frame(t);
    signals.push(...gestures.update(Array.isArray(hands) ? hands : [hands], offset + t));
  }
  return signals;
}

for (const hz of [15, 30, 60, 120]) {
  for (const scale of [400, 1000, 1800]) {
    test(`a slow waving hand is recognized at ${hz} fps and ${scale} px/m`, () => {
      const signals = sample(new HandGestures(), 2400, 1000 / hz, t => hand({
        x: 440 + Math.sin(t / 245) * 0.065 * scale, scale,
        // Real classifier flicker includes brief false fist labels.
        pose: Math.floor(t / 90) % 9 === 1 ? "fist" : Math.floor(t / 130) % 3 === 1 ? "relaxed" : "open",
      }));
      assert.equal(signals.filter(s => s.type === "wave").length, 1);
      assert.equal(signals.filter(s => s.type === "beckon").length, 0);
    });
  }
}

test("wrist-led waving works with a nearly stationary palm", () => {
  const signals = sample(new HandGestures(), 2100, 33, t => hand({ roll: Math.sin(t / 170) * 0.85 }));
  assert.equal(signals.filter(s => s.type === "wave").length, 1);
});

test("a natural twenty-degree wrist wave keeps the wrist fixed", () => {
  const signals = sample(new HandGestures(), 2200, 33, t => {
    const h = hand();
    const wrist = h.points[0];
    const angle = Math.sin(t / 190) * 0.35;
    h.points = h.points.map(p => ({
      x: wrist.x + (p.x - wrist.x) * Math.cos(angle) - (p.y - wrist.y) * Math.sin(angle),
      y: wrist.y + (p.x - wrist.x) * Math.sin(angle) + (p.y - wrist.y) * Math.cos(angle),
    }));
    h.palm = { x: 0, y: 0 };
    for (const i of [0, 5, 9, 13, 17]) {
      h.palm.x += h.points[i].x / 5; h.palm.y += h.points[i].y / 5;
    }
    return h;
  });
  assert.equal(signals.filter(s => s.type === "wave").length, 1);
});

test("a jittering stationary hand, one-way reach, and small strokes are not greetings", () => {
  const jitter = sample(new HandGestures(), 5000, 17, t => hand({
    x: 440 + Math.sin(t * 0.087) * 2, y: 140 + Math.cos(t * 0.07) * 2,
    curls: Array.from({ length: 4 }, (_, i) => 0.2 + Math.sin(t * 0.09 + i) * 0.02),
  }));
  assert.deepEqual(jitter, []);
  assert.deepEqual(sample(new HandGestures(), 1600, 33, t => hand({ x: 440 + t / 5 })), []);
  const gestures = new HandGestures();
  assert.deepEqual(sample(gestures, 1000, 33, t => hand({ y: 140 + Math.sin(t / 85) * 18 })), []);
  assert.equal(gestures.stroking(1, 1000), true);
});

test("moderate index curls beckon from a relaxed baseline with other fingers already folded", () => {
  for (const tilt of [0, Math.PI / 2, Math.PI]) {
    const signals = sample(new HandGestures(), 900, 33, t => hand({
      pose: "relaxed", tilt, mirror: -1, roll: Math.PI / 2,
      curls: [0.4 + Math.min(1, Math.max(0, (t - 180) / 360)) * 0.33, 0.87, 0.87, 0.87],
    }));
    assert.deepEqual(signals, [{ type: "beckon", handId: 1 }]);
  }
});

test("whole-hand beckoning tolerates a natural pull toward the body", () => {
  for (const hz of [15, 30, 60]) {
    const signals = sample(new HandGestures(), 950, 1000 / hz, t => {
      const progress = Math.min(1, Math.max(0, (t - 180) / 400));
      return hand({ x: 440 + progress * 72, y: 140 + progress * 24,
        pose: "relaxed", curls: [0.24, 0.25, 0.22, 0.25].map(curl => curl + progress * 0.3) });
    });
    assert.deepEqual(signals, [{ type: "beckon", handId: 1 }]);
  }
});

test("repositioning an extended hand refreshes the beckon reference", () => {
  const gestures = new HandGestures();
  assert.deepEqual(sample(gestures, 660, 33, t => hand({ x: 200 + t / 2 })), []);
  const signals = sample(gestures, 700, 33, t => hand({ x: 530,
    curls: Array(4).fill(0.12 + Math.min(1, t / 330) * 0.42) }), 693);
  assert.deepEqual(signals, [{ type: "beckon", handId: 1 }]);
});

test("a welcome wave does not suppress an immediately following come-over signal", () => {
  const gestures = new HandGestures();
  const waving = sample(gestures, 1400, 33, t => hand({ x: 440 + Math.sin(t / 160) * 80 }));
  assert.equal(waving.filter(s => s.type === "wave").length, 1);
  sample(gestures, 220, 33, () => hand(), 1430);
  const signals = sample(gestures, 500, 33, t => hand({ curls: Array(4).fill(0.12 + Math.min(1, t / 280) * 0.45) }), 1680);
  assert.deepEqual(signals, [{ type: "beckon", handId: 1 }]);
});

test("short dropouts preserve waves, and long gaps never bridge unrelated curls", () => {
  const signals = sample(new HandGestures(), 2400, 33, t => t > 440 && t < 550 ? []
    : hand({ x: 440 + Math.sin(t / 180) * 75 }));
  assert.equal(signals.filter(s => s.type === "wave").length, 1);
  const gestures = new HandGestures();
  sample(gestures, 330, 33, () => hand());
  gestures.update([], 800);
  assert.deepEqual(sample(gestures, 400, 33, () => hand({ pose: "fist", curls: Array(4).fill(0.9) }), 850), []);
});

test("new tracking IDs cannot bypass the greeting cooldown", () => {
  const gestures = new HandGestures();
  const a = sample(gestures, 1150, 33, t => hand({ x: 440 + Math.sin(t / 125) * 80 }));
  const b = sample(gestures, 1150, 33, t => hand({ id: 2, x: 440 + Math.sin(t / 125) * 80 }), 1200);
  assert.equal(a.filter(s => s.type === "wave").length, 1);
  assert.deepEqual(b, []);
});

test("tolerant palm openness accepts relaxed hands while excluding curled and pinched hands", () => {
  assert.equal(openPalm(hand({ pose: "relaxed", curls: Array(4).fill(0.3) })), true);
  assert.equal(openPalm(hand({ pose: "point", curls: [0.1, 0.9, 0.9, 0.9] })), false);
  assert.equal(openPalm(hand({ pose: "fist", curls: Array(4).fill(0.9) })), false);
  assert.equal(openPalm(hand({ pose: "pinch" })), false);
  const bent = hand({ curls: [0.4, 0.7, 0.7, 0.7] });
  const rotated = hand({ curls: [0.4, 0.7, 0.7, 0.7], roll: 0.87, tilt: 2.4, mirror: -1 });
  assert.ok(Math.abs(fingerCurl(bent) - fingerCurl(rotated)) < 1e-8);
  assert.ok(Math.abs(indexCurl(bent) - indexCurl(rotated)) < 1e-8);
});
