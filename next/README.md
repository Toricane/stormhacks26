# Image → rigged model

Minimal Next.js app: generate a rigged model from an image, upload existing GLBs, and select a model to inspect. Generation uses fal → Tripo rig check → Tripo auto rig. Plain CSS, no database or extra services.

## Run

Use Node.js 20.9 or newer.

1. Put your keys in the project root `.env`:

   ```dotenv
   FAL_KEY=your_fal_key
   TRIPO_API_KEY=your_tripo_key
   ```

2. Install and start:

   ```sh
   npm install
   npm run dev
   ```

3. Open http://localhost:3000. Restart the server after changing `.env`.

The keys stay on the server. PNG/JPG/WebP images up to 10 MB are accepted. The pipeline stops if Tripo says the model is not riggable. Choose the rig type before generating; the rig-check report shows Tripo’s recommendation, and auto rig uses your selection. **No rigging** skips both the Tripo rig check and auto rig, and keeps the generated GLB and byproducts available to view and download. Only `FAL_KEY` is required for this option. Earlier outputs remain available.

The same page includes the image generator, a GLB file uploader, and a model selector. Uploaded GLBs are read locally in the browser. Uploaded and generated models remain in the selector for the current tab, including while another generation runs. The animated dog and Pikachu are available by default.

The viewer supports orbit/zoom/pan, wireframe, skeleton display, and joint rotation on X/Y/Z to inspect deformation. Embedded animation clips have a selector, play/pause, replay, and playback speed controls. Selecting an animation blends over 0.22 seconds. The viewer shows each clip's duration, description, and whether it loops or plays once. One-shot clips settle at their ending pose; use Replay to trigger them again. Uploaded clips without loop metadata keep looping. Pose changes affect the preview only. No extra animation-generation API calls are made.

After a model loads, the bottom of the viewer shows **Model**, **Animation**, and **First person** options. First person places the model on a flat floor. Click the canvas to capture the mouse, use WASD to move and the mouse to look, and press Esc to release the mouse. Camera height stays fixed at 1.6 units, with no jumping or vertical movement. Models are centered and scaled for this preview; the downloaded GLB is unchanged.

The combined viewer opens at `/`. The supplied GLBs include these locally authored animations on their existing rigs:

| Model | Looping clips | One-shot clips |
| --- | --- | --- |
| Pikachu (16 joints) | Idle, Happy, Walk, Petting, Drowsy | Headpat, Wave, Curious, Nuzzle, Startled |
| Dog (21 joints) | Idle, Tail wag, Walk, Trot, Scratch, Happy, Sniff | Headpat, Curious, Play bow, Shake, Offer paw |

Pikachu's wave raises one paw and waves three times. Affection clips relax its ears and lean its head into a hand. The dog's petting reactions combine head movement with wagging; its bow, sniff, trot, and offered paw use leg IK to position the paws. These rigs do not have facial expression controls. The original model geometry, textures, skin weights, and existing animation clips are preserved. Select Model or Rest pose to inspect the rig manually.

### Extending the animation library

Run `npm run animate:creatures` to regenerate the additional embedded clips in `public/Pikachu.glb` and `public/dog-animated.glb`. The script uses those supplied assets as its inputs, preserves their original binary data, and replaces only its own generated animation data on later runs. Regeneration is deterministic and does not grow the files repeatedly. The poses live in `work/animate-creatures.mjs`; shared GLB sampling/export and dog leg IK live in `work/creature-animation-tools.mjs`. Generated clips are sampled at 30 fps with matching loop endpoints and full joint transforms for consistent blending.

`lib/creature-animation-player.ts` provides reusable `play(name, fadeSeconds?)`, `update(delta)`, `setPlayback(playing, speed)`, `stop()`, and `dispose()` methods. GLB animation extras are loaded into `AnimationClip.userData`; `describeAnimation()` exposes loop, duration, category, description, and in-place metadata. New one-shot reactions begin and end at rest; locomotion clips stay in place. A future computer vision/behavior controller can select a clip and move/turn the character's parent group toward a hand without animation root motion fighting it. Gesture detection and autonomous behavior remain separate work.

`work/render-creatures.py` creates pose contact sheets for visual inspection using Python with NumPy and Pillow.

The input image, all output files returned by both providers, and JSON reports are listed with download buttons. Files are downloaded into browser memory immediately because provider URLs can expire. Keep the tab open and download your results before refreshing or closing it. There is no persistent storage or job recovery.

## Check

```sh
npm run typecheck
npm run build
npm run test:animations
```

The animation tests use Node's native TypeScript support and require Node.js 22.18 or newer. They check one-shot completion/replay, loop playback, pause/speed, rapid crossfades, rest-pose restoration, and embedded GLB track validity and loop seams.

## API references

- [fal Trellis](https://fal.ai/models/fal-ai/trellis/api)
- [Tripo rig check](https://developers.tripo3d.ai/en/docs/animations-rig-check)
- [Tripo auto rig](https://developers.tripo3d.ai/en/docs/animations-rig)
- [Tripo task query](https://developers.tripo3d.ai/en/docs/task-query)

Rig types: biped, quadruped, hexapod, octopod, avian, serpentine, and aquatic. Quadruped is selected by default. Uses Tripo's v3 API, `v1.0-20240301` for bipeds, and `v2.5-20260210` for the other types. The local asset proxy accepts fal/Tripo storage domains only.
