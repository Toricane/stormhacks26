import { OneEuroFilter } from "./oneEuro";
import { classifyPose } from "./pose";
import type { Hand, Pose, RawHand, Vec2, Vec3 } from "./types";

const LANDMARK_COUNT = 21;
const PALM_IDS = [0, 5, 9, 13, 17];
/** Palm bones used to measure scale; they stay rigid regardless of finger pose. */
const PALM_BONES: [number, number][] = [
  [0, 5], [0, 9], [0, 13], [0, 17], [5, 9], [9, 13], [13, 17], [5, 17],
];
/** Max wrist jump (normalized) between frames to count as the same hand. */
const MATCH_RADIUS = 0.25;
const STALE_MS = 90;
const DROP_MS = 260;
/** Consecutive detections a new pose must hold before it is adopted. */
const POSE_FRAMES = 2;
const VELOCITY_WINDOW_MS = 110;

const FILTER_MIN_CUTOFF = 1.6;
const FILTER_BETA = 6;
const WORLD_FILTER_MIN_CUTOFF = 1.8;
const WORLD_FILTER_BETA = 12;
const SCALE_FILTER_MIN_CUTOFF = 1.4;
const SCALE_FILTER_BETA = 0.25;
/** Reject single-frame depth jumps while still allowing a fast reach. */
const MAX_LOG_SCALE_STEP = 0.12;

/** Assumed webcam-to-hand distance at rest. Errors here only scale reach linearly. */
const REST_CAMERA_DISTANCE = 0.5;
const CALIBRATION_SAMPLES = 20;
const REACH_MIN = -0.2;
const REACH_MAX = 0.45;

export type Viewport = {
  width: number;
  height: number;
  videoWidth: number;
  videoHeight: number;
};

function coverScale(vp: Viewport): number {
  return Math.max(vp.width / (vp.videoWidth || 640), vp.height / (vp.videoHeight || 480));
}

/** Maps mirrored normalized camera coords to screen px, "cover" style. */
export function toScreen(p: Vec2, vp: Viewport): Vec2 {
  const vw = vp.videoWidth || 640;
  const vh = vp.videoHeight || 480;
  const scale = coverScale(vp);
  return {
    x: (vp.width - vw * scale) / 2 + p.x * vw * scale,
    y: (vp.height - vh * scale) / 2 + p.y * vh * scale,
  };
}

