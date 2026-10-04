# Backyard world and app integration runbook

Research date: October 4, 2026. Target: before noon today; confirm your actual local deadline when executing. This is a plan, not a record of completed integration.

**Initial scope: inspect, research, and write this file only.** Subsequently you supplied `backyard.jpg` and authorized its World Labs upload, generation, export and download. App integration remains a later phase. Your preference is to use curl directly, without building a generation pipeline or UI.

### Execution status

- Input: root `backyard.jpg`, 4000 × 3000, 5,787,759 bytes. Suitable sharp daylight reference with open foreground lawn; dense foliage/trellises may reconstruct imperfectly.
- API balance before generation: verified 7,000 credits.
- Photo upload: successful. Live response uses `media_asset.media_asset_id`; commands below now handle that field and the documented `id` variant.
- Standard `marble-1.1` generation submitted once.
- World ID: `eb220842-ed96-4a86-91d3-d73f9c8caa89`.
- Generation operation: `d7dc9715-7072-447d-ae39-756ce9d96cfc`.
- Raw requests, responses and eventual original assets: `next/work/backyard.local/` (gitignored).
- Generation completed successfully; actual settled cost 1,580 credits, balance afterward 5,420.
- Generated thumbnail and panorama inspected: usable open lawn with recognizable trellises, trees and shed; foliage is softened and unseen surroundings are inferred.
- Textured GLB export submitted once; operation `8a256a7d-5945-46cf-843d-eb7c30116f7a`, currently running.
- Backups downloaded: `backyard-collider.glb`, `backyard-100k.spz`, `backyard-500k.spz`, `thumbnail.jpg`, `panorama.jpg`.

## 1. Recommended order

1. You take the backyard photo and save it locally.
2. Run the curl workflow below: check API credits, upload, generate one standard world, inspect it, export one textured GLB, download.
3. While the export runs, integrate the existing animated dog into `frontend/` and prepare its environment loader.
4. Load and calibrate the downloaded backyard in `frontend/`; align dog, ball, floor, and collision.
5. Verify the complete demo in a webcam-capable browser and measure performance. Keep a fallback environment available.

The minimum required outcome is **the real animated dog and generated backyard together inside `frontend/`, with its existing hand interactions working**. A backyard displayed only in the Next viewer does not finish that task.

For this deadline, retain Vite as the interactive demo and Next as the generation/inspection studio. Integrate through local assets and selected reusable Three.js modules. Combining React, routing, dev servers, or build systems is unnecessary for this outcome. If you later want one public-facing app, do that after the demo works.

## 2. What the code actually contains

### `frontend/` — screenshot 1, port 5173

- Vite/TypeScript with Three.js `0.186.1` and MediaPipe hands.
- `src/main.ts`: webcam lifecycle, frame loop, tracking HUD, gameplay events, overlays and hearts. Tracking processes new video frames; the render loop starts before webcam permission succeeds.
- `src/world/world.ts`: procedural grass/grid, sky, stand, ball, capsule/sphere dog placeholder. Camera eye height is 1.4; it has a fixed position and a slight downward look. The docs describe a generally −Z-facing world.
- `src/world/interactions.ts`: grab/drop/throw and pet detection. Ball collision assumes a flat Y=0 floor, and its current “returned” event means automatic ball redocking, not a dog fetching it.
- There is no model loader or backyard loader yet. `public/` currently has only SVG assets.
- `dogBounds` and its projected rectangle currently describe a static placeholder. Replacing the mesh alone will leave touch detection wrong unless these are updated.
- Preserve the existing depth calibration, white gloves, dark sleeves, mirrored hand coordinates, and playing hidden video.

Read [frontend/AGENTS.md](frontend/AGENTS.md) and [frontend/IMPLEMENTATION.md](frontend/IMPLEMENTATION.md) before implementation.

### `next/` — screenshot 2, port 3000

The current code is substantially more developed than the screenshot suggests:

