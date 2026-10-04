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
   pnpm install
   npm run dev
   ```

3. Open http://localhost:3000. Restart the server after changing `.env`.

The keys stay on the server. PNG/JPG/WebP images up to 10 MB are accepted. The pipeline stops if Tripo says the model is not riggable. Choose the rig type before generating; the rig-check report shows Tripo’s recommendation, and auto rig uses your selection. **No rigging** skips both the Tripo rig check and auto rig, and keeps the generated GLB and byproducts available to view and download. Only `FAL_KEY` is required for this option. Earlier outputs remain available.

A minimal white, gray, and black toolbar places a placeholder Studio logo on the left and **View** / **Generate** buttons on the right. **Generate** contains the existing image upload and rig-type controls, plus disabled Behavior and Image generator placeholders; reference-image/prompt generation and behavior authoring are deferred. **View** orders its settings as **View type → Environment → Model (optional)**, followed by a local GLB upload and a **View** button. The scene starts paused. Changing a setting pauses it and keeps the current preview still; click View to apply the selected settings and activate rendering, animations, navigation, and (with a model) webcam hands. Paused scenes render only when resized or otherwise updated. Uploaded GLBs are read locally in the browser. Uploaded and generated models remain in the selector for the current tab, including while another generation runs. The animated dog, Pikachu, LeBron James, and Keanu Reeves are available by default.

The viewer supports orbit/zoom/pan, wireframe, skeleton display, and joint rotation on X/Y/Z to inspect deformation. Embedded animation clips have a selector, play/pause, Replay, and playback speed controls. Selection blends over 0.22 seconds, including interrupted gestures. Each clip shows its duration, loop mode, and description. Human reactions play once and settle at rest; clips without loop metadata continue looping. Pose changes affect the preview only. No extra animation-generation API calls are made.

The **View type** selector offers **Model**, **Animation**, **First person**, and **Lifelike** before the scene loads. The chosen view and environment persist when switching models or toolbar tabs. Skeleton display starts off; inspection, posing, and playback controls appear below the scene when relevant. First person places the optional model in the selected environment. Click the canvas to capture the mouse, use WASD to move and the mouse to look, and press Esc to release the mouse. Camera height stays fixed at 1.6 units, with no jumping or vertical movement. Keanu is scaled to 1.72 units tall so his eyes are near camera height; LeBron is 2.06 units tall so his eyes sit higher. Their previews start facing the camera with a level gaze. Other models use a 1.2-unit largest dimension. Models are centered and scaled for this preview; the downloaded GLB is unchanged.

### First-person hands

Entering **First person** with a model requests webcam access and overlays both detected hands on the existing 3D scene. The hands use the same white glove, dark sleeve, mirrored cover mapping, smoothing, identity matching, and pose debounce as `frontend/`. The in-view readout sits at the top center: **Left / Right: Open hand, Pointing, Pinching, Fist, or Relaxed**, or the current fetch action. When no hands are detected, it asks you to show your hands. Camera startup and access errors use that same readout. Animation controls remain available in Animation view.

Click the 3D canvas to capture the mouse, use WASD to move, and press Esc to release the mouse. Hand tracking continues while first person is selected, including when the mouse is released. Returning to Model or Animation, or selecting another model, stops the webcam tracks and disposes the tracker. First person and Lifelike share the same camera session; return to Model and re-enter either hand view to retry camera access after an error.

`components/first-person-hands.tsx` owns camera/tracker lifecycle and the transparent canvas overlay. `lib/hands/` copies the reusable tracking and drawing modules from `frontend/src/hands/`; later hand changes should be kept in sync. Rendering coordinates use the viewer's CSS dimensions rather than the window. MediaPipe processes only new video frames, tracks up to two hands, and falls back from GPU to CPU. Its WASM (`tasks-vision@1.0.1`) and hand model load from jsDelivr and Google Storage, so network access is needed. Camera access requires localhost or HTTPS. Verify actual two-hand movement and poses in a browser with webcam access; the in-app preview cannot access the webcam.

### Lifelike view

**Lifelike** uses the same first-person camera and both tracked hands, with automatic behavior for the selected character. The top-center readout shows its current action. Idle layers variable breathing, held glances toward you or the surroundings, small upper-body posture shifts, and occasional ear/tail motion over the existing clips. Each has its own timing, and the layer preserves planted feet. Characters also take short ground-level strolls within 1.1 units of their nearby home position and play character-specific reactions without choosing the same reaction twice in succession. Walks ease into motion and slow before stopping, avoid walking into the user, and stop when an interaction begins.

| Character | Idle reactions mixed with short walks | After a pet |
| --- | --- | --- |
| Pikachu | Curious, Drowsy | Finishes Headpat, then Happy |
| Dog | Play bow, Sniff | Finishes Headpat, then a short Tail wag |
| LeBron | Curious, Shrug, Drowsy | Returns to idle |
| Keanu | Curious, Drowsy | Returns to idle |

| Interaction | Gesture / contact | Reaction |
| --- | --- | --- |
| Wave | Raise a loosely open hand and wave it side to side twice; wrist-led waves count too | LeBron, Keanu, and Pikachu wave back; the dog wags |
| Come over | Extend your index finger or all fingers, then curl them toward yourself; a relaxed starting hand and a small pull toward your body work | Walk plays while the character approaches on the ground, stopping short of you; horizontal and back-facing hands work, and you can beckon immediately after waving |
| Pet | When the character is close, stroke its head with your palm or fingertips, horizontally or vertically; slightly bent fingers are fine | Pikachu/dog receive Headpat; humans lean into Petting. Near-head strokes take priority over greeting/high-five gestures |
| High five | Bring an upright, still open palm beside a human's head, then meet the offered right hand | The human offers High five; actual palm contact changes the action to “High five!” |

Waves and beckoning work from a distance. Petting uses animated head volumes and the palm/finger positions of the visible glove, with a short tolerance for webcam depth uncertainty. Its resting reach is 0.8 units so a character that has come over can be petted without an exact forward push. Distant screen overlap still does not count. Move closer with WASD and push your real hand toward the webcam to reach farther into the scene; reach still calibrates from the first 20 detections. When mouse look is released, the camera gently pitches toward an approaching or strolling character so small animals stay in view. Captured mouse look stays under your control. A held high-five palm does not repeatedly restart the animation. Waves and beckoning have separate cooldowns, and lost or frozen tracking ends touch input. Animal headpats finish before the happy/tail-wag follow-up, then return to idle. Scratching is currently omitted. Walking clips stay in place; only the character's ground-level parent moves. Leaving Lifelike removes the procedural pose and restores manual animation playback and the preview's original placement.

### Fetch

Fetch works in **First person** and **Lifelike** with the dog, Pikachu, Keanu, and LeBron. Press **B** to spawn one ball in your tracked hand (the current holder, a pinching hand, or the right hand is preferred). With no tracked hand, it waits in front of the camera until a hand appears. Pinch, move your hand, and release to throw; a slow release drops it. Either hand can pinch a nearby ball to take it from the floor, the air, or the character. Push toward the webcam to reach farther. Tracking loss never counts as a throw.

The character chases the ball around furniture, picks it up, and brings it back. Keanu and LeBron crouch and grab with their right hand, then extend it for the handoff. The dog and Pikachu bow to pick up and carry the ball in their mouths. Pinch the returned ball to take it and throw again. **B** immediately cancels any chase, pickup, or handoff and recalls the same ball to your hand; **C** removes it and ends fetch. Ball controls also work with the mouse released. Pausing or changing the view, model, or environment clears fetch. While a ball is present, fetch takes priority over greetings, petting, and wandering.

`lib/fetch/controller.ts` owns the interruptible fetch state and shares the room's A* navigation with Lifelike. `hand-ball.ts` uses fresh, camera-relative hand samples for throwing, so mouse look and WASD do not add throw force. `character-pose.ts` adds runtime pickup/carry/offer poses and calibrated hand/mouth sockets to the existing rigs; it restores them before each mixer sample and on cancellation. The GLBs and their embedded clips are unchanged. Other imported models use a basic socket fallback; matching human bone names support hand carrying, but custom rigs need their own anatomical calibration.

`ball-physics.ts` uses gravity, bounce, rolling friction, and sleep with fixed substeps and distance-limited collision steps. The lounge's actual transformed mesh supplies double-sided floor, wall, furniture, and ceiling contacts; a cached spatial index keeps each update local. The collision map supplies a safety floor and outer capture limits for scan holes. Default has a floor and outer bounds, with no ceiling. Balls that settle where the character cannot reach remain available for **B** recall. Run `npm run test:fetch` for physics, gestures, cancellation, navigation, and complete fetch/handoff checks on all four shipped assets. Real throwing sensitivity still needs a webcam-capable browser.

### Environments

The Environment selector is available in every view. Choose **No model** to load either environment independently, then use First person or Lifelike to explore with WASD and mouse look. Environment-only exploration uses a safe player spawn and furniture/floor collision without a character obstacle or webcam request. Orbit views also show the selected lounge.

Use **Environment** in the View settings panel to choose **Default** or **University study lounge**. Default retains the flat floor and grid. The lounge uses `public/university-study-lounge.glb`, which is a textured mesh export of the capture (the file contains triangles, rather than native Gaussian splat data). It loads only when selected and remains cached while inspecting that character. The 8K source texture is reduced to 4K for GPU use. The source GLB remains unchanged.

The lounge is corrected from its upside-down source orientation, leveled to its measured floor, and enlarged **30%** relative to the initial room calibration; user and character sizes stay the same. The user starts in the aisle beside the window-facing study tables, looking outside, with the character 1.65 units ahead. Spawns adjust within that aisle to fit the selected character's footprint. The camera follows local floor height with its eyes 1.6 units above it.

`public/university-study-lounge.collision.json` contains the same room transform, supported floor heights, and a conservative furniture/room-boundary map. The camera and character use swept circle movement, slide along obstacles, and cannot cross tables, chairs, columns, captured-room edges, or each other. The character uses A* paths for approaches and idle walks; unsupported scan holes stay blocked. Ground height covers the whole footprint so paws/feet remain above the captured floor. Furniture is static. Loading failures return to Default with an error; movement is paused until the environment is ready.

`lib/environments/study-lounge.ts` registers the selectable environments and loads/calibrates the lounge. `lib/environments/collision-world.ts` handles movement and navigation. To replace or recalibrate the local capture, run `python3 work/build-lounge-collision.py` with NumPy and Pillow installed, then `npm run test:environments`. The builder fits the actual floor and preserves the original GLB; its diagnostic map is written to `work/lounge/collision-map.png`. Keep the large source GLB in `public/` alongside the tracked collision JSON. Additional captures need their own calibrated collision map and safe spawn before being registered.

`lib/lifelike/hand-gestures.ts` recognizes temporal gestures independently for both hands, processing only new webcam detections. Waves measure total travel between turns rather than movement per frame; curling uses changes in metric landmarks relative to the hand's own starting pose. `lib/lifelike/controller.ts` selects clips, tests animated head/hand contact, turns the character, and moves it during approaches and idle strolls. `lib/lifelike/idle-motion.ts` restores the previous additive pose before each mixer update and applies a fresh idle layer afterward, avoiding accumulated deformation. Each supplied model has an explicit species/facing profile: humans and dog face +X, Pikachu faces +Z. Imported characters can use matching clip names and recognized bone names; static GLBs have no automatic animation library. The lifelike suite covers gestures at 15/30/60/120 fps, wrist waves, relaxed/index-only curls, jitter and dropouts, actual GLB head/crown contact, distant touch rejection, high fives, post-pet reactions, camera following, bounded movement, and procedural motion without foot drift. Physical gesture sensitivity still needs verification with a webcam in Chrome or another camera-capable browser.

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

## Human animation library

`public/lebron.glb` and `public/keanu.glb` are the unrigged source meshes. `npm run animate:humans` builds new 23-joint skeletons and skin weights, then writes separate `public/lebron-animated.glb` and `public/keanu-animated.glb` files. The original geometry, materials, UVs, and textures remain byte-identical. Regeneration always starts from the sources and is deterministic.

Both characters include **Idle, Wave, Walk, Jog, Headpat, Petting, Curious, Nod, High five, Beckon, Celebrate, Shrug, Startled, and Drowsy**. LeBron has a more energetic wave and two-arm celebration; Keanu has a slower wave and a restrained celebration. Headpat and Petting provide the funny affection reactions.

The rig uses separate clavicle, shoulder, elbow, and wrist chains. Surface connectivity separates arms from nearby trousers and coat panels; weights blend through the shoulder attachment while the torso core, head, lower clothing, and legs have no arm influence. Elbows bend about a hinge that follows the upper arm. Wave, High five, Beckon, and Shrug animate only the arms. Leg IK keeps supporting feet planted during walking and crouching. These are body animations; the source meshes have no facial expression controls, and fingers retain their sculpted pose.

The poses are in `work/animate-humans.mjs`, skeleton placement in `work/rig-humans.mjs`, and skinning in `work/human-skinning.mjs`. Clips are sampled at 30 fps, with seamless loops and reactions that start and finish at rest. `work/render-human-animations.py` (NumPy/Pillow) renders all clips, a front/side wave sequence, and arm ownership for visual checks.

For future behavior integration, `lib/character-animation-player.ts` exposes `play(name, fadeSeconds?)`, `update(deltaSeconds)`, `setPlayback(playing, speed)`, `stop()`, and `dispose()`. Clip extras include `loop`, `duration`, `category`, `description`, `in_place`, and `arm_only`. Walk and Jog stay in place; move and turn the character's parent group toward a tracked hand. Gesture detection and behavior selection can be added separately.

Both humans are 1 unit tall, centered vertically at Y=0, and face +X, with anatomical left at -Z. Scale to the desired height and offset by half that height to place the soles on Y=0. Bone names include `Root`, `Hip`, `Waist`, `Spine`, `Chest`, `Neck`, `Head`, and `L_`/`R_` prefixed `Clavicle`, `Upperarm`, `Forearm`, `Hand`, `Thigh`, `Calf`, `Foot`, and `ToeBase`.

The input image, all output files returned by both providers, and JSON reports are listed with download buttons. Files are downloaded into browser memory immediately because provider URLs can expire. Keep the tab open and download your results before refreshing or closing it. There is no persistent storage or job recovery.

## Check

```sh
npm run test:animations
npm run test:lifelike
npm run test:environments
npm run test:fetch
npm run typecheck
npm run build
```

Animation tests require Node.js 22.18 or newer. Both the creature and human suites run together: they check playback/replay and interrupted fades, embedded tracks and loop seams, source preservation, skin normalization and bind pose, reaction endpoints, body vertex isolation during arm gestures, stretched triangle edges, and planted support feet.

## API references

- [fal Trellis](https://fal.ai/models/fal-ai/trellis/api)
- [Tripo rig check](https://developers.tripo3d.ai/en/docs/animations-rig-check)
- [Tripo auto rig](https://developers.tripo3d.ai/en/docs/animations-rig)
- [Tripo task query](https://developers.tripo3d.ai/en/docs/task-query)

Rig types: biped, quadruped, hexapod, octopod, avian, serpentine, and aquatic. Quadruped is selected by default. Uses Tripo's v3 API, `v1.0-20240301` for bipeds, and `v2.5-20260210` for the other types. The local asset proxy accepts fal/Tripo storage domains only.
