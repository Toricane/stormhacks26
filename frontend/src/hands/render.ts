import type { Hand, Vec2 } from "./types";

const SKIN = "#f2d2b0";
const SKIN_CLOSED = "#e8bf96";
const OUTLINE = "#3a281d";
const CREASE = "rgba(91, 58, 38, 0.38)";
const CONTOUR = "rgba(74, 46, 30, 0.56)";
const FOREARM_LENGTH = 3.2;

/** Drawn back to front: pinky first so the index finger overlaps it. */
const FINGERS: { chain: number[]; width: number }[] = [
  { chain: [17, 18, 19, 20], width: 0.2 },
  { chain: [13, 14, 15, 16], width: 0.235 },
  { chain: [9, 10, 11, 12], width: 0.25 },
  { chain: [5, 6, 7, 8], width: 0.24 },
];
const THUMB = { chain: [1, 2, 3, 4], width: 0.27 };
const DIGITS = [...FINGERS, THUMB];
const PALM = [1, 5, 9, 13, 17];

const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

function drawFinger(
  ctx: CanvasRenderingContext2D,
  pts: Vec2[],
  chain: number[],
  width: number,
  extra: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width + extra;
  ctx.beginPath();
  ctx.moveTo(pts[chain[0]].x, pts[chain[0]].y);
  for (let i = 1; i < chain.length; i++) ctx.lineTo(pts[chain[i]].x, pts[chain[i]].y);
  ctx.stroke();
}

function handBasis(pts: Vec2[]): { dx: number; dy: number; nx: number; ny: number } {
  let dx = pts[0].x - pts[9].x;
  let dy = pts[0].y - pts[9].y;
  const length = Math.hypot(dx, dy) || 1;
  dx /= length;
  dy /= length;
  let nx = -dy;
  let ny = dx;
  if ((pts[1].x - pts[0].x) * nx + (pts[1].y - pts[0].y) * ny < 0) {
    nx *= -1;
    ny *= -1;
  }
  return { dx, dy, nx, ny };
}

function drawForearm(
  ctx: CanvasRenderingContext2D,
  pts: Vec2[],
  u: number,
  extra: number,
  color: string,
): void {
  const wrist = pts[0];
  const { dx, dy, nx, ny } = handBasis(pts);
  const end = { x: wrist.x + dx * u * FOREARM_LENGTH, y: wrist.y + dy * u * FOREARM_LENGTH };
  const wristHalf = u * 0.34 + extra / 2;
  const endHalf = u * 0.43 + extra / 2;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(wrist.x + nx * wristHalf, wrist.y + ny * wristHalf);
  ctx.lineTo(end.x + nx * endHalf, end.y + ny * endHalf);
  ctx.quadraticCurveTo(end.x + dx * u * 0.18, end.y + dy * u * 0.18, end.x - nx * endHalf, end.y - ny * endHalf);
  ctx.lineTo(wrist.x - nx * wristHalf, wrist.y - ny * wristHalf);
  ctx.closePath();
  ctx.fill();
}

function drawPalm(
  ctx: CanvasRenderingContext2D,
  pts: Vec2[],
  u: number,
  extra: number,
  color: string,
): void {
  const { nx, ny } = handBasis(pts);
  const wristThumb = { x: pts[0].x + nx * u * 0.34, y: pts[0].y + ny * u * 0.34 };
  const wristPinky = { x: pts[0].x - nx * u * 0.34, y: pts[0].y - ny * u * 0.34 };
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = u * 0.22 + extra;
  ctx.beginPath();
  ctx.moveTo(wristThumb.x, wristThumb.y);
  for (const index of PALM) ctx.lineTo(pts[index].x, pts[index].y);
  ctx.lineTo(wristPinky.x, wristPinky.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/** One inner edge per digit: enough separation without outlining every bone. */
function drawFingerContours(ctx: CanvasRenderingContext2D, pts: Vec2[], u: number): void {
  ctx.strokeStyle = CONTOUR;
  ctx.lineWidth = Math.max(1, u * 0.022);
  ctx.beginPath();
  for (const f of DIGITS) {
    const base = pts[f.chain[0]];
    const first = pts[f.chain[1]];
    const second = pts[f.chain[2]];
    const tip = pts[f.chain[3]];
    const length = Math.hypot(tip.x - base.x, tip.y - base.y) || 1;
    let nx = -(tip.y - base.y) / length;
    let ny = (tip.x - base.x) / length;
    const towardThumbX = pts[1].x - base.x;
    const towardThumbY = pts[1].y - base.y;
    if (nx * towardThumbX + ny * towardThumbY < 0) {
      nx *= -1;
      ny *= -1;
    }
    const offset = u * f.width * 0.34;
    const startX = base.x + (first.x - base.x) * 0.28 + nx * offset;
    const startY = base.y + (first.y - base.y) * 0.28 + ny * offset;
    const middleX = first.x + (second.x - first.x) * 0.58 + nx * offset;
    const middleY = first.y + (second.y - first.y) * 0.58 + ny * offset;
    const endX = second.x + (tip.x - second.x) * 0.62 + nx * offset;
    const endY = second.y + (tip.y - second.y) * 0.62 + ny * offset;
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(middleX, middleY, endX, endY);
  }
  ctx.stroke();
}

function drawAnatomy(ctx: CanvasRenderingContext2D, pts: Vec2[], u: number, extra: number, color: string): void {
  drawForearm(ctx, pts, u, extra, color);
  for (const f of FINGERS) drawFinger(ctx, pts, f.chain, u * f.width, extra, color);
  drawPalm(ctx, pts, u, extra, color);
  drawFinger(ctx, pts, THUMB.chain, u * THUMB.width, extra, color);
}

function drawCreases(ctx: CanvasRenderingContext2D, pts: Vec2[], u: number): void {
  ctx.strokeStyle = CREASE;
  ctx.lineWidth = Math.max(1, u * 0.018);
  ctx.beginPath();
  ctx.moveTo(pts[1].x, pts[1].y);
  ctx.quadraticCurveTo(pts[2].x, pts[2].y, pts[3].x, pts[3].y);
  const { dx, dy } = handBasis(pts);
  ctx.moveTo(pts[5].x, pts[5].y);
  ctx.quadraticCurveTo(pts[9].x + dx * u * 0.13, pts[9].y + dy * u * 0.13, pts[13].x, pts[13].y);
  ctx.stroke();

  ctx.globalAlpha *= 0.58;
  ctx.beginPath();
  for (const f of DIGITS) {
    const a = pts[f.chain[1]];
    const b = pts[f.chain[2]];
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / length;
    const ny = (b.x - a.x) / length;
    const half = u * f.width * 0.2;
    ctx.moveTo(b.x + nx * half, b.y + ny * half);
    ctx.lineTo(b.x - nx * half, b.y - ny * half);
  }
  ctx.stroke();
  ctx.globalAlpha /= 0.58;
}

export function drawHand(ctx: CanvasRenderingContext2D, hand: Hand, petting: boolean): void {
  const pts = hand.points;
  const u = Math.max(hand.size, 20);
  const outline = Math.max(1.5, u * 0.04);

  ctx.save();
  ctx.globalAlpha = hand.presence;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Drawing the whole outline first and the whole fill second makes overlapping
  // segments read as one silhouette instead of a stack of outlined capsules.
  drawAnatomy(ctx, pts, u, outline * 2, OUTLINE);
  drawAnatomy(ctx, pts, u, 0, hand.closed ? SKIN_CLOSED : SKIN);
  drawFingerContours(ctx, pts, u);
  drawCreases(ctx, pts, u);

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
