import * as THREE from "three";
import type { Hand, Vec2 } from "../hands/types";
import type { World } from "./world";

export const PALM_LENGTH = 0.09;
/** Virtual eye-to-hand distance when the real hand is at its rest position. */
const VIRTUAL_REST_DISTANCE = 0.45;
/** A ~25 cm real push maps to ~1 m of virtual reach. */
const REACH_GAIN = 4;
const VIRTUAL_MIN_DISTANCE = 0.25;
const VIRTUAL_MAX_DISTANCE = 2.2;

/** A hand drawn and tested for contact at its virtual perspective size. */
export type PlacedHand = Hand & {
  /** Virtual eye-to-palm distance in meters. */
  distance: number;
  palmWorld: THREE.Vector3;
  /** Observed (unscaled) palm length in screen px; normalizes motion speeds. */
  handLengthPx: number;
};

export function placeHand(hand: Hand, world: World): PlacedHand {
  const distance = THREE.MathUtils.clamp(
    VIRTUAL_REST_DISTANCE + hand.reach * REACH_GAIN,
    VIRTUAL_MIN_DISTANCE,
    VIRTUAL_MAX_DISTANCE,
  );
  // Scale the glove and its grip together so visible contact matches pickup.
  const projectedPxPerMeter = world.focalPx() / distance;
  const scale = projectedPxPerMeter / Math.max(hand.pxPerMeter, 1);
  const palm = hand.palm;
  const projectPoint = (point: Vec2): Vec2 => ({
    x: palm.x + (point.x - palm.x) * scale,
    y: palm.y + (point.y - palm.y) * scale,
  });
  return {
    ...hand,
    points: hand.points.map(projectPoint),
    pinchPoint: projectPoint(hand.pinchPoint),
    size: projectedPxPerMeter * PALM_LENGTH,
    distance,
    palmWorld: world.rayPoint(hand.palm, distance),
    handLengthPx: hand.pxPerMeter * PALM_LENGTH,
  };
}

/** Soft contact shadow on the ground under each palm. */
export function drawHandShadows(ctx: CanvasRenderingContext2D, hands: PlacedHand[], world: World): void {
  const ground = new THREE.Vector3();
  ctx.save();
  for (const hand of hands) {
    ground.set(hand.palmWorld.x, 0.002, hand.palmWorld.z);
    if (ground.clone().sub(world.camera.position).dot(world.forward) <= 0.1) continue;
    const s = world.project(ground);
    const r = world.screenRadius(ground, 0.08);
    const squash = world.camera.position.y / Math.max(s.depth, 0.1);
    const height = Math.max(0, hand.palmWorld.y);
    ctx.globalAlpha = hand.presence * 0.4 * Math.max(0.25, 1 - height / 2);
    ctx.fillStyle = "#1d2a14";
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, r, Math.max(1, r * squash), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
