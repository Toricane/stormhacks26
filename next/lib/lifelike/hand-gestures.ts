import type { Hand, Vec3 } from "../hands/types";

const WAVE_MIN_TRAVEL = 0.6;
const WAVE_REVERSAL_TRAVEL = 0.12;
const WAVE_WINDOW_MS = 1900;
const WAVE_COOLDOWN_MS = 3000;
const BECKON_COOLDOWN_MS = 1400;
const BECKON_HOLD_MS = 90;
const BECKON_WINDOW_MS = 1400;
const BECKON_MAX_TRAVEL = 1.8;
const TRACKING_GRACE_MS = 300;
const OPEN_PALM_GRACE_MS = 180;
const STROKE_HOLD_MS = 450;

export type GestureSignal = { type: "wave" | "beckon"; handId: number };
type Motion = {
  lastSeen: number; waveOpenAt: number; direction: number; turnX: number; extremeX: number;
  waveTurns: number; waveStarted: number; strokeUntil: number;
  strokeX: number; strokeY: number; strokeAt: number;
  openAt: number | null; openX: number; openY: number; openCurl: number; openIndex: number;
  curlStarted: number | null;
};

function angle(a: Vec3, b: Vec3, c: Vec3): number {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - b.x, vy = c.y - b.y, vz = c.z - b.z;
  const length = Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz);
  return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / Math.max(length, 1e-8))));
}

/** Continuous finger curl supplements the frontend's discrete pose classifier. */
export function fingerCurl(hand: Hand): number {
  let total = 0;
  for (const mcp of [5, 9, 13, 17]) {
    total += angle(hand.world[0], hand.world[mcp], hand.world[mcp + 1]);
    total += angle(hand.world[mcp], hand.world[mcp + 1], hand.world[mcp + 2]);
    total += angle(hand.world[mcp + 1], hand.world[mcp + 2], hand.world[mcp + 3]);
  }
  return Math.min(1, total / (4 * Math.PI));
}

export function indexCurl(hand: Hand): number {
  return Math.min(1, (angle(hand.world[0], hand.world[5], hand.world[6])
    + angle(hand.world[5], hand.world[6], hand.world[7])
    + angle(hand.world[6], hand.world[7], hand.world[8])) / Math.PI);
}

export function handLength(hand: Hand): number {
  return Math.max(hand.pxPerMeter * 0.09, 20);
}

function palmOpen(hand: Hand, curl: number, index: number): boolean {
  return !hand.closed && hand.pose !== "fist" && hand.pose !== "pinch"
    && (hand.pose === "open" || (curl < 0.48 && index < 0.58));
}

/** A naturally bent open hand often gets classified as relaxed or pointing. */
export function openPalm(hand: Hand): boolean {
  return palmOpen(hand, fingerCurl(hand), indexCurl(hand));
}

export function raisedPalm(hand: Hand): boolean {
  return openPalm(hand) && hand.points[0].y - hand.points[9].y > handLength(hand) * 0.12;
}

function wavePosition(hand: Hand): number {
  // Wrist-led waves can keep the palm almost still. Include the fingers so
  // rotating the hand side to side counts as well as moving the whole arm.
  const fingers = (hand.points[8].x + hand.points[12].x + hand.points[16].x + hand.points[20].x) / 4;
  return hand.palm.x * 0.4 + fingers * 0.6;
}

function resetWave(motion: Motion, x: number, nowMs: number): void {
  motion.direction = 0; motion.turnX = x; motion.extremeX = x;
  motion.waveTurns = 0; motion.waveStarted = nowMs;
}

/** Updated only on new webcam detections, never once per render frame. */
export class HandGestures {
  private readonly motions = new Map<number, Motion>();
  // Recognition cooldowns survive a tracker ID change, and a greeting never
  // prevents the user from immediately asking the character to come closer.
  private waveAt = -Infinity;
  private beckonAt = -Infinity;

  reset(): void { this.motions.clear(); this.waveAt = -Infinity; this.beckonAt = -Infinity; }

  stroking(id: number, nowMs: number): boolean {
    return (this.motions.get(id)?.strokeUntil ?? 0) > nowMs;
  }

