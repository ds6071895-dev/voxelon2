"""Cloud-only rendering. Local machine receives final media, never frame caches.

modal run scripts/modal_trailer.py --proof
modal run scripts/modal_trailer.py
"""
from pathlib import Path
import json
import shutil
import subprocess
import time

import modal

ROOT = Path(__file__).resolve().parents[1]
app = modal.App("worlds-release-trailer")
volume = modal.Volume.from_name("worlds-release-media", create_if_missing=True)
image = (
    modal.Image.from_registry("node:22-bookworm-slim", add_python="3.12")
    .apt_install("ffmpeg")
    .run_commands(
        "npm install --prefix /opt/capture-tools playwright",
        "/opt/capture-tools/node_modules/.bin/playwright install --with-deps chromium --only-shell",
    )
    .add_local_dir(
        ROOT, "/app", copy=True,
        ignore=["node_modules", "release-media", "dist", ".git", "*.log", "*.md", "**/__pycache__", ".env*", "worlds-accounts.json"],
    )
    .run_commands("cd /app && npm ci")
)


def command(*args, env=None):
    import os
    subprocess.run(args, cwd="/app", check=True, env={**os.environ, **(env or {})})


@app.function(image=image, cpu=4, memory=8192, timeout=7200, volumes={"/media": volume})
def render_partition(run: str, partition: int, proof: bool = False):
    output = f"/media/{run}/part-{partition}"
    args = ["node", "scripts/capture_trailer.mjs", f"--output={output}"]
    if partition == 4:
        args += ["--stills-only"]
        if proof:
            args += ["--stills-width=1920", "--width=960", "--height=540"]
    else:
        shots = ["0,1,2,3", "4,5,6,7", "8,9,10,11,12", "13,14,15,16"][partition]
        args += ["--video-only", "--picture-only", f"--shots={shots}"]
    command(*args, env={"PLAYWRIGHT_MODULE": "/opt/capture-tools/node_modules/playwright/index.mjs", "FFMPEG": "ffmpeg"})
    volume.commit()
    return output


@app.function(image=image, cpu=4, memory=8192, timeout=10800, volumes={"/media": volume})
def produce(run: str, proof: bool = False):
    if proof:
        render_partition.remote(run, 4, True)
        volume.reload()
        source = Path(f"/media/{run}/part-4")
        command("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-pattern_type", "glob", "-i", str(source / "screenshots/*.png"), "-vf", "scale=480:270,tile=4x4", "-frames:v", "1", str(source / "review.png"))
        volume.commit()
        return {"run": run, "proof": True, "files": [str(p.relative_to('/media')) for p in [source / 'review.png', source / 'screenshots/04-duels.png', source / 'screenshots/03-bridge-showdown.png', source / 'screenshots/13-void-cape-teaser.png']]}

    calls = [render_partition.spawn(run, p) for p in range(5)]
    for call in calls:
        call.get()
    volume.reload()
    target = Path(f"/media/{run}/final")
    shutil.copytree(Path(f"/media/{run}/part-4"), target, dirs_exist_ok=True)
    manifests = [json.loads(Path(f"/media/{run}/part-{p}/picture-manifest.json").read_text()) for p in range(4)]
    manifest = manifests[0]
    total = sum(m['frameCount'] for m in manifests)
    ivf = target / 'video/worlds-release-picture.ivf'
    with ivf.open('wb') as out:
        for partition in range(4):
            with Path(f"/media/{run}/part-{partition}/video/worlds-release-picture.ivf").open('rb') as src:
                header = bytearray(src.read(32))
                if partition == 0:
                    header[24:28] = total.to_bytes(4, 'little')
                    out.write(header)
                shutil.copyfileobj(src, out)
    stills = json.loads((target / 'screenshots-manifest.json').read_text())
    manifest.update(screenshots=stills['screenshots'], frameCount=total, video='video/worlds-november-2026-trailer.mp4', cloud='Modal', run=run)
    manifest.pop('selected', None)
    (target / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    command('node', 'scripts/compose_trailer.mjs', str(target / 'audio'))
    command('node', 'scripts/mix_trailer.mjs', str(target / 'audio'))
    command('ffmpeg', '-hide_banner', '-loglevel', 'warning', '-y', '-i', str(ivf), '-i', str(target / 'audio/trailer-final-mix.wav'), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '320k', '-t', str(manifest['duration']), '-movflags', '+faststart', '-metadata', 'title=Worlds — November 2026 Release Trailer', str(target / manifest['video']))
    command('node', 'scripts/verify_release.mjs', str(target))
    command('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(target / manifest['video']), '-vf', 'fps=1/5,scale=384:216,tile=4x5', '-frames:v', '1', str(target / 'review.png'))
    # Keep audio stems in cloud storage; only final deliverables come back.
    ivf.unlink()
    (target / 'audio/trailer-mix-premaster.wav').unlink()
    for partition in range(4):
        # Completed partitions are intermediate files, not additional masters.
        shutil.rmtree(Path(f"/media/{run}/part-{partition}"))
    shutil.rmtree(Path(f"/media/{run}/part-4"))
    files = [str(p.relative_to('/media')) for p in target.rglob('*') if p.is_file() and p.name not in {'melody.wav', 'atmosphere.wav', 'percussion.wav', 'effects.wav'}]
    volume.commit()
    return {'run': run, 'proof': False, 'files': files}


@app.local_entrypoint()
def main(proof: bool = False):
    run = time.strftime('worlds-%Y%m%d-%H%M%S')
    result = produce.remote(run, proof)
    destination = ROOT / 'release-media' / ('modal-proof' if proof else 'revised')
    destination.mkdir(parents=True, exist_ok=True)
    prefix = f"{run}/{'part-4' if proof else 'final'}/"
    for remote in result['files']:
        local = destination / remote.removeprefix(prefix)
        local.parent.mkdir(parents=True, exist_ok=True)
        with local.open('wb') as out:
            for chunk in volume.read_file(remote):
                out.write(chunk)
    (destination / 'modal-run.json').write_text(json.dumps(result, indent=2))
    print(f"Modal render complete: {destination}")
