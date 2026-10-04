# AGENTS.md

Monorepo for a StormHacks entry: bring a static dog photo to life as an interactive real-time pet ([CHALLENGE_2.md](CHALLENGE_2.md)). It's judged on **framerate/efficiency, interactivity, aesthetics**.

## Layout

- `frontend/`: Vite + TypeScript interactive app (MediaPipe hand tracking, Three.js world). **Read [frontend/AGENTS.md](frontend/AGENTS.md) before working there.**
- `next/`: the teammate's Next.js 16 / React 19 app. It runs image → 3D (fal) → Tripo rig check → Tripo quadruped auto-rig, and has a GLB viewer (orbit, skeleton, joint posing, clip playback, first-person walk). Docs: [next/README.md](next/README.md).
  - `app/api/pipeline/route.ts`: server routes calling fal and Tripo (keys from `next/.env`, which is gitignored).
  - `app/api/asset/route.ts`: proxy for provider-hosted model files (fal/Tripo domains only).
  - `components/viewer.tsx`: the Three.js viewer.
  - `public/dog-animated.glb`: the current rigged dog with clips. **This is the asset the frontend should use.**
  - `work/`: one-off scripts that baked the procedural clips (`animate-dog.mjs`) and rendered previews (`render-dog.py`).
- **Do not rename `next/`.** Don't modify it from frontend tasks unless asked.
- Root `*.md`: overview docs. Keep them short and link into the folder docs; folder-specific detail belongs in that folder.

## Working rules

- Run commands from the relevant folder (`cd frontend` / `cd next`). There's no root `package.json`.
- Verify: `frontend/` with `npm run build`; `next/` with `npm run typecheck` then `npm run build`.
- `next/` has a `pnpm-lock.yaml` (no npm lockfile); its README says `npm install`. Prefer `pnpm install` to respect the lockfile.
- `next/work/*` scripts contain hard-coded absolute paths from the teammate's Mac; update them before re-running.
- Windows + PowerShell: chain with `;`, not `&&`.
- The root `.gitignore` uses unanchored patterns (`node_modules`, `dist`, …) that apply to every folder; `next/.gitignore` adds `.next/` and `.env*`.
- When a change affects how the apps connect (model file, scale/axes, bone names, clip names, events), update [IMPLEMENTATION.md](IMPLEMENTATION.md) as well as the folder docs.
