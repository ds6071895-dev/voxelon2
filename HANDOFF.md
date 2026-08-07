# VOXELON — continuation prompt

Copy everything below into a new chat.

---

Continue work on VOXELON (`/home/aiscoding2022/minecraft`, browser voxel game, TypeScript + three.js + a Node/ws authoritative server). Everything up to and including commit **`VOXELON v0.15`** is done, committed and green — `npx tsc --noEmit`, `npm run build`, `npm run smoke`, `npm run boss-smoke`, `npm run music-smoke` all pass. Start by reading `MEMORY.md` and the `lifesteal-world-progress.md` memory file, which has the full detail of the last two batches.

## Two jobs remain

### 1. Completely redesign the guide — much clearer and much prettier (NOT STARTED)

There are **two** things called "the guide" and both need attention:

- **`src/field_guide.ts`** — the big reference screen opened from the pause menu. `createFieldGuide()` builds it from one `overlay.innerHTML` template with a left nav, a search box, and long HTML article blobs assembled by `fieldGuideSections()` via `list()/steps()/tip()/warning()/table()` helpers. Styling is the `.field-guide-*` block in `index.html`. It is dense, text-heavy and visually unrelated to the rest of the game.
- **`src/guide.ts` + the panel rendered in `main.ts`** — the getting-started checklist HUD (10 sticky steps, toggled with `H`, `renderGuidePanel()` in main.ts).

**Reuse the `.sheet-scrim` / `.sheet-card` pattern already in `index.html`** (added for the Controls panel last batch: pinned header, internally-scrolling body, always-visible primary button, backdrop-click + Esc to close, gold-on-ink to match the redesigned title screen). That pattern is exactly what the guide should adopt so the whole game reads as one product. Look at the Controls panel in `main.ts` (`const controlsPanel = (() => {…})()`) for the intended structure and the `[action, alternatives, hint]` data model — it is the reference implementation for "clear".

Aim for: real visual hierarchy, scannable cards instead of walls of prose, consistent iconography, working search, and nothing clipped at any viewport size.

### 2. Make boss loot actually worth killing them for

Audit and rebalance vault boss rewards. Current state:

- `VAULT_LOOT` in `src/vaults.ts` — weighted pools per tier, plus `VAULT_ROLLS` (T1 7 picks / T2 8 / T3 9) and guarantees in `vaultLoot()`: every haul gives the boss relic (`BOSS_RELIC`: WardenSigil / MireBloom / EmberCore / SeerPrism / ArtificerGear), T1 also 3 Bandages + 16 Bullets, T2 a Medkit + 2 Titanium, T3 a Heart + 3 Diamonds + a random rune.
- Loot is **per player** and **re-rollable every 30 minutes** (`vaultLootCooldownLeft`), gated by `vaultLootable()` (boss dead within `VAULT_LOOT_WINDOW`).

Questions to answer with evidence, then act on:
- What do the five **boss relics** actually DO? If they are vendor trash or unused, that is the single biggest "not worth it" problem — either give them a real use (crafting an exclusive item, a permanent upgrade, faction/season score) or replace them.
- Does the reward scale with the real cost? Last batch measured the fight length: with 50% uptime and the boss healing its full 35% cap, T3 takes **74s (rifle) to 292s (sniper)**, against a 360s enrage. Is a T3 haul worth ~5 minutes plus the ammo, consumables and risk?
- T1 currently rolls a `Heart` at weight 0.35 in a pool totalling ~24 — check whether the jackpot rate feels right, and whether T1 (a ≤±500 core vault, ~26–35s fight) is over- or under-paying.
- Cross-check against what the same time spent mining, raiding or running Crashed Cargo Pods (`LOOT_TABLES` in `src/loot.ts`) yields. Boss loot should clearly beat the alternatives or nobody will fight bosses.

Keep it **worth it but not trivialising** — same principle applied to boss difficulty last batch.

## House rules for this repo

- `src/*.ts` files are pure/transport-agnostic where they say so; the server (`src/net/server_core.ts`) and the offline client path both drive the same pure modules, so **fix logic in the shared module, not twice**. Recent example: `gunVolley()` in `items.ts` is used by both boss-hit validators.
- Add smoke checks for anything behavioural — `scripts/smoke.ts` (700+ checks), `scripts/boss_smoke.ts`, `scripts/boss_music_smoke.ts`.
- Verify visually with headless Chrome. **The binary path is `~/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell`** (the `-1234` directory no longer exists). Run `npm run dev` and screenshot with `--no-sandbox --disable-gpu --enable-unsafe-swiftshader --window-size=W,H --virtual-time-budget=8000 --screenshot=out.png http://localhost:5173/`. Test at 1440×900, 1280×620 and 420×820. Throwaway pages that import a module and render it are a good way to see in-game visuals without playing; delete them afterwards.
- No Mojang assets — everything is procedurally generated.

## Recently fixed, do not regress

- First-person and third-person arm swings travel **forward** (`stridePose()` in `remoteplayers.ts` — limbs pivot at the top of a −z-facing model, so `rotation.x > 0` is forward).
- A **live vault arena outranks the shrinking war border** on both client and server (`liveArenaFor` / `inLiveVaultFight`), and the border never leaves anyone embedded in rock (`clampInsideBorder` + `relocateInsideBorder` / `surfaceAfterBorderPull`).
- `GameAudio.startVaultMusic` is **idempotent** — calling it again must never rewind a running 5-minute boss score to bar one. `VAULT_EXIT_GRACE` (1.2s) stops a knockback flickering the vault bounds and tearing the fight down.
