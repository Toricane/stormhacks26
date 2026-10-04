"use client";

import { useEffect, useRef, useState } from "react";
import { HandSystem, type Viewport } from "@/lib/hands/handSystem";
import { drawHand } from "@/lib/hands/render";
import type { HandTracker } from "@/lib/hands/tracker";
import type { Pose } from "@/lib/hands/types";
import type { HandFrame } from "@/lib/lifelike/controller";

const ACTIONS: Record<Pose, string> = {
  open: "Open hand",
  point: "Pointing",
  pinch: "Pinching",
  fist: "Fist",
  relaxed: "Relaxed",
};
const MAX_PIXEL_RATIO = 2;
const NO_HANDS = "Show your hands to the camera";

function cameraError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return "Allow camera access, then re-enter First person";
    if (error.name === "NotFoundError") return "No camera found";
    if (error.name === "NotReadableError") return "Camera is busy — close other camera apps and re-enter First person";
  }
  return "Hand tracking unavailable — re-enter First person to retry";
}

type Props = { navigationError: string; behaviorAction?: string; onHands?: (frame: HandFrame | null) => void };

export default function FirstPersonHands({ navigationError, behaviorAction, onHands }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [action, setAction] = useState("Starting camera…");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const video = videoRef.current!;
    const ctx = canvas.getContext("2d");
    if (!ctx) { setAction("Hand drawing is unavailable in this browser"); return; }

    const system = new HandSystem();
    const viewport: Viewport = { width: 0, height: 0, videoWidth: 640, videoHeight: 480 };
    let tracker: HandTracker | null = null;
    let stream: MediaStream | null = null;
    let closed = false;
    let frame = 0;
    let dpr = 1;
    let lastAction = "Starting camera…";
    let sampleTime = -1;

    const showAction = (text: string) => {
      if (closed || text === lastAction) return;
      lastAction = text;
      setAction(text);
    };
    const resize = () => {
      viewport.width = canvas.clientWidth;
      viewport.height = canvas.clientHeight;
      dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      canvas.width = Math.round(viewport.width * dpr);
      canvas.height = Math.round(viewport.height * dpr);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const release = () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      stream?.getTracks().forEach(track => track.stop());
      stream = null;
      video.pause();
      video.srcObject = null;
      tracker?.dispose();
      onHands?.(null);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    const fail = (error: unknown) => {
      if (closed) return;
      console.warn("First-person hand tracking:", error);
      showAction(cameraError(error));
      setReady(false);
      closed = true;
      release();
    };
    const draw = (nowMs: number) => {
      if (closed || !tracker) return;
      try {
        viewport.videoWidth = video.videoWidth || 640;
        viewport.videoHeight = video.videoHeight || 480;
        const raw = tracker.detect(video, nowMs);
        const hands = system.update(raw, nowMs, viewport);
        if (raw !== null) sampleTime = nowMs;
        onHands?.({ hands, viewport, sampleTime });
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, viewport.width, viewport.height);
        for (const hand of hands) drawHand(ctx, hand);
        const live = hands.filter(hand => !hand.stale).sort((a, b) => a.label.localeCompare(b.label));
        showAction(live.map(hand => `${hand.label}: ${ACTIONS[hand.pose]}`).join(" · ") || NO_HANDS);
        frame = requestAnimationFrame(draw);
      } catch (error) { fail(error); }
    };

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is unavailable");
        const camera = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
        });
        // A permission prompt can finish after the user has left first person.
        if (closed) { camera.getTracks().forEach(track => track.stop()); return; }
        stream = camera;
        video.srcObject = camera;
        await video.play();
        if (closed) return;
        showAction("Starting hand tracking…");
        const { HandTracker } = await import("@/lib/hands/tracker");
        if (closed) return;
        tracker = new HandTracker();
        await tracker.init();
        if (closed) return;
        setReady(true);
        showAction(NO_HANDS);
        frame = requestAnimationFrame(draw);
      } catch (error) { fail(error); }
    }
    void start();

    return () => { closed = true; release(); };
  }, [onHands]);

  return <>
    <video ref={videoRef} className="viewer-hand-video" autoPlay muted playsInline aria-hidden="true" />
    <canvas ref={canvasRef} className="viewer-hands" aria-hidden="true" />
    <div className="viewer-hand-action" role="status" aria-live="polite">{navigationError || (ready && behaviorAction) || action}</div>
  </>;
}
