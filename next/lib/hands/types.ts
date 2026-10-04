export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

export type Pose = "open" | "point" | "pinch" | "fist" | "relaxed";

/** One hand as reported by MediaPipe for a single video frame. */
export type RawHand = {
  /** Normalized image coords, unmirrored camera space. */
  image: Vec3[];
  /** Metric coords (meters) centered on the hand. Scale/rotation invariant. */
  world: Vec3[];
  label: string;
};

/** A tracked, smoothed hand in screen space (CSS pixels, mirrored). */
export type Hand = {
  id: number;
  label: string;
  points: Vec2[];
  /** Smoothed metric landmarks (meters) in webcam axes: x right, y down, z away from the webcam. */
  world: Vec3[];
  pose: Pose;
  /** Pinch or fist, debounced. Use this for grabbing. */
  closed: boolean;
  palm: Vec2;
  pinchPoint: Vec2;
  /** Palm velocity in px/s, measured from unsmoothed positions. */
  velocity: Vec2;
  /** Rate of change of log hand scale (1/s). Positive when moving toward the webcam. */
  growth: number;
  /** Observed screen px per real-world meter at the hand, robust to hand tilt. */
  pxPerMeter: number;
  /** Meters the hand is pushed toward the webcam from its calibrated rest position. */
  reach: number;
  /** Wrist to middle-knuckle distance in px; scales rendering and hit radii. */
  size: number;
  /** True when no detection has arrived recently (tracking dropped). */
  stale: boolean;
  /** 0..1, fades out when tracking is lost. */
  presence: number;
};
