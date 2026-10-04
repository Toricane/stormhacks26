# AGENTS.md (frontend)

Webcam hand tracking → virtual hands in a Three.js world. It's judged on **framerate/efficiency, interactivity, aesthetics**, so keep the per-frame path cheap. Deep detail: [IMPLEMENTATION.md](IMPLEMENTATION.md). Repo-level context: [../AGENTS.md](../AGENTS.md).

## Commands (run from `frontend/`)

- `npm run dev`: Vite dev server on http://localhost:5173 (often already running; check terminals first).
- `npm run build`: `tsc` + Vite build. **Run this to verify changes**; there are no tests. The >500 kB chunk warning is expected (Three.js).
- Windows + PowerShell: no `&&` chaining, use `;`.

## Layout

```
src/main.ts               Bootstrap, render loop, HUD, keyboard (C/R/D)
src/style.css             Full-screen canvases + HUD styles
src/hands/                Tracking only: no Three.js imports here
  tracker.ts              MediaPipe HandLandmarker wrapper (GPU, CPU fallback)
  handSystem.ts           Slots: identity matching, One Euro smoothing, pose debounce,
                          velocity/growth, depth calibration (reach)
  pose.ts                 Pose classifier from metric world landmarks
  oneEuro.ts              One Euro filter
  render.ts               2D canvas hand drawing + debug skeleton
  types.ts                Hand, RawHand, Pose, Vec2/Vec3
src/world/                3D world + gameplay
  world.ts                Scene, fixed camera, ground, sky, stand, dog placeholder,
                          ball mesh, trail, projection helpers
  handDepth.ts            Hand → PlacedHand (virtual distance, perspective rescale),
                          ground shadows
  interactions.ts         Ball state machine + physics, grab/throw/pet, event emitter
  hearts.ts               2D heart particles
public/                   Static assets served at / (put models in public/models/)
```

## Frame pipeline (main.ts)

`tracker.detect` (only on new video frames) → `handSystem.update` → `placeHand` → `interactions.update` → `world.render()` → overlay: shadows, hands, hearts.

## Coordinate systems (most bugs live here)

- **MediaPipe image coords**: normalized, unmirrored. `handSystem` mirrors x (`1 - x`) once; everything downstream is mirrored.
- **Screen**: CSS px, full window. Video is mapped "cover"-style (`toScreen`), so it's cropped, not stretched.
- **World**: meters, Y up, camera fixed at `(0, 1.4, 0)` looking down −Z. Screen right = +X, into the screen = −Z.
- **Depth**: bigger hand in the webcam = closer to the *webcam* = **deeper** into the scene. `reach` is meters pushed toward the webcam from the calibrated rest position. `PlacedHand.distance` is the virtual eye-to-palm distance.
- Hand speeds are normalized by `handLengthPx` (hand-lengths/s) so they don't depend on camera distance. Use `handLengthPx`, not `size` (`size` is rescaled for drawing).

## Conventions

- TS is strict with `noUnusedLocals/Parameters`, `erasableSyntaxOnly` (**no enums, no constructor parameter properties, no namespaces**), `verbatimModuleSyntax` (use `import type` for types).
- Tuning values are `UPPER_SNAKE` constants at the top of each file; put new ones there too.
- Comments only for non-obvious constraints, not narration.
- Avoid per-frame allocations in hot paths where easy (reuse `THREE.Vector3`s, as `world.ts`/`interactions.ts` do).
- Gameplay reacts through `interactions.on(event => …)`. Add new behavior as events rather than coupling modules.
- Keep `src/hands/` free of Three.js so tracking stays reusable.
- The dog model contract (format, axes, bones, clips) is in [../IMPLEMENTATION.md](../IMPLEMENTATION.md). Follow it when loading the model.

## Gotchas

- `#webcam` must stay *playing*: it's hidden with `opacity: 0; 1px`, **not** `display: none`.
- MediaPipe handedness assumes a mirrored image, so `tracker.ts` swaps Left/Right.
- `detectForVideo` is synchronous and blocks the main thread (~5–15 ms on GPU). Timestamps must strictly increase (we pass the rAF time).
- Three r186 removed `PCFSoftShadowMap`; use `PCFShadowMap`.
- The WASM runtime and model load from CDNs (jsdelivr, storage.googleapis.com); offline won't work.
- The in-app preview browser can't access the webcam and throttles rAF, so verify hand behavior with the user, and verify code with `npm run build`.
- The render loop starts before the camera so the scene shows even if permission is denied.

## Where to tune

| Feel | File | Constants |
| --- | --- | --- |
| Pose thresholds | `hands/pose.ts` | `EXTENDED_MAX_BEND`, `CURLED_MIN_BEND`, `PINCH_ENTER/EXIT` |
| Jitter vs lag | `hands/handSystem.ts` | `FILTER_MIN_CUTOFF`, `FILTER_BETA`, `POSE_FRAMES` |
| Depth calibration | `hands/handSystem.ts` | `REST_CAMERA_DISTANCE`, `CALIBRATION_SAMPLES`, `REACH_MIN/MAX` |
| Reach sensitivity | `world/handDepth.ts` | `REACH_GAIN`, `VIRTUAL_REST_DISTANCE` |
| Throw strength | `world/interactions.ts` | `THROW_*` |
| Grab/pet tolerance | `world/interactions.ts` | `BALL_DEPTH_TOLERANCE`, `DOG_DEPTH_TOLERANCE`, `PET_MIN_SPEED` |
