# Long-Form Adaptive Dungeon Boss Soundtracks

Voxelon now generates five original boss scores live with the browser's native WebAudio engine. There are no recorded samples, external downloads, streaming dependencies, or third-party music licences. The score remains synchronized to combat and can change orchestration without restarting.

## Long-form structure and looping

Every theme uses the same reliable macro form while retaining completely different musical material:

- 96 bars per exact musical cycle.
- 1,536 scheduled sixteenth-note steps per cycle.
- Twelve eight-bar sections: awakening, procession, first oath, shadow answer, iron chorus, hollow centre, the hunt, fracture, false victory, ascension, final form, and return to seal.
- Twenty-four transformed four-bar motif phrases per cycle.
- Forty-eight two-bar harmonic destinations, with a separate progression for each boss.
- Deterministic rotations, reversals, transpositions, octave displacement, counterlines, fills, breakdowns, builds, and section impacts.
- The final section resolves toward the opening tonic. Reverb and delay tails continue over the boundary, so there is no gap, click, or obvious restart.
- Phase and low-health layers are selected at scheduler boundaries and never reset the long-form position.

### Verified loop durations

| Boss | Track | Tempo | Exact 96-bar duration |
|---|---|---:|---:|
| Bone Warden | **Ossuary Oath** | 76 BPM | **5:03** |
| Mire Queen | **Crown Beneath the Mire** | 92 BPM | **4:10** |
| Ember Colossus | **Heart of the Furnace** | 132 BPM | **2:55** |
| Crystal Seer | **Refraction Prophecy** | 108 BPM | **3:33** |
| Gilded Artificer | **The Brass Equation** | 120 BPM | **3:12** |

## Adaptive behavior

- Phase 1 establishes the identity with restrained density and room for combat effects.
- Phase 2 adds countermelodies, additional percussion, wider harmony, and stronger signature layers.
- Phase 3 adds high ostinatos, sharper rhythmic motion, and the broadest orchestration.
- Low health adds a double-heartbeat pulse and elevated tension responses without speeding up or restarting the score.
- Summon, poise-break, phase-change, enrage, victory, and reset events trigger synchronized musical stingers.
- Repeated victory/end messages are de-duplicated, preventing doubled fanfares in offline or networked encounters.
- Starting another encounter safely cancels scheduled sources from the previous score.
- Leaving a vault, dying, disconnecting, resetting, and victory all use controlled fades and source cleanup.

## Shared production chain

Each score runs through a dedicated music graph containing:

- Dry and ambience sends.
- Generated stereo convolution reverb.
- Tempo-synchronized delay and controlled feedback.
- Stereo panning and moving spatial gestures.
- A protective dynamics compressor with conservative per-voice gain staging.
- Deterministic generated noise for percussion and textures.

This keeps the result powerful while preserving headroom for attacks, hazards, UI cues, and other essential sound effects.

## Boss identities

### Bone Warden — “Ossuary Oath”

A slow Phrygian funeral procession built from low choir-like oscillators, tomb-bell partials, bone clacks, sub impacts, and a descending oath motif. Sparse ceremonial passages alternate with heavy choral statements. Later phases add exposed upper voices and increasingly urgent ossuary percussion.

### Mire Queen — “Crown Beneath the Mire”

A swung swamp ritual with filtered reed leads, wet band-passed percussion, bubbling textures, insect trills, sliding bass, and predatory modal harmony. Its pulse remains organic rather than mechanical, with syncopated answers and wide, humid ambience.

### Ember Colossus — “Heart of the Furnace”

An aggressive industrial-furnace battle score with huge pitched drums, detuned brass and saw layers, anvil partials, pressure-noise snares, sparks, and asymmetric accents. The arrangement alternates crushing mass with pressure-drop breakdowns before the machinery surges back.

### Crystal Seer — “Refraction Prophecy”

A beautiful but alien Lydian score made from inharmonic glass partials, long crystalline decay, refracted arpeggios, stereo echoes, prophetic pads, and sparse low punctuation. Later phases overlap reflected notes and fracture the melody into wider harmonic planes.

### Gilded Artificer — “The Brass Equation”

A clockwork orchestral-industrial duel combining alternating ticks, gear clacks, mechanical bass cells, metallic partials, precise counterpoint, and broad brass stabs. The twelve-section form gradually destabilizes the machine while keeping the pulse exact.

## Files and extension points

- `src/boss_music.ts` contains profiles, synthesis voices, signal routing, scheduling, looping, stingers, and cleanup.
- `src/audio.ts` owns the shared game audio buses and delegates boss-score control to `BossMusicEngine`.
- `scripts/boss_music_smoke.ts` validates all five profiles, exact loop length, durations, and bounded ambience settings.
- `npm run music-smoke` runs the dedicated soundtrack checks.

To add another boss, create its score profile and family-specific scheduling voice, then extend the long-form harmony path. Keep individual voice gains conservative; the compressor is protection and glue, not a substitute for balanced orchestration.


## Dramatic encounter redesign

Boss music now runs through an encounter mix that lifts the score while gently
ducking ambience and non-critical effects. Warning sounds remain prominent and
the ordinary mix is restored on victory, reset, death, disconnect, or leaving a
vault. New synchronized cues cover the boss-room seal, locomotion/teleports,
army waves, healing channels, healing interruption, and major combo beats.

All five bosses now use the shared deterministic locomotion, army, healing and
arena-seal systems. Critical family structures visibly channel bounded healing
until players destroy them; the same structures continue producing themed army
pressure. The server owns these systems online and the identical encounter
engine owns them offline.
