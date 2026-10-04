import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { RawHand } from "./types";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";

/** MediaPipe labels handedness assuming a mirrored image; our input is the raw camera. */
const SWAP_LABEL: Record<string, string> = { Left: "Right", Right: "Left" };

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private lastVideoTime = -1;
  private disposed = false;
  delegate: "GPU" | "CPU" = "GPU";

  get ready(): boolean {
    return this.landmarker !== null;
  }

  async init(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    if (this.disposed) return;
    const create = (delegate: "GPU" | "CPU") =>
      HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

    let landmarker: HandLandmarker;
    try {
      landmarker = await create("GPU");
    } catch {
      if (this.disposed) return;
      this.delegate = "CPU";
      landmarker = await create("CPU");
    }
    if (this.disposed) landmarker.close();
    else this.landmarker = landmarker;
  }

  /** Returns null when there is no new video frame to process. */
  detect(video: HTMLVideoElement, timestampMs: number): RawHand[] | null {
    if (!this.landmarker || video.readyState < 2) return null;
    if (video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = video.currentTime;

    const result = this.landmarker.detectForVideo(video, timestampMs);
    return result.landmarks.map((image, i) => {
      const label = result.handedness[i]?.[0]?.categoryName ?? "Unknown";
      return { image, world: result.worldLandmarks[i], label: SWAP_LABEL[label] ?? label };
    });
  }

  dispose(): void {
    this.disposed = true;
    this.landmarker?.close();
    this.landmarker = null;
  }
}
