# Frontend — Virtual Hands

The browser app for [stormhacks26](../README.md). Your webcam tracks your hands, and virtual hands appear inside a simple 3D world where you can grab and throw a ball and pet a (placeholder) dog. The webcam image itself is never shown — only the hands.

## Running it

Requirements: Node.js 20+ and a webcam. Chrome or Edge recommended (GPU inference).

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and allow camera access. The hand-tracking model and its WebAssembly runtime (several MB) download from CDNs on first load, so you need internet access.

Other scripts: `npm run build` (typecheck + production build into `dist/`), `npm run preview` (serve the build).

## How to use it

1. **Calibrate:** when your hands first appear, hold them at a comfortable resting position for about a second. The HUD says "Calibrating" until it's done. Press `C` any time to recalibrate (e.g. after moving your chair).
2. **Reach in:** push your hand toward the screen to reach deeper into the scene. The hand shrinks with distance and casts a shadow on the ground once it's far enough out.
3. **Grab:** pinch (thumb + index) or make a fist on the ball. The ball glows when it's within reach and turns amber while held.
4. **Throw:** swing toward the screen and let go. Faster swings throw farther. A slow release just drops the ball. The ball returns to its stand once it stops rolling.
5. **Pet:** reach the dog with an open palm and stroke it. Hearts appear and the pet meter in the top bar fills.

| Key | Action |
| --- | --- |
| `C` | Recalibrate hand rest position |
| `R` | Return the ball to its stand |
| `D` | Toggle debug view (tracked points + hand velocity) |

The HUD (top left) shows each hand's detected pose and virtual distance, frame rate, tracking rate and inference time, and the last interaction event.

## Tips

- Good, even lighting on your hands improves tracking a lot. Avoid strong backlight.
- Keep your hands roughly 40–60 cm from the webcam at rest so there's room to push forward.
- If grabbing feels off, recalibrate with `C` while your hands are at rest.
- If the HUD says `CPU` instead of `GPU`, your browser fell back to CPU inference. It still works, just with higher latency.

## Tech

- [MediaPipe Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js) for webcam hand tracking (21 landmarks per hand, up to 2 hands).
- [Three.js](https://threejs.org/) for the 3D world, plus a 2D canvas overlay for the hands.
- TypeScript + Vite, no framework.

## Docs

- [IMPLEMENTATION.md](IMPLEMENTATION.md): how the frontend works, and what still needs to be built.
- [AGENTS.md](AGENTS.md): project map and conventions for AI coding agents.
- [../IMPLEMENTATION.md](../IMPLEMENTATION.md): how the frontend connects to the 3D model / rigging pipeline.
