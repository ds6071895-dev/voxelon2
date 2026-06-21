▎ Build the resource-automation layer for VOXELON. Keep all existing constraints: Three.js + TS + Vite, no engine/voxel libs, no Mojang assets (all textures procedural), authoritative-lite MP, npm run smoke + tsc + npm run build green, and finish with an adversarial review. This is the economic base for a later warfare layer (missiles, turrets, drones), so design resources and machine state to extend.

New resources

- Cobalt Ore (Block.CobaltOre) — a second rare mountain ore (distinct from titanium): generates only u in its own deep Y band,rarer than iron. Requires an iron pickaxe; smelts to Cobalt Ingot (Item.CobaltIngot). Procedural tile (blue-grey speckle ore + ingot) reusing paintOre/paintIngot.
- Oil — a fluid resource stored as Oil Barrel (Item.OilBarrel) item units. Add an oil-field terrain layer: a low-frequency noise marking underground oil richness (denser under desert and ocean floors), optionally surfaced as rare Oil Shale
blocks/seeps as a visual "ge fuel/power currency latermachines consume.

Two machines (block-entities, furnace/chest style)

- Autominer (Block.Autominer) — placed on the ground, drills the column beneath it and produces ore into internal storage at a rate proportional to the local ore
richness sampled from Terra you've enabled (a checklist in its UI: stone, coal, iron, gold, redstone, diamond, titanium). The filter tiers are gated by machine level (basic: stone/coal/iron; mid: +gold/redstone; high: +diamond/titanium).
- Oil Derrick (Block.OilDero storage at a rate from the local oil-field richness; useless on dry ground, great over an oil field. Crafted
with Cobalt.

Both: cosmetic animated drilike the furnace, andright-click to open a UI showing storage, fill bar, current rate, the ore filter (autominer only), and upgrade controls.

Simulation (pure, server-authoritative)

- New Machines/server entitor chests inright-click to open a UI showing storage, fill bar, current rate, the ore filter (autominer only), and upgrade controls.                                           
Simulation (pure, server-authoritative)

- New Machines/server entity map keyed by position (mirror chests in              server_core.ts): {type, lev stored: {item:count},progressAccumulator}. Tick it inside the server's existing per-second loop.       - Pure yield function: yiel-item rates, computed fromTerrain ore/oil richness — so it works with no chunk loaded and is unit-testable. - Storage capped by storage full.
- New protocol messages mirroring chests: machinePlace/machineOpen/machineConfig (set filter) / machineUpgrade / machineCollect, and a server→client machineState. Placement is a normal in-retput is server-simulated(bypasses EDIT_RANGE legitimately because the server is the miner). Offline SP runs the identical pure module locally.
                                                                                    Upgrades & storage
                                                                                    - Two upgrade axes per machin the UI by payingescalating resources (iron → diamond → titanium/cobalt): Production (rate + unlocks higher ore-filter tiers) ansts and current level in the UI. (Module-items are a fine alternative if you prefer Factorio-style inserts — pick one.)
- Collect output by openings (like a chest), orauto-output into an adjacent chest if present (nice-to-have).

Crafting, textures, UX

- Recipes: Autominer = iron + redstone + a pickaxe core (tiered feel); Oil Derrick =
iron + cobalt ingots + reds Cobalt smelting infurnace.ts's SMELT.
- All sprites procedural inognizable iso-ish blockfaces with a drill/derrick motif; cobalt ore/ingot; oil barrel; oil shale). New Tile/Block/Item enum entries (atlas has room: tiles ≤ 255).
- HUD/UI: reuse the containui.ts; machine runs underthe never-pausing sim like everything else.

Tests + verification (required)

- Smoke: cobalt ore generat+ tier; oil-field sampling;pure yield function (richness → rate, filter gating, level effects); server machine
lifecycle (place → tick accect → upgrade changesrate/cap → filter rejects ungated ores); offline parity.
- Keep tsc/npm run smoke/npacross runs; then run theadversarial-review workflow and fix confirmed findings (watch for: item dup/loss on collect, storage overflow, upgrade-cost exploits, machine state desync, resource leaks, NaN in yield).

Forward hooks (don't build yet, just leave room)

- Treat Oil Barrels as the future power/fuel currency; keep machine state generic enough that refineries → gesiles can later consumestored oil/ore and read machine state over the same message channel.