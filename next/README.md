# Quadruped image → rigged model

Minimal Next.js app: generate a rigged model from an image, upload existing GLBs, and select a model to inspect. Generation uses fal `fal-ai/trellis` → Tripo rig check → quadruped auto rig. Plain CSS, no database or extra services.

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

The keys stay on the server. PNG/JPG/WebP images up to 10 MB are accepted. The pipeline stops if Tripo says the model is not riggable or does not detect a quadruped. Earlier outputs remain available.

The same page includes the image generator, a GLB file uploader, and a model selector. Uploaded GLBs are read locally in the browser. Uploaded and generated models remain in the selector for the current tab, including while another generation runs. The animated dog is available by default.

The viewer supports orbit/zoom/pan, wireframe, skeleton display, and joint rotation on X/Y/Z to inspect deformation. Embedded animation clips have a selector, play/pause, and playback speed controls. Pose changes affect the preview only. No extra animation-generation API calls are made.

After a model loads, the bottom of the viewer shows **Model**, **Animation**, and **First person** options. First person places the model on a flat floor. Click the canvas to capture the mouse, use WASD to move and the mouse to look, and press Esc to release the mouse. Camera height stays fixed at 1.6 units, with no jumping or vertical movement. Models are centered and scaled for this preview; the downloaded GLB is unchanged.

Both `/` and `/dog` open the combined viewer. The supplied `public/dog-animated.glb` includes three looping clips: **Idle** (4 seconds), **Tail wag** (2 seconds), and **Walk** (1.6 seconds, in place). The model, textures, and skin weights are preserved. These are basic procedural motions built locally on its existing 21-joint rig. Select Rest pose to use manual joint controls.

The input image, all output files returned by both providers, and JSON reports are listed with download buttons. Files are downloaded into browser memory immediately because provider URLs can expire. Keep the tab open and download your results before refreshing or closing it. There is no persistent storage or job recovery.

## Check

```sh
npm run typecheck
npm run build
```

## API references

- [fal Trellis](https://fal.ai/models/fal-ai/trellis/api)
- [Tripo rig check](https://developers.tripo3d.ai/en/docs/animations-rig-check)
- [Tripo auto rig](https://developers.tripo3d.ai/en/docs/animations-rig)
- [Tripo task query](https://developers.tripo3d.ai/en/docs/task-query)

Uses Tripo's v3 API and `v2.5-20260210` for quadruped rigging. The local asset proxy accepts fal/Tripo storage domains only.
