# Worlds release media

The standalone `trailer.html` stage renders the real Worlds generators, models,
textures, sky and post-processing. Character actions are staged cinematics; it
does not connect to a game server.

## The edit (124 s, 26 shots, 120 BPM)

Cut from `src/trailer/timeline.json`: picture in `src/trailer/staging.ts`
(classic games) and `src/trailer/staging_modes.ts` (Lucky Pillars, Disaster City,
Party Games, capes, RPG), overlays in `src/trailer/main.ts`, score and sound cues
in `scripts/compose_trailer.mjs`. Order: cold open ("ONE WORLD. / SEVEN GAMES.")
→ Lucky Pillars → Disaster City → Party Games → The Bridge → Duels → Parkour →
Rat and Seek → **CAPES ARE COMING** (rarity tiers from `src/capes.ts`, modelled in
`src/trailer/cape.ts`; never the Void Cape) → poster wall of all seven games →
Worlds logo + NOVEMBER 2026 → **the RPG act**, a separate launch with its own
build-up: black and a heartbeat ("ONE MORE THING…"), a sunset over the valley
("A BRAND-NEW GAME. / SEPARATE FROM WORLDS."), a lone hero walking into the night
("ITS OWN WORLD. / ITS OWN LAUNCH."), a rising montage cut on lightning, a held
breath of silence, then the title slam (`timeline.json` → `rpg`: February 2027,
"A SEPARATE LAUNCH FROM WORLDS", early access starting soon, and both launch
dates side by side). Montage hard cuts set `camera.cut` so the audit doesn't
sweep the camera through terrain between them. Gameplay shots are letterboxed to ~2.2:1.

## Preview

`npm run dev`, then `http://localhost:5174/trailer.html` (`?shot=N` opens a shot).
`npm run trailer:check` audits every camera, body and rat against the real world
geometry and must report 0 failures.

## Score

`npm run trailer:music` synthesizes **Worlds Rising**, an original orchestral-
hybrid score in D minor (strings, spiccato, braams, horns, choir, taiko,
timpani, bells; FFT convolution hall; master EQ). No samples.

## Capture

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs FFMPEG=/path/to/ffmpeg npm run trailer
```

Options as before: `--stills-only`, `--video-only [--picture-only --shots=…]`,
`--width/--height/--fps`, `--stills-width` (default 1920: release stills are 1080p, never 4K), `--quality`, `--output`.

## Daytona cloud render

```sh
DAYTONA_API_KEY=… python scripts/daytona_trailer.py [--workers N] [--proof]
```

Sandboxes (image: node 22 + ffmpeg + Playwright Chromium) pull contiguous shot
ranges from a queue, write picture partitions to the `worlds-release-media`
Daytona volume, and the first worker assembles, composes, masters and verifies
(`scripts/daytona_assemble.mjs`). Finals download to `release-media/revised/`.
The account allows 10 GiB of sandbox memory in total, so size `--workers` to fit.
Never commit the API key.

## Card art and app branding

`cardart.html` renders seven title-card scenes without a multiplayer server and
is included alongside the game/trailer in the build. Use explicit browser paths:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome \
  npm run cards -- --only=minigames,duels --output=node_modules/.tmp/card-review
```

`CARDS_PORT` defaults to 5185; `TEST_URL` reuses a supplied page server. The
normal output default remains `public/cards/` for intentional published-card
updates. Unknown, empty or duplicate card filters fail before capture. Game-card
capture does not regenerate the app icons or OG image; the retained branding
assets need a separate reviewed rasterization of the full title SVG, described
in `README.md`.
