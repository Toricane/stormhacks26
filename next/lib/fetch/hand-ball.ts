import * as THREE from "three";
import type { Hand } from "../hands/types";
import type { HandFrame } from "../lifelike/controller";

const SAMPLE_MAX_AGE = 220;
const THROW_WINDOW_MS = 140;
const THROW_GAIN = 1.65;
const MAX_THROW_SPEED = 12;

export function liveHands(frame: HandFrame | null, now: number): Hand[] {
  return frame && now - frame.sampleTime <= SAMPLE_MAX_AGE && frame.viewport.width > 0 && frame.viewport.height > 0
    ? frame.hands.filter(hand => !hand.stale && hand.presence > .3) : [];
}

/** Same mirrored, finite-depth placement used by Lifelike touch. */
export function gripPosition(hand: Hand, frame: HandFrame, camera: THREE.PerspectiveCamera, out: THREE.Vector3): THREE.Vector3 {
  const distance = THREE.MathUtils.clamp(.8 + hand.reach * 4, .25, 2.2);
  return out.set(hand.pinchPoint.x / frame.viewport.width * 2 - 1,
    1 - hand.pinchPoint.y / frame.viewport.height * 2, .5).unproject(camera)
    .sub(camera.position).normalize().multiplyScalar(distance).add(camera.position);
}

/** Camera-local samples prevent WASD or mouse look from becoming throw force. */
export class ThrowSamples {
  private readonly samples: { time: number; point: THREE.Vector3 }[] = [];
  clear(): void { this.samples.length = 0; }
  add(time: number, worldPoint: THREE.Vector3, camera: THREE.PerspectiveCamera): void {
    if (this.samples.at(-1)?.time === time) return;
    this.samples.push({ time, point: camera.worldToLocal(worldPoint.clone()) });
    while (this.samples.length > 2 && this.samples[1].time < time - THROW_WINDOW_MS) this.samples.shift();
  }
  velocity(camera: THREE.PerspectiveCamera, out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    const first = this.samples[0], last = this.samples.at(-1);
    if (!first || !last || last.time - first.time < 15 || last.time - first.time > 300) return out;
    out.copy(last.point).sub(first.point).multiplyScalar(1000 * THROW_GAIN / (last.time - first.time));
    if (out.length() > MAX_THROW_SPEED) out.setLength(MAX_THROW_SPEED);
    return out.applyQuaternion(camera.quaternion);
  }
}