- `app/page.tsx`: View/Generate UI, model selection, optional environment, browser-memory artifacts.
- `components/viewer.tsx`: GLB inspection and playback, first-person camera, Lifelike mode, hand input, fetch and environment integration.
- `components/first-person-hands.tsx` and `lib/hands/`: a copy of frontend tracking/drawing plus React lifecycle management.
- `lib/character-animation-player.ts`: existing animation playback/crossfades.
- `lib/lifelike/`: waves, beckoning, petting and idle movement.
- `lib/fetch/`: actual retrieval state machine, hand throws, mesh ball collision, mouth sockets and pickup/carry poses.
- `lib/environments/collision-world.ts`: walkability/floor grid, swept movement and navigation.
- `lib/environments/study-lounge.ts`: a **specific lounge** loader with calibrated transform and spawns. Its constants and collision map are not suitable for the backyard.
- The README refers to `public/university-study-lounge.glb`, but that file is **absent in this checkout**. Its collision JSON is present. Do not treat lounge loading as a working local fallback without restoring the source asset.

Do not rename `next/`. This task explicitly includes integration, but avoid unrelated changes there. Read [next/README.md](next/README.md).

### Existing dog generation pattern

`next/app/api/pipeline/route.ts` does short server-side submit/poll requests:

1. Validate an uploaded image (PNG/JPEG/WebP, up to 10 MB).
2. Upload through fal storage and queue **`tripo3d/h3.1/image-to-3d`**. The local variable/UI still says Trellis, and some docs link the older Trellis endpoint; trust the actual route for the current provider model.
3. Poll fal; pass the generated URL to Tripo v3 rig check.
4. Submit quadruped auto-rig with `v2.5-20260210`; poll its task.
5. Download outputs into browser memory through `/api/asset`, then save manually.

Provider keys stay server-side. The asset proxy allows only fal/Tripo storage and validates redirects; it currently rejects World Labs assets. A local curl download avoids changing that proxy. Do not loosen it to accept arbitrary hosts.

World Labs needs its own upload/generate/export calls; reuse the **asynchronous submit → save ID → poll → save assets** approach, not the dog API payload or rigging steps. No new backend route is needed for a one-off backyard.

### Animated dog asset, verified by reading its GLB header

- Source of truth: `next/public/dog-animated.glb`.
- File size: 59,885,844 bytes (about 57.1 MiB).
- Triangle count: **1,474,008**, summed over triangle primitives. This is far above the aspirational ~50k budget in `IMPLEMENTATION.md`; acceptable frame rate must be measured, not assumed.
- One 21-joint skin.
- Clips: `Idle`, `Tail wag`, `Walk`, `Trot`, `Headpat`, `Scratch`, `Happy`, `Curious`, `Play bow`, `Sniff`, `Shake`, `Offer paw`.
- Current Next profile treats the dog as facing +X. Next first-person mode grounds the model and scales its largest dimension to 1.2 units; frontend docs propose a smaller ~0.9–1.0 m dog. Pick one size deliberately and record it.
- Walking clips are in place. Move a parent group for locomotion.
- Do not regenerate or rerig the dog for this task. `work/animate-dog.mjs` still contains a Mac-specific source path. Other newer scripts use relative roots; inspect each script before running it.

## 3. World Labs facts that affect the plan

### Cost and credit budget

