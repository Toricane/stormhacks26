# stormhacks26

Our StormHacks 2026 entry for **"Fetching Reality: Bring a Static Dog Photo to Life in Real-Time"** ([CHALLENGE_2.md](CHALLENGE_2.md)).

The idea: turn a single dog photo into a 3D, rigged, animated dog, and let you interact with it using your real hands through a webcam — reach in to pet it, throw a ball for it to fetch.

## Repository layout

| Folder | What | Port | Docs |
| --- | --- | --- | --- |
| [`frontend/`](frontend/) | Interactive app: webcam hand tracking, virtual hands, 3D world, ball physics, petting | 5173 | [frontend/README.md](frontend/README.md) |
| [`next/`](next/) | Model pipeline + viewer: dog image → 3D model → quadruped auto-rig, plus a GLB inspector with animation playback | 3000 | [next/README.md](next/README.md) |

The rigged, animated dog produced by `next/` is [`next/public/dog-animated.glb`](next/public/dog-animated.glb). The frontend will load it in place of its placeholder dog.

## Quick start

Both apps need Node.js 20+ (`next/` needs 20.9+).

**Frontend** (needs a webcam):

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and allow camera access.

**Model pipeline / viewer** (generation needs [fal](https://fal.ai) and [Tripo](https://www.tripo3d.ai) API keys):

```bash
cd next
cp .env.example .env   # fill in FAL_KEY and TRIPO_API_KEY
pnpm install           # the repo ships a pnpm lockfile; npm install also works
pnpm dev
```

Open http://localhost:3000. The bundled animated dog can be viewed without API keys.

## Docs

- [IMPLEMENTATION.md](IMPLEMENTATION.md): overall system design, how the two apps connect, and the project roadmap.
- [AGENTS.md](AGENTS.md): guidance for AI coding agents working in this repo.
- [frontend/IMPLEMENTATION.md](frontend/IMPLEMENTATION.md): detailed design of the interactive frontend.
- [next/README.md](next/README.md): how the model pipeline and viewer work.
- [CHALLENGE_2.md](CHALLENGE_2.md): the challenge brief we're building for ([CHALLENGE_1.md](CHALLENGE_1.md) is the alternative we didn't pick).
