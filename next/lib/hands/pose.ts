import type { Pose, Vec3 } from "./types";

const FINGERS = [
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];

const EXTENDED_MAX_BEND = 70;
const CURLED_MIN_BEND = 130;
const PINCH_ENTER = 0.32;
const PINCH_EXIT = 0.5;

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function angleDeg(u: Vec3, v: Vec3): number {
  const denom = length(u) * length(v);
  if (denom === 0) return 0;
  const cos = (u.x * v.x + u.y * v.y + u.z * v.z) / denom;
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

/** Total bend across MCP, PIP and DIP joints: ~0 when straight, ~200+ in a fist. */
function fingerBend(w: Vec3[], [mcp, pip, dip, tip]: number[]): number {
  const base = sub(w[mcp], w[0]);
  const proximal = sub(w[pip], w[mcp]);
  const middle = sub(w[dip], w[pip]);
  const distal = sub(w[tip], w[dip]);
  return angleDeg(base, proximal) + angleDeg(proximal, middle) + angleDeg(middle, distal);
}

export type PoseReading = {
  pose: Pose;
  pinching: boolean;
};

/**
 * Classifies a hand from metric world landmarks so results don't depend on
 * distance from the camera. `wasPinching` enables hysteresis on the pinch.
 */
export function classifyPose(w: Vec3[], wasPinching: boolean): PoseReading {
  const palmSize = length(sub(w[9], w[0])) || 1e-6;

  const bends = FINGERS.map((finger) => fingerBend(w, finger));
  const extended = bends.filter((b) => b < EXTENDED_MAX_BEND).length;
  const othersCurled = bends.slice(1).filter((b) => b > CURLED_MIN_BEND).length;
  const indexBend = bends[0];

  // In a fist the thumb rests near the index tip, so fist must win over pinch.
  const isFist = indexBend > CURLED_MIN_BEND && othersCurled >= 2;
  const pinchRatio = length(sub(w[4], w[8])) / palmSize;
  const pinching = !isFist && pinchRatio < (wasPinching ? PINCH_EXIT : PINCH_ENTER);

  let pose: Pose;
  if (isFist) pose = "fist";
  else if (pinching) pose = "pinch";
  else if (extended >= 4) pose = "open";
  else if (indexBend < EXTENDED_MAX_BEND && othersCurled >= 2) pose = "point";
  else pose = "relaxed";

  return { pose, pinching };
}