API credits and Marble website credits are separate. Your stated 7,000 has **not** been verified against the API account. Standard `marble-1.1` generation from an ordinary photo costs 1,580 credits (80 for panorama generation + 1,500 for world generation); HQ mesh export costs 3,500. One photo world + one HQ export totals **5,080**, leaving **1,920** from a 7,000 balance. A second standard generation would leave 340; there would not be enough for a second HQ export. Plus can incur additional variable generation costs. Uploads and operation polling do not consume credits. Budget against documented cost yourself: low-balance admission and auto-refill settings do not guarantee a hard spending cap. [Official pricing](https://docs.worldlabs.ai/api/pricing).

Recommendation: one `marble-1.1` generation, inspect before export, then one HQ export. Do not use Plus automatically, generate multiple alternatives, or export a rejected world. Recheck balance before each paid submission.

### Formats and timing

Generation returns SPZ splat variants, a collider GLB and a panorama. The collider is a physics asset; it is not the textured visual environment. HQ textured GLB export is a separate asynchronous operation. The quickstart estimates generation at about five minutes, but that is not a deadline guarantee. [Quickstart](https://docs.worldlabs.ai/api).

I have not established a guaranteed API mesh export completion time. Treat your “up to an hour” estimate as a scheduling allowance, not an SLA. Start as soon as the photo and execution authorization are available. Do not postpone integration until the export finishes.

Both apps already load ordinary GLBs, so textured GLB is the simplest integration choice. SPZ requires a dedicated renderer; a Gaussian PLY is also splat data, not an ordinary polygon mesh. Keep SPZ as an optional alternate path if the export is late. [Spark loading formats](https://sparkjs.dev/docs/loading-splats/).

## 4. Instructions for you: prepare the photo

1. Take a sharp, level photo from a useful standing position facing the play area, with visible ground and enough space to place the dog and throw a ball.
2. Prefer daylight, clear boundaries and a relatively open lawn. Avoid a foreground object covering most of the ground. This is practical capture advice, not a guarantee of reconstruction accuracy.
3. Save as JPEG, PNG or WebP, e.g. `C:\Users\prajw\Pictures\backyard.jpg`. Convert HEIC first if necessary.
4. Note one approximate real distance, such as fence width or patio depth, to help verify scale.
5. A single photo does not observe the entire yard. Inspect generated unseen areas before allowing navigation there.
6. Keep the API key in `next/.env`. Its current variable name is **`WORLD_LABS`**, not `WLT_API_KEY`; the commands below read it without printing it. No need to rename it.

## 5. Curl workflow for Windows PowerShell

**Execution is underway; see status above. Do not rerun paid submission blocks for an existing job.** All HTTP calls use `curl.exe` (avoids the Windows PowerShell `curl` alias). JSON is written to UTF-8 files to avoid shell-quoting problems. Powershell glue only parses responses and retains IDs; there is no app pipeline to build.

### A. Setup and check credits — read-only API request

```powershell
Set-Location 'C:\Users\prajw\Desktop\Coding\stormhacks26\next'
$wlBase = 'https://api.worldlabs.ai/marble/v1'
$wlKeyLine = Get-Content -LiteralPath '.env' | Where-Object { $_ -match '^\s*WORLD_LABS\s*=' } | Select-Object -First 1
if (!$wlKeyLine) { throw 'WORLD_LABS is missing from next/.env' }
$wlKey = (($wlKeyLine -split '=', 2)[1]).Trim().Trim('"').Trim("'")
if (!$wlKey) { throw 'WORLD_LABS is empty' }
$wlPhoto = 'C:\Users\prajw\Pictures\backyard.jpg' # Change this
if (!(Test-Path -LiteralPath $wlPhoto -PathType Leaf)) { throw 'Photo not found' }
$wlWork = Join-Path (Get-Location) 'work\backyard.local'
New-Item -ItemType Directory -Force -Path $wlWork | Out-Null
$wlUtf8 = New-Object System.Text.UTF8Encoding($false)

curl.exe --fail-with-body --silent --show-error --header "WLT-Api-Key: $wlKey" --output "$wlWork\credits-before.json" "$wlBase/credits"
if ($LASTEXITCODE -ne 0) { throw 'Credit check failed; inspect credits-before.json' }
Get-Content -LiteralPath "$wlWork\credits-before.json"
```

Read `remaining_credits`. Proceed with the full plan only if the balance covers at least 5,080 credits at current pricing. Keep the `.env` assignment on its own line; this parser assumes a simple key value without an inline comment. The `.local` work directory is ignored by the root gitignore. Do not print `$wlKey`, commit response URLs, or add a browser-exposed key. [Credits endpoint](https://docs.worldlabs.ai/api/reference/credits/get).

### B. Prepare and upload the local photo

```powershell
$wlExtension = [IO.Path]::GetExtension($wlPhoto).TrimStart('.').ToLowerInvariant()
if ($wlExtension -notin @('jpg','jpeg','png','webp')) { throw 'Use JPG, PNG or WebP' }
$wlPrepareBody = @{ file_name = [IO.Path]::GetFileName($wlPhoto); kind = 'image'; extension = $wlExtension } | ConvertTo-Json
[IO.File]::WriteAllText("$wlWork\prepare-request.json", $wlPrepareBody, $wlUtf8)
curl.exe --fail-with-body --silent --show-error --request POST --header "WLT-Api-Key: $wlKey" --header 'Content-Type: application/json' --data-binary "@$wlWork\prepare-request.json" --output "$wlWork\prepare-response.json" "$wlBase/media-assets:prepare_upload"
if ($LASTEXITCODE -ne 0) { throw 'Prepare upload failed' }
$wlPrepared = Get-Content -Raw -LiteralPath "$wlWork\prepare-response.json" | ConvertFrom-Json
$wlUploadArgs = @('--fail-with-body','--silent','--show-error','--request',$wlPrepared.upload_info.upload_method)
foreach ($wlHeader in $wlPrepared.upload_info.required_headers.PSObject.Properties) {
    $wlUploadArgs += @('--header', ('{0}: {1}' -f $wlHeader.Name, $wlHeader.Value))
}
$wlUploadArgs += @('--data-binary', "@$wlPhoto", '--output', "$wlWork\upload-response.txt", $wlPrepared.upload_info.upload_url)
& curl.exe @wlUploadArgs
if ($LASTEXITCODE -ne 0) { throw 'Photo upload failed; do not generate yet' }
$wlMediaId = $wlPrepared.media_asset.media_asset_id
if (!$wlMediaId) { $wlMediaId = $wlPrepared.media_asset.id }
if (!$wlMediaId) { throw 'No media asset ID returned' }
```

The upload request uses the returned method and required headers. **Do not send the API key to the signed storage URL.** Save `prepare-response.json` because it contains the media ID. [Prepare-upload API](https://docs.worldlabs.ai/api/reference/media-assets/prepare-upload).

### C. Start exactly one standard generation — paid

```powershell
$wlGenerateBody = @{
    display_name = 'StormHacks backyard'
    model = 'marble-1.1'
    permission = @{ public = $false }
    world_prompt = @{
        type = 'image'
        image_prompt = @{ source = 'media_asset'; media_asset_id = $wlMediaId }
    }
} | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText("$wlWork\generate-request.json", $wlGenerateBody, $wlUtf8)
curl.exe --fail-with-body --silent --show-error --request POST --header "WLT-Api-Key: $wlKey" --header 'Content-Type: application/json' --data-binary "@$wlWork\generate-request.json" --output "$wlWork\generate-response.json" "$wlBase/worlds:generate"
if ($LASTEXITCODE -ne 0) { throw 'Generation submission failed; inspect response before retrying' }
$wlGeneration = Get-Content -Raw -LiteralPath "$wlWork\generate-response.json" | ConvertFrom-Json
$wlGenerateId = $wlGeneration.operation_id
if (!$wlGenerateId) { throw 'No generation operation ID returned' }
Write-Output "Generation operation: $wlGenerateId"
```

This explicitly selects the current standard model and a private world. The image is enough; an optional description can be added later if needed. Do not blindly use deprecated `Marble 0.1-*` names from older examples. [Generation API](https://docs.worldlabs.ai/api/reference/worlds/generate).

### D. Check generation status; repeat only the GET

```powershell
curl.exe --fail-with-body --silent --show-error --header "WLT-Api-Key: $wlKey" --output "$wlWork\generation-status.json" "$wlBase/operations/$wlGenerateId"
if ($LASTEXITCODE -ne 0) { throw 'Status check failed; retain the operation ID' }
$wlStatus = Get-Content -Raw -LiteralPath "$wlWork\generation-status.json" | ConvertFrom-Json
$wlStatus | Select-Object done,error,metadata,cost | Format-List
```

If `done` is false, repeat this block in 10–20 seconds while doing other work. If `done` is true and `error` is non-null, stop and investigate. HTTP 200 alone does not mean job success. Persist the returned cost and IDs. [Operation API](https://docs.worldlabs.ai/api/reference/operations/get).

After success:

```powershell
if (!$wlStatus.done -or $wlStatus.error) { throw 'Generation has not completed successfully' }
$wlWorldId = $wlStatus.response.id
if (!$wlWorldId) { $wlWorldId = $wlStatus.response.world_id }
if (!$wlWorldId) { $wlWorldId = $wlStatus.metadata.world_id }
if (!$wlWorldId) { throw 'No world ID found; inspect generation-status.json' }
[IO.File]::WriteAllText("$wlWork\world-id.txt", $wlWorldId, $wlUtf8)
curl.exe --fail-with-body --silent --show-error --header "WLT-Api-Key: $wlKey" --output "$wlWork\world.json" "$wlBase/worlds/$wlWorldId"
if ($LASTEXITCODE -ne 0) { throw 'World retrieval failed' }
$wlWorldResponse = Get-Content -Raw -LiteralPath "$wlWork\world.json" | ConvertFrom-Json
$wlWorld = $wlWorldResponse.world
if (!$wlWorld) { $wlWorld = $wlWorldResponse }
Write-Output $wlWorld.world_marble_url
```

Use the returned Marble link to inspect the generated yard before spending on export. Fetching the complete world is preferable to relying on the completion snapshot. [Get-world API](https://docs.worldlabs.ai/api/reference/worlds/get).

### E. Start one textured GLB export — paid

Recheck credits using step A's GET, with another output filename. Reserve 3,500 for export. Then:

```powershell
$wlExportBody = @{ asset_type = 'mesh'; format = 'glb'; mesh_variant = 'textured' } | ConvertTo-Json
[IO.File]::WriteAllText("$wlWork\export-request.json", $wlExportBody, $wlUtf8)
curl.exe --fail-with-body --silent --show-error --request POST --header "WLT-Api-Key: $wlKey" --header 'Content-Type: application/json' --data-binary "@$wlWork\export-request.json" --output "$wlWork\export-response.json" "$wlBase/worlds/${wlWorldId}:export"
if ($LASTEXITCODE -ne 0) { throw 'Export submission failed; inspect response before retrying' }
$wlExport = Get-Content -Raw -LiteralPath "$wlWork\export-response.json" | ConvertFrom-Json
$wlExportId = $wlExport.operation_id
if (!$wlExportId) { throw 'No export operation ID returned' }
Write-Output "Export operation: $wlExportId"
```

Poll the **export** ID, not the generation ID, every 20–30 seconds using step D's GET and `export-status.json`. Save its completion response. Do not submit another export because the first is slow. If the submit response is already done, it may be used directly after checking `error`. The export result can provide `response.url`; the latest world also exposes `assets.mesh.hq_mesh_url`. [Export API](https://docs.worldlabs.ai/api/reference/worlds/export).

### F. Download the finished backyard

```powershell
curl.exe --fail-with-body --silent --show-error --header "WLT-Api-Key: $wlKey" --output "$wlWork\export-status.json" "$wlBase/operations/$wlExportId"
if ($LASTEXITCODE -ne 0) { throw 'Export status check failed' }
$wlExportStatus = Get-Content -Raw -LiteralPath "$wlWork\export-status.json" | ConvertFrom-Json
if (!$wlExportStatus.done -or $wlExportStatus.error) { throw 'Export is still running or failed; inspect export-status.json' }
$wlGlbUrl = $wlExportStatus.response.url
if (!$wlGlbUrl) {
    curl.exe --fail-with-body --silent --show-error --header "WLT-Api-Key: $wlKey" --output "$wlWork\world.json" "$wlBase/worlds/$wlWorldId"
    if ($LASTEXITCODE -ne 0) { throw 'World refresh failed' }
    $wlWorldResponse = Get-Content -Raw -LiteralPath "$wlWork\world.json" | ConvertFrom-Json
    $wlWorld = $wlWorldResponse.world
    if (!$wlWorld) { $wlWorld = $wlWorldResponse }
    $wlGlbUrl = $wlWorld.assets.mesh.hq_mesh_url
}
if (!$wlGlbUrl) { throw 'No textured mesh URL; inspect the saved results' }
curl.exe --fail-with-body --location --output "$wlWork\backyard-source.glb" "$wlGlbUrl"
if ($LASTEXITCODE -ne 0) { throw 'Download failed; refresh the world to recover its URL' }
Get-Item -LiteralPath "$wlWork\backyard-source.glb" | Select-Object Name,Length
```

Download signed assets without the API key. Retain the original GLB, collider, panorama, thumbnail, raw world JSON and actual settled cost if available. Local backups remove dependence on provider URL lifetime. Before putting the file in `public/`, verify it parses as GLB and isn't an error document.

### Recovery and common failures

- New terminal: repeat only setup, recover the generation/export IDs from their saved response files and world ID from `world-id.txt`. Resume GET polling; do not regenerate.
- Ambiguous POST timeout: recover the operation/world through saved IDs or the platform before retrying; a timeout can happen after a job was accepted.
- `401`: key/header problem. Header is `WLT-Api-Key`, not Bearer authorization.
- `402`: insufficient API credits. Check that the 7,000 belongs to the API platform.
- `422`: inspect validation details; ensure required export fields and valid model are present.
- `429` or transient GET failure: back off and retry GET. Do not turn this into duplicate paid POST requests.
- Upload expiry: prepare a fresh upload if necessary; don't generate against an unsuccessful upload.
- Keep response bodies and request IDs for diagnosis; redact signed URLs before sharing publicly. [Official troubleshooting](https://docs.worldlabs.ai/api/faq).

## 6. Instructions for Codex: implementation after authorization

### Stage 1 — animated dog in the existing frontend

1. Re-read working-tree status and applicable instructions. At research time `next/next-env.d.ts` already had a local modification; preserve it.
2. Copy the source dog to `frontend/public/models/dog.glb`. Keep the Next source unchanged. Document asset size and copy/update procedure.
3. Add a small dog asset/animation module using `GLTFLoader` and the existing Three.js version. Load asynchronously; preserve scene/HUD rendering during loading and display an actionable load error.
4. Put the glTF under an actor parent and a separate normalization child. Normalize bounds once, choose a dog size, center X/Z and put the lowest feet on the intended floor. Account for +X facing. Avoid making animation-root transforms fight gameplay-root movement.
5. Use or adapt the existing animation player, including loop metadata, one-shot completion and interruption-safe fades. Reuse code through explicit local modules; don't directly import a Next React component into Vite.
6. Play Idle by default. Bind existing `pet` events to Headpat followed by a short Tail wag/Happy response, with a cooldown so 150 ms pet events do not continually restart the reaction.
7. Update interaction bounds and depth against the real dog. For an initially stationary dog, a conservative transformed rest bound is enough; use animated head/paw sockets if porting the Next contact behavior. Avoid full dense-mesh bounds traversal each frame.
8. Run `npm run build` from `frontend/`, then verify dog orientation, feet, gestures and reactions in Chrome/Edge with the webcam.

### Stage 2 — backyard as the actual frontend environment

1. Copy a verified export to `frontend/public/environments/backyard.glb`; retain `backyard-source.glb` as the untouched original outside public.
2. Add a dedicated environment module and manifest with asset URL, transform, supported floor, camera/dog/ball spawns and play bounds. Include provenance/world ID without API credentials or signed URLs.
3. Inspect GLB nodes, dimensions, materials, textures and triangle counts before choosing scale. Do not normalize the entire yard to dog size or fit the camera to the sky/scan outliers.
4. Calibrate Y-up, level ground, scale and origin. Check a known backyard distance and the dog/camera proportions. Record one authoritative transform used by both visuals and collision. Inspect meshes separately: don't assume splat metadata/axis conversion applies unchanged to an exported GLB.
5. Replace the visible procedural grass/grid with the generated yard. Keep procedural fallback reachable if loading fails. Adjust fog, sky, near/far planes and lighting to the export; avoid obscuring it with the old sky dome or overlighting already baked materials.
6. Place camera in a clear area, with the dog close enough and visible for hands. Keep the fixed-camera frontend convention initially; rotate/translate the environment around the existing camera when practical. Adding WASD changes throw and hand assumptions and expands scope.
7. Ground the stand and ball, and update ball physics. Current `p.y < BALL_RADIUS` only works at Y=0. A chosen flat lawn patch can provide an initial calibrated safety floor, but it doesn't prevent the ball crossing fences or furniture. Use collider contacts or bounded play space appropriate to the actual yard.
8. Keep only supported ground walkable; block holes and outside capture boundaries. If adding fetch, use a safe floor grid and collision geometry rather than treating visual splats as physical surfaces.
9. Preserve hand overlay ordering and document its limitation: current hands are 2D and won't correctly disappear behind every 3D object. Moving them into 3D is a separate polish task.

### Stage 3 — reuse the Next interaction work where needed

The Next app already solves much of real dog fetch. Port that code deliberately if fetch is in the noon scope:

- `lib/fetch/controller.ts`, `hand-ball.ts`, `ball-physics.ts`, `character-pose.ts`.
- Their dependencies on `CollisionWorld`, animation player, character profile, hand frame and viewport types.
- Relevant pieces of `lib/lifelike/controller.ts` only if beckoning/idle walking is required.

Adapt interfaces once at the frontend boundary. Avoid two controllers simultaneously owning the same ball or dog transform. Either preserve current frontend ball interactions and add basic clip reactions for the first checkpoint, or replace the ball controller with the Next fetch system for full retrieval.

For mesh contacts, inspect `FetchController.setWorld(...)` and the physics spatial index; pass transformed collider meshes. A new yard needs its own navigation map. `work/build-lounge-collision.py` assumes the lounge's geometry, accessor layout, measured floor, crop, yaw and scale; changing its input filename alone will not make it a backyard builder.

Differences to reconcile explicitly:

- Camera eye height: frontend 1.4 versus Next 1.6.
- Frontend fixed camera versus Next movable camera; throw vectors must use camera basis if navigation is introduced.
- Depth reach: frontend placed-hand mapping versus Next Lifelike/fetch hand samples. Do not mix tolerances with differently scaled coordinates.
- Keys: frontend C recalibrates, R redocks, D debugs; Next B recalls and C clears. Keep or document one coherent set; don't silently overwrite recalibration.
- Hands are already duplicated between folders. Avoid unrelated tracking changes during the port; document which source is authoritative.
- Restore procedural bone offsets before mixer update, sample animation, update world matrices, then apply fresh interaction poses and sockets. Follow the existing controller ordering to avoid pose accumulation.

### Optional SPZ route if textured export is late

Use `assets.splats.spz_urls` from `world.json` to download the 100k/500k variants and `assets.mesh.collider_mesh_url` for physics. Start with the lower resolution and measure with webcam tracking enabled. Spark can render SPZ alongside Three.js meshes, but requires an additional renderer integration and compatibility check; it is not already installed. [Spark documentation](https://sparkjs.dev/docs/).

For SPZ, use the returned metric scale and ground offset, then apply the renderer axis conversion. World Labs specifies its raw OpenCV frame and a 180° X conversion for its Three.js-style viewer. Apply scaling/ground alignment in the documented order; do not use sample constants or negate an offset blindly. Keep collision alignment verified separately. [World Labs SPZ transforms](https://docs.worldlabs.ai/api/rendering-spz).

Prefer the GLB route for minimum implementation work. A panorama background can be an emergency aesthetic fallback, but does not satisfy a navigable 3D backyard requirement; disclose that tradeoff if used.

## 7. Performance, verification and delivery

### Performance checkpoint

- Establish a baseline on the actual demo machine: current frontend, dog added, then dog + backyard + webcam. Track render FPS, hand detection rate and detection time separately.
- The screenshot's ~58 FPS is a baseline for the procedural scene, not a promise for the 1.47M-triangle dog plus yard.
- Measure dog draw calls, triangle load, textures and GPU memory. If too slow, produce a separate optimized runtime dog while preserving skin, clips, UVs and the original. Don't remove its skeleton or rerig it for optimization.
- Limit device pixel ratio if needed. Avoid scanning large geometry or rebuilding collision/nav structures per frame. Cache collision data and reuse vectors.
- Do not enable shadow casting on all environment triangles. Baked environment lighting plus simple contact shadows may be a better deadline tradeoff.
- SPZ fallback adds sort/render cost; compare 100k and 500k before attempting full resolution.

### Required checks after actual changes

From `frontend/`:

```powershell
npm run build
```

If Next is modified, from `next/` run applicable existing suites plus:

```powershell
npm run typecheck
npm run build
```

Relevant existing suites are `test:animations`, `test:lifelike`, `test:environments`, and `test:fetch`. Current Node is **v22.13.0**, while README says animation tests require **22.18+**. Resolve that requirement before claiming those tests pass; do not reinstall/update anything merely for this research phase.

Manual acceptance checklist:

- Backyard renders in `frontend/`, with clear ground and useful camera framing.
- Animated dog is grounded, faces correctly and idles; petting visibly reacts.
- Visible hand reach agrees with gameplay touch; two-hand tracking still works.
- Ball grab, drop and throw work with the chosen terrain; no accidental throw from tracking loss if the Next throw logic is adopted.
- If full fetch is added: chase, mouth pickup, return, pinch handoff and recall cancellation all work inside supported yard bounds.
- Refresh loads local assets without making paid API calls; errors produce a usable fallback.
- App switching/disposal does not leave duplicate trackers, mixers or camera tracks alive.
- Sustained FPS and tracking rate are acceptable on the demo machine, with evidence recorded.

Use an ordinary webcam-capable browser. The in-app preview cannot verify real camera input. Don't claim runtime acceptance based solely on a TypeScript build.

### Handoff and documentation

- Update [IMPLEMENTATION.md](IMPLEMENTATION.md) with model path, normalization/facing, environment transform, event/control changes and integration status.
- Update frontend folder docs with loader, environment setup, asset refresh instructions and verified demo controls.
- If shared Next contracts change, update its README too. Root overview should link to the folder details rather than duplicating this full runbook.
- `next/.gitignore` ignores most `public/*`; a new Next backyard asset will need an explicit decision about tracking/distribution. Frontend large files also need a distribution plan. Local untracked assets are fine for the immediate demo but must be copied/backed up for another machine.
- Before delivery, record actual costs, world/export IDs privately, final local asset paths, calibration, checks run, performance and remaining limitations.

## 8. Deadline gates

1. **As soon as ready:** photo, verified API balance, one generation submission. Retain every job ID.
2. **After generation:** inspect the yard; submit HQ export promptly if usable. Work on dog integration while waiting.
3. **At least 60 minutes before noon:** assess whether export and calibration are progressing. This is a planning buffer, not a provider timing guarantee.
4. **At least 30 minutes before noon:** stop adding behaviors; choose GLB or an explicitly acknowledged fallback, verify hands and interactions, and fix blocking issues.
5. **Final 15 minutes:** stable demo URL, local assets backed up, tested launch commands, no new generation/export requests.

Photo, API balance and generation/export/download authorization are now provided. App integration has not started under this follow-up request. The first implementation checkpoint should be the real dog in `frontend/`; the final checkpoint must include the backyard there too.