  update(hands: Hand[], nowMs: number): GestureSignal[] {
    const signals: GestureSignal[] = [];
    for (const hand of hands) {
      if (hand.stale) continue;
      const curl = fingerCurl(hand);
      const index = indexCurl(hand);
      const open = palmOpen(hand, curl, index);
      const length = handLength(hand);
      const waveX = wavePosition(hand);
      let motion = this.motions.get(hand.id);
      if (!motion || nowMs - motion.lastSeen > TRACKING_GRACE_MS || nowMs < motion.lastSeen) {
        motion = { lastSeen: nowMs, waveOpenAt: -Infinity, direction: 0, turnX: waveX, extremeX: waveX,
          waveTurns: 0, waveStarted: nowMs, strokeUntil: 0,
          strokeX: hand.palm.x, strokeY: hand.palm.y, strokeAt: nowMs,
          openAt: null, openX: hand.palm.x, openY: hand.palm.y,
          openCurl: curl, openIndex: index, curlStarted: null };
        this.motions.set(hand.id, motion);
      }
      const previousSeen = motion.lastSeen;
      motion.lastSeen = nowMs;
      if (open && hand.points[0].y - hand.points[9].y > length * 0.12) motion.waveOpenAt = nowMs;
      if (nowMs - motion.waveStarted > WAVE_WINDOW_MS || nowMs - motion.waveOpenAt > OPEN_PALM_GRACE_MS) {
        resetWave(motion, waveX, nowMs);
      } else {
        // Detect displacement from extrema, not per-frame velocity. Slow waves,
        // 15/30/60 fps cameras and small tracking noise share the same threshold.
        if (!motion.direction) {
          if (Math.abs(waveX - motion.turnX) / length >= WAVE_REVERSAL_TRAVEL) {
            motion.direction = Math.sign(waveX - motion.turnX);
            motion.extremeX = waveX;
          }
        } else {
          if ((waveX - motion.extremeX) * motion.direction > 0) motion.extremeX = waveX;
          const reversal = (motion.extremeX - waveX) * motion.direction / length;
          if (reversal >= WAVE_REVERSAL_TRAVEL) {
            const travel = Math.abs(motion.extremeX - motion.turnX) / length;
            if (travel >= WAVE_MIN_TRAVEL) {
              if (!motion.waveTurns) motion.waveStarted = nowMs;
              motion.waveTurns++;
              if (motion.waveTurns >= 2 && nowMs - this.waveAt >= WAVE_COOLDOWN_MS) {
                signals.push({ type: "wave", handId: hand.id });
                this.waveAt = nowMs; motion.waveTurns = 0;
              }
            }
            motion.turnX = motion.extremeX; motion.extremeX = waveX; motion.direction *= -1;
          }
        }
      }

      // Accumulated displacement also catches slow/vertical petting that has
      // too little velocity in an individual camera frame to pass a speed gate.
      const strokeTravel = Math.hypot(hand.palm.x - motion.strokeX, hand.palm.y - motion.strokeY) / length;
      if (open && strokeTravel >= 0.12 && nowMs - motion.strokeAt >= 50
        && nowMs - motion.strokeAt <= STROKE_HOLD_MS) {
        motion.strokeUntil = nowMs + STROKE_HOLD_MS;
      }
      if (strokeTravel >= 0.12 || nowMs - motion.strokeAt > STROKE_HOLD_MS) {
        motion.strokeX = hand.palm.x; motion.strokeY = hand.palm.y; motion.strokeAt = nowMs;
      }

      // Learn this hand's extended/resting curl instead of requiring a perfectly
      // straight index. Either one finger or the whole hand may beckon, at any
      // orientation; classifier labels do not gate this motion.
      const canExtend = index < 0.65 || curl < 0.5;
      const travel = Math.hypot(hand.palm.x - motion.openX, hand.palm.y - motion.openY) / length;
      if (motion.openAt !== null && (travel > BECKON_MAX_TRAVEL
        || (motion.curlStarted !== null && nowMs - motion.curlStarted > BECKON_WINDOW_MS))) {
        motion.openAt = null; motion.curlStarted = null;
      }
      if (motion.openAt === null) {
        if (canExtend) {
          motion.openAt = nowMs; motion.openX = hand.palm.x; motion.openY = hand.palm.y;
          motion.openCurl = curl; motion.openIndex = index; motion.curlStarted = null;
        }
      } else {
        motion.openCurl = Math.min(motion.openCurl, curl);
        motion.openIndex = Math.min(motion.openIndex, index);
        const curlChange = curl - motion.openCurl, indexChange = index - motion.openIndex;
        if (curlChange > 0.07 || indexChange > 0.09) {
          motion.curlStarted ??= previousSeen;
          const deliberate = nowMs - motion.curlStarted >= 65 || curlChange > 0.4 || indexChange > 0.45;
          if ((curlChange >= 0.18 || indexChange >= 0.22) && deliberate
            && nowMs - motion.openAt >= BECKON_HOLD_MS && nowMs - this.beckonAt >= BECKON_COOLDOWN_MS) {
            signals.push({ type: "beckon", handId: hand.id });
            this.beckonAt = nowMs; motion.openAt = null; motion.curlStarted = null;
            resetWave(motion, waveX, nowMs);
          }
        } else {
          // Follow normal hand placement while extended; moving an open hand
          // before beckoning must not leave the baseline stranded elsewhere.
          motion.openX = hand.palm.x; motion.openY = hand.palm.y;
          motion.curlStarted = null;
        }
      }
    }
    for (const [id, motion] of this.motions) {
      if (nowMs - motion.lastSeen > TRACKING_GRACE_MS) this.motions.delete(id);
    }
    return signals;
  }
}
