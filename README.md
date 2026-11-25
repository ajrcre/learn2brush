# Learn2Brush

A 3D tooth-brushing game for children aged 3–6: pick a brush and toothpaste, squeeze a pea-size amount, then brush every tooth on the **outside, inside and chewing side** until it sparkles. Stars earned unlock new brushes, toothpaste and animal teeth. English and Hebrew (RTL, Nikud), installable as a PWA.

## Run
```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build (dist/)
```
Dev URL flags: `?unlockall` (review mode, everything unlocked), `?q=high|medium|low` (force render quality).

## Stack
Vite + TypeScript + React (UI only) + plain Three.js (scene) with `postprocessing` + N8AO, zustand, idb-keyval, vite-plugin-pwa.

## Code map
- `src/game/jaws/` – code-built teeth and gums; per-vertex plaque, side classification (outer/inner/chewing), cleaning.
  `species.ts` describes each set of jaws (kid baby teeth, goat, lion, alligator, shark): tooth shapes per half arch, arch outline, gum/enamel colours, camera framing. `Jaws.ts` builds any of them; `toothGeometry.ts` has the tooth shapes (incisor, canine, molar, fang, cone, blade, carnassial, grinder).
- `src/game/materials.ts` – enamel and gum shaders (wet clearcoat, fake translucency, plaque blend).
- `src/game/Brush.ts`, `Paste.ts`, `Effects.ts` (foam, bubbles, sparkles), `Food.ts` (leftovers).
- `src/game/Game.ts` – phases, camera, input, brushing logic, progress events.
- `src/App.tsx` – screens, voice hints, rewards flow. `src/config/economy.ts` – star rewards and prize prices.
- `src/i18n/voice.json` – all spoken lines (Hebrew with full Nikud).

## Generated assets (build-time only; API keys never reach the browser)
Keys come from env: `ELEVENLABS_API_KEY`, `GEMINI_API_KEY`.
- `scripts/gen-voice-candidates.mjs`, `gen-sfx-candidates.mjs`, `gen-image-candidates.mjs` → `review/` (git-ignored) for approval.
- Only approved files are copied into `public/` (`public/audio/<lang>/`, `public/sfx/`, `public/img/`, `public/icons/`), tracked in `assets/manifest.json`.