/** Video px per meter at the hand, fitted in the camera-facing plane. */
function videoPxPerMeter(raw: RawHand, vp: Viewport): number {
  const vw = vp.videoWidth || 640;
  const vh = vp.videoHeight || 480;
  let imageEnergy = 0;
  let worldEnergy = 0;
  for (const [a, b] of PALM_BONES) {
    const imageDx = (raw.image[a].x - raw.image[b].x) * vw;
    const imageDy = (raw.image[a].y - raw.image[b].y) * vh;
    const worldDx = raw.world[a].x - raw.world[b].x;
    const worldDy = raw.world[a].y - raw.world[b].y;
    imageEnergy += imageDx * imageDx + imageDy * imageDy;
    worldEnergy += worldDx * worldDx + worldDy * worldDy;
  }
  return Math.sqrt(imageEnergy / Math.max(worldEnergy, 1e-8));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

type Sample = { t: number; x: number; y: number; logScale: number };

type Slot = {
  id: number;
  label: string;
  filtersX: OneEuroFilter[];
  filtersY: OneEuroFilter[];
  scaleFilter: OneEuroFilter;
  worldFilters: OneEuroFilter[];
  norm: Vec2[];
  world: Vec3[];
  logScale: number;
  pose: Pose;
  pinching: boolean;
  candidate: Pose;
  candidateFrames: number;
  history: Sample[];
  velocity: Vec2;
  growth: number;
  lastSeen: number;
};

function average(points: Vec2[], ids: number[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const i of ids) {
    x += points[i].x;
    y += points[i].y;
  }
  return { x: x / ids.length, y: y / ids.length };
}

function mirrored(raw: RawHand, i: number): Vec2 {
  return { x: 1 - raw.image[i].x, y: raw.image[i].y };
}

export class HandSystem {
  private slots: Slot[] = [];
  private nextId = 1;
  /** Log of video px/m at the rest position, shared by both hands. */
  private restLogScale: number | null = null;
  private calibrationSamples: number[] = [];

  get calibrating(): boolean {
    return this.calibrationSamples.length < CALIBRATION_SAMPLES;
  }

  /** Re-learn the rest position from the next few detections. */
  recalibrate(): void {
    this.restLogScale = null;
    this.calibrationSamples = [];
  }

  update(detections: RawHand[] | null, nowMs: number, vp: Viewport): Hand[] {
    if (detections) this.ingest(detections, nowMs, vp);
    this.slots = this.slots.filter((s) => nowMs - s.lastSeen < DROP_MS);
    return this.slots.map((s) => this.toHand(s, nowMs, vp));
  }

  private ingest(detections: RawHand[], nowMs: number, vp: Viewport): void {
    // Greedy nearest-wrist matching keeps hand identity stable across frames.
    const pairs: { slot: Slot; det: number; d: number }[] = [];
    detections.forEach((raw, det) => {
      const wrist = mirrored(raw, 0);
      for (const slot of this.slots) {
        const d = Math.hypot(slot.norm[0].x - wrist.x, slot.norm[0].y - wrist.y);
        if (d < MATCH_RADIUS) pairs.push({ slot, det, d });
      }
    });
    pairs.sort((a, b) => a.d - b.d);

    const usedSlots = new Set<Slot>();
    const assigned = new Map<number, Slot>();
    for (const p of pairs) {
      if (usedSlots.has(p.slot) || assigned.has(p.det)) continue;
      usedSlots.add(p.slot);
      assigned.set(p.det, p.slot);
    }

    detections.forEach((raw, det) => {
      const slot = assigned.get(det) ?? this.createSlot(raw, vp);
      this.updateSlot(slot, raw, nowMs, vp);
    });
  }

  private createSlot(raw: RawHand, vp: Viewport): Slot {
    const reading = classifyPose(raw.world, false);
    const slot: Slot = {
      id: this.nextId++,
      label: raw.label,
      filtersX: Array.from({ length: LANDMARK_COUNT }, () => new OneEuroFilter(FILTER_MIN_CUTOFF, FILTER_BETA)),
      filtersY: Array.from({ length: LANDMARK_COUNT }, () => new OneEuroFilter(FILTER_MIN_CUTOFF, FILTER_BETA)),
      scaleFilter: new OneEuroFilter(SCALE_FILTER_MIN_CUTOFF, SCALE_FILTER_BETA),
      worldFilters: Array.from(
        { length: LANDMARK_COUNT * 3 },
        () => new OneEuroFilter(WORLD_FILTER_MIN_CUTOFF, WORLD_FILTER_BETA),
      ),
      norm: Array.from({ length: LANDMARK_COUNT }, (_, i) => mirrored(raw, i)),
      world: raw.world.map((p) => ({ ...p })),
      logScale: Math.log(videoPxPerMeter(raw, vp)),
      pose: reading.pose,
      pinching: reading.pinching,
      candidate: reading.pose,
      candidateFrames: 0,
      history: [],
      velocity: { x: 0, y: 0 },
      growth: 0,
      lastSeen: 0,
    };
    this.slots.push(slot);
    return slot;
  }

  private updateSlot(slot: Slot, raw: RawHand, nowMs: number, vp: Viewport): void {
    const tSec = nowMs / 1000;
    const rawPoints: Vec2[] = [];
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const p = mirrored(raw, i);
      rawPoints.push(p);
      slot.norm[i] = {
        x: slot.filtersX[i].filter(p.x, tSec),
        y: slot.filtersY[i].filter(p.y, tSec),
      };
    }
    slot.label = raw.label;

    const measuredLogScale = Math.log(videoPxPerMeter(raw, vp));
    const rawLogScale = Math.min(
      slot.logScale + MAX_LOG_SCALE_STEP,
      Math.max(slot.logScale - MAX_LOG_SCALE_STEP, measuredLogScale),
    );
    slot.logScale = slot.scaleFilter.filter(rawLogScale, tSec);
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const p = raw.world[i];
      const f = i * 3;
      slot.world[i] = {
        x: slot.worldFilters[f].filter(p.x, tSec),
        y: slot.worldFilters[f + 1].filter(p.y, tSec),
        z: slot.worldFilters[f + 2].filter(p.z, tSec),
      };
    }
    if (this.calibrating) {
      this.calibrationSamples.push(rawLogScale);
      this.restLogScale = median(this.calibrationSamples);
    }

    // Velocity and growth use unsmoothed values so fast throws aren't damped by filter lag.
    const palm = toScreen(average(rawPoints, PALM_IDS), vp);
    slot.history.push({ t: nowMs, x: palm.x, y: palm.y, logScale: rawLogScale });
    while (slot.history.length > 2 && nowMs - slot.history[0].t > VELOCITY_WINDOW_MS) {
      slot.history.shift();
    }
    const first = slot.history[0];
    const dt = (nowMs - first.t) / 1000;
    if (dt > 0.02) {
      slot.velocity = { x: (palm.x - first.x) / dt, y: (palm.y - first.y) / dt };
      slot.growth = (rawLogScale - first.logScale) / dt;
    } else {
      slot.velocity = { x: 0, y: 0 };
      slot.growth = 0;
    }

    const reading = classifyPose(raw.world, slot.pinching);
    slot.pinching = reading.pinching;
    if (reading.pose === slot.pose) {
      slot.candidateFrames = 0;
    } else if (reading.pose === slot.candidate) {
      slot.candidateFrames += 1;
      if (slot.candidateFrames >= POSE_FRAMES) {
        slot.pose = reading.pose;
        slot.candidateFrames = 0;
      }
    } else {
      slot.candidate = reading.pose;
      slot.candidateFrames = 1;
    }

    slot.lastSeen = nowMs;
  }

  private reach(logScale: number): number {
    if (this.restLogScale === null) return 0;
    // Pinhole camera: distance is inversely proportional to apparent scale.
    const distance = REST_CAMERA_DISTANCE * Math.exp(this.restLogScale - logScale);
    return Math.min(REACH_MAX, Math.max(REACH_MIN, REST_CAMERA_DISTANCE - distance));
  }

  private toHand(slot: Slot, nowMs: number, vp: Viewport): Hand {
    const points = slot.norm.map((p) => toScreen(p, vp));
    const sinceSeen = nowMs - slot.lastSeen;
    const stale = sinceSeen > STALE_MS;
    return {
      id: slot.id,
      label: slot.label,
      points,
      world: slot.world,
      pose: slot.pose,
      closed: slot.pose === "pinch" || slot.pose === "fist",
      palm: average(points, PALM_IDS),
      pinchPoint: average(points, [4, 8]),
      velocity: slot.velocity,
      growth: slot.growth,
      pxPerMeter: Math.exp(slot.logScale) * coverScale(vp),
      reach: this.reach(slot.logScale),
      size: Math.hypot(points[9].x - points[0].x, points[9].y - points[0].y),
      stale,
      presence: stale ? Math.max(0, 1 - (sinceSeen - STALE_MS) / (DROP_MS - STALE_MS)) : 1,
    };
  }
}
