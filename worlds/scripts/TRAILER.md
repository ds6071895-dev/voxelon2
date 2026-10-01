# Worlds release media

The standalone `trailer.html` stage renders the real Worlds generators, models,
textures, sky and post-processing. Character actions are staged cinematics.
It does not connect to a game server. The end card says **November 2026**, has no
URL, and loads the exact logo SVG from the game's title screen.

## Preview

Run `npm run dev`, then open `http://localhost:5174/trailer.html`. Select a shot
or press **Play preview**. The preview pauses while the next scene loads;
offline export has no loading gaps. Music is mixed into the exported video.

## Generate the original score

```sh
npm run trailer:music
```

`scripts/compose_trailer.mjs` synthesizes the original 94-second, 120 BPM score
**Worlds Awaken**. It exports 48 kHz / 24-bit stereo WAV, melody, atmosphere,
percussion and effects stems, and a machine-readable note list. No audio assets
or third-party samples are needed.

## Capture

Install Playwright with Chromium outside the project if preferred, and provide
FFmpeg. On machines without a GPU, Chromium uses SwiftShader and takes longer;
the simulation still advances at a fixed rate and produces smooth output.

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
FFMPEG=/path/to/ffmpeg npm run trailer
```

The script starts its own Vite server on port 5184 and closes it after capture.
`TRAILER_PORT`, `TEST_URL` and `CHROMIUM_PATH` override the defaults.

Options:

- `--stills-only` or `--video-only`
- `--width=1920 --height=1080 --fps=30`
- `--stills-width=3840` (16:9)
- `--quality=balanced` (fixed shader tier), `--quality=max`, or `--quality=high`
  (direct renderer without post-processing)
- `--output=release-media`

Outputs under `release-media/` include the H.264/AAC MP4, original score and
stems, eight clean screenshots, two branded hero images, a thumbnail, an end
card, the logo SVG, and capture manifests. This generated directory is ignored
by Git. VP9/IVF is retained as the intermediate picture master.

## Modal cloud capture

With the Modal Python SDK installed and the existing account profile active:

```sh
modal run scripts/modal_trailer.py --proof
modal run scripts/modal_trailer.py
```

The proof exports review images only. The full run renders four video partitions
and the screenshots concurrently in cloud containers, then composes the extended
score, assembles the edit, and verifies it on Modal. It downloads final media to
`release-media/revised/`; audio stems stay in the `worlds-release-media` Modal
volume. Browser installs and intermediate frame streams stay in the cloud.

`scripts/publish_trailer.py` uploads the verified trailer, screenshot ZIP and
original score/stems directly from the Modal volume to an existing GitHub
Release. It uses the active `gh` login via an ephemeral secret. Large media is
published as Release assets, keeping Git history small.

The 94-second edit ends with a dramatic **November 2026** reveal, followed by
early access **starting within the next few days** and the exclusive **Void Cape**
announcement. The teaser uses a heavily blurred black silhouette with no emblem
or final design. Promotional mode branding is **Parkour**.

The capture script validates frame counts, propagates browser errors, and uses
two-pass loudness normalization targeting −14 LUFS and −1 dBTP.

`npm run trailer:check` audits camera clearance against the real world geometry.
After capture, `FFMPEG=/path/to/ffmpeg npm run trailer:verify` decodes the entire
MP4, checks frame count, resolution, audio loudness, unexpected black gaps, PNG
dimensions and logo identity, then writes `release-media/verification.json`.
