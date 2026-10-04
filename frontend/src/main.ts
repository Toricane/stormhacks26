import "./style.css";
import { HandSystem, type Viewport } from "./hands/handSystem";
import { drawHand, drawSkeleton } from "./hands/render";
import { HandTracker } from "./hands/tracker";
import { drawHandShadows, placeHand } from "./world/handDepth";
import { Hearts } from "./world/hearts";
import { Interactions, type InteractionEvent } from "./world/interactions";
import { World } from "./world/world";

const video = document.querySelector<HTMLVideoElement>("#webcam")!;
const worldCanvas = document.querySelector<HTMLCanvasElement>("#world")!;
const overlay = document.querySelector<HTMLCanvasElement>("#overlay")!;
const ctx = overlay.getContext("2d")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const perfEl = document.querySelector<HTMLElement>("#perf")!;
const eventEl = document.querySelector<HTMLElement>("#event")!;
const petBar = document.querySelector<HTMLElement>("#pet-bar")!;

const tracker = new HandTracker();
const handSystem = new HandSystem();
const world = new World(worldCanvas);
const interactions = new Interactions(world);
const hearts = new Hearts();

let dpr = 1;
let debug = false;
let lastFrameMs = performance.now();
let frames = 0;
let detections = 0;
let detectMsAvg = 0;
let lastHudMs = 0;
let lastEvent: InteractionEvent | null = null;

function resize(): void {
  dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = window.innerWidth;
  const h = window.innerHeight;
  overlay.width = Math.round(w * dpr);
  overlay.height = Math.round(h * dpr);
  world.resize(w, h, dpr);
}

function viewport(): Viewport {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
  };
}

function describe(e: InteractionEvent): string {
  switch (e.type) {
    case "grab":
      return e.target === "ball" ? "grabbed ball" : "grab";
    case "release":
      return "dropped ball";
    case "throw": {
      const { x, y, z } = e.velocity;
      return `throw ${Math.hypot(x, y, z).toFixed(1)} m/s`;
    }
    case "landed":
      return `landed ${Math.hypot(e.position.x, e.position.z).toFixed(1)} m away`;
    case "returned":
      return "ball returned";
    case "pet":
      return `petting ${Math.round(e.strength * 100)}%`;
  }
}

interactions.on((e) => {
  lastEvent = e;
});

async function startCamera(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
  });
  video.srcObject = stream;
  await video.play();
}

function frame(nowMs: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (nowMs - lastFrameMs) / 1000));
  lastFrameMs = nowMs;
  frames += 1;

  const vp = viewport();
  const t0 = performance.now();
  const raw = tracker.detect(video, nowMs);
  if (raw) {
    detections += 1;
    detectMsAvg += (performance.now() - t0 - detectMsAvg) * 0.1;
  }

  const hands = handSystem.update(raw, nowMs, vp).map((h) => placeHand(h, world));
  interactions.update(hands, dt, nowMs);
  for (const p of interactions.heartSpawns) hearts.spawn(p);
  hearts.step(dt);

  world.render();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, vp.width, vp.height);
  drawHandShadows(ctx, hands, world);
  for (const hand of hands) {
    drawHand(ctx, hand, interactions.pettingHands.has(hand.id));
    if (debug) drawSkeleton(ctx, hand);
  }
  hearts.draw(ctx);
  petBar.style.transform = `scaleX(${interactions.petLevel})`;

  if (nowMs - lastHudMs >= 500) {
    const secs = (nowMs - lastHudMs) / 1000;
    perfEl.textContent = `${Math.round(frames / secs)} fps · tracking ${Math.round(detections / secs)} Hz · ${detectMsAvg.toFixed(1)} ms ${tracker.delegate}`;
    const live = hands.filter((h) => !h.stale);
    if (tracker.ready && video.readyState >= 2) {
      if (live.length === 0) statusEl.textContent = "Show your hands to the camera";
      else if (handSystem.calibrating) statusEl.textContent = "Calibrating: hold hands at a comfortable rest…";
      else statusEl.textContent = live.map((h) => `${h.label}: ${h.pose} · ${h.distance.toFixed(2)} m`).join("  |  ");
    }
    eventEl.textContent = lastEvent ? describe(lastEvent) : "–";
    frames = 0;
    detections = 0;
    lastHudMs = nowMs;
  }
}

window.addEventListener("resize", resize);
window.addEventListener("keydown", (e) => {
  if (e.key === "d" || e.key === "D") debug = !debug;
  if (e.key === "r" || e.key === "R") interactions.dock();
  if (e.key === "c" || e.key === "C") handSystem.recalibrate();
});

async function main(): Promise<void> {
  resize();
  lastHudMs = performance.now();
  requestAnimationFrame(frame);
  try {
    await tracker.init();
    statusEl.textContent = "Starting camera…";
    await startCamera();
    statusEl.textContent = "Show your hands to the camera";
  } catch (err) {
    console.error(err);
    statusEl.textContent = err instanceof Error ? `Error: ${err.message}` : "Failed to start hand tracking";
  }
}

main();
