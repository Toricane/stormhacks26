import type { Hand, Vec2 } from "./types";

const SKIN = "#f2d2b0";
const SKIN_CLOSED = "#e8bf96";
const OUTLINE = "#3a281d";

/** Drawn back to front: pinky first so the index finger overlaps it. */
const FINGERS: { chain: number[]; width: number }[] = [
  { chain: [17, 18, 19, 20], width: 0.2 },
  { chain: [13, 14, 15, 16], width: 0.235 },
  { chain: [9, 10, 11, 12], width: 0.25 },
  { chain: [5, 6, 7, 8], width: 0.24 },
];
const THUMB = { chain: [1, 2, 3, 4], width: 0.27 };
const SEGMENT_TAPER = [1.05, 0.93, 0.84];
const PALM = [0, 1, 5, 9, 13, 17];

const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

function segment(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2, width: number): void {
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawFinger(
  ctx: CanvasRenderingContext2D,
  pts: Vec2[],
  chain: number[],
  width: number,
  outline: number,
  fill: string,
): void {
  for (const [color, extra] of [[OUTLINE, outline * 2], [fill, 0]] as const) {
    ctx.strokeStyle = color;
    for (let i = 0; i < chain.length - 1; i++) {
      segment(ctx, pts[chain[i]], pts[chain[i + 1]], width * SEGMENT_TAPER[i] + extra);
    }
  }
}

function drawPalm(ctx: CanvasRenderingContext2D, pts: Vec2[], u: number, outline: number, fill: string): void {
  const wrist = pts[0];
  const forearm = { x: wrist.x + (wrist.x - pts[9].x) * 0.6, y: wrist.y + (wrist.y - pts[9].y) * 0.6 };
  const rounding = u * 0.3;

  for (const [color, extra] of [[OUTLINE, outline * 2], [fill, 0]] as const) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    segment(ctx, wrist, forearm, u * 0.62 + extra);
    ctx.lineWidth = rounding + extra;
    ctx.beginPath();
    ctx.moveTo(pts[PALM[0]].x, pts[PALM[0]].y);
    for (let i = 1; i < PALM.length; i++) ctx.lineTo(pts[PALM[i]].x, pts[PALM[i]].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

export function drawHand(ctx: CanvasRenderingContext2D, hand: Hand, petting: boolean): void {
  const pts = hand.points;
  const u = Math.max(hand.size, 20);
  const outline = Math.max(1.5, u * 0.04);
  const fill = hand.closed ? SKIN_CLOSED : SKIN;

  ctx.save();
  ctx.globalAlpha = hand.presence;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  drawPalm(ctx, pts, u, outline, fill);
  for (const f of FINGERS) drawFinger(ctx, pts, f.chain, u * f.width, outline, fill);
  drawFinger(ctx, pts, THUMB.chain, u * THUMB.width, outline, fill);

  if (hand.pose === "pinch") {
    ctx.strokeStyle = "rgba(255, 196, 92, 0.95)";
    ctx.lineWidth = Math.max(2, u * 0.05);
    ctx.beginPath();
    ctx.arc(hand.pinchPoint.x, hand.pinchPoint.y, u * 0.22, 0, Math.PI * 2);
    ctx.stroke();
  } else if (petting) {
    ctx.strokeStyle = "rgba(120, 220, 150, 0.85)";
    ctx.lineWidth = Math.max(2, u * 0.05);
    ctx.beginPath();
    ctx.arc(hand.palm.x, hand.palm.y, u * 0.75, 0, Math.PI * 2);
    ctx.stroke();
  }

  const label = hand.pose;
  ctx.font = `600 ${Math.round(Math.max(11, Math.min(16, u * 0.16)))}px "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const labelPos = { x: pts[0].x, y: pts[0].y + u * 0.45 };
  const w = ctx.measureText(label).width + 14;
  ctx.fillStyle = "rgba(10, 14, 12, 0.7)";
  ctx.beginPath();
  ctx.roundRect(labelPos.x - w / 2, labelPos.y - 3, w, 22, 11);
  ctx.fill();
  ctx.fillStyle = "#e8f0e6";
  ctx.fillText(label, labelPos.x, labelPos.y);

  ctx.restore();
}

export function drawSkeleton(ctx: CanvasRenderingContext2D, hand: Hand): void {
  const pts = hand.points;
  ctx.save();
  ctx.globalAlpha = hand.presence;
  ctx.strokeStyle = "rgba(90, 200, 255, 0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [a, b] of CONNECTIONS) {
    ctx.moveTo(pts[a].x, pts[a].y);
    ctx.lineTo(pts[b].x, pts[b].y);
  }
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  for (const p of pts) ctx.fillRect(p.x - 2, p.y - 2, 4, 4);

  ctx.strokeStyle = "rgba(255, 120, 90, 0.9)";
  ctx.beginPath();
  ctx.moveTo(hand.palm.x, hand.palm.y);
  ctx.lineTo(hand.palm.x + hand.velocity.x * 0.1, hand.palm.y + hand.velocity.y * 0.1);
  ctx.stroke();
  ctx.restore();
}
