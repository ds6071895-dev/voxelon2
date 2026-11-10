"""Cloud render on Daytona. The local machine only uploads the source and
receives the finished deliverables; frame streams stay in the cloud.

    DAYTONA_API_KEY=... python scripts/daytona_trailer.py [--workers 6] [--proof]

Workers are Daytona sandboxes that pull contiguous shot ranges from a queue and
render them with scripts/capture_trailer.mjs (headless Chromium, SwiftShader).
Picture partitions land on a shared Daytona volume; the first worker then
assembles them in timeline order, composes the score, masters the MP4,
verifies it, and the final files are downloaded to release-media/revised/.
The volume is cleared only after the download, so a failed step can resume with --run.
--proof renders only a still contact sheet of every shot at 960x540.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import queue
import tarfile
import threading
import time
from pathlib import Path

from daytona import (CreateSandboxFromImageParams, Daytona, DaytonaConfig, Image, Resources,
                     SessionExecuteRequest, VolumeMount)

ROOT = Path(__file__).resolve().parents[1]
EXCLUDE = {'node_modules', 'release-media', 'dist', '.git', 'test-artifacts', '__pycache__', '.vite'}
EXCLUDE_FILES = {'worlds.zip', 'worlds-accounts.json'}
TOOLS = '/opt/capture-tools/node_modules/playwright/index.mjs'
IMAGE = (
    Image.base('node:22-bookworm')
    .run_commands(
        'apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*',
        'npm install --prefix /opt/capture-tools playwright@1.56.1',
        '/opt/capture-tools/node_modules/.bin/playwright install --with-deps chromium',
    )
)


def log(*args):
    print(time.strftime('[%H:%M:%S]'), *args, flush=True)


def source_tarball() -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz') as tar:
        for path in sorted(ROOT.iterdir()):
            if path.name in EXCLUDE or path.name in EXCLUDE_FILES or path.name.endswith('.log'):
                continue
            tar.add(path, arcname=path.name, filter=lambda info: None if any(part in EXCLUDE for part in Path(info.name).parts) else info)
    return buf.getvalue()


def timeline() -> dict:
    return json.loads((ROOT / 'src/trailer/timeline.json').read_text())


def partitions(shots: list[dict], target: float) -> list[list[int]]:
    """Contiguous shot ranges of roughly `target` seconds each (timeline order)."""
    out, cur, acc = [], [], 0.0
    for i, s in enumerate(shots):
        cur.append(i); acc += s['duration']
        if acc >= target:
            out.append(cur); cur, acc = [], 0.0
    if cur:
        out.append(cur)
    return out


class Worker:
    def __init__(self, daytona: Daytona, name: str, volume_id: str, tarball: bytes, cpu: int = 4, memory: int = 8):
        self.name = name
        params = CreateSandboxFromImageParams(
            image=IMAGE, resources=Resources(cpu=cpu, memory=memory, disk=10), auto_stop_interval=0,
            volumes=[VolumeMount(volume_id=volume_id, mount_path='/media')], labels={'app': 'worlds-trailer'},
        )
        self.sb = daytona.create(params, timeout=1800, on_snapshot_create_logs=lambda line: log(f'{name} build:', line.strip()[:160]))
        log(f'{name}: sandbox {self.sb.id} ready')
        self.sb.fs.upload_file(tarball, '/tmp/worlds.tgz')
        self.run('mkdir -p /app && tar -xzf /tmp/worlds.tgz -C /app && cd /app && npm ci --no-audit --no-fund --loglevel=error', 1200)
        self.session = f'render-{name}'
        self.sb.process.create_session(self.session)

    def run(self, command: str, timeout: int = 600) -> str:
        r = self.sb.process.exec(command, timeout=timeout)
        if r.exit_code:
            raise RuntimeError(f'{self.name}: `{command[:80]}` failed ({r.exit_code}):\n{r.result[-3000:]}')
        return r.result

    def long(self, command: str, label: str) -> None:
        """Run a long command asynchronously in the session and poll it to completion."""
        cmd = self.sb.process.execute_session_command(self.session, SessionExecuteRequest(command=command, run_async=True))
        seen = 0
        while True:
            time.sleep(10)
            info = self.sb.process.get_session_command(self.session, cmd.cmd_id)
            logs = self.sb.process.get_session_command_logs(self.session, cmd.cmd_id)
            text = (logs.stdout or '') + (logs.stderr or '') if hasattr(logs, 'stdout') else str(logs)
            for line in text[seen:].splitlines():
                if line.strip():
                    log(f'{self.name} {label}:', line.strip()[:200])
            seen = len(text)
            if info.exit_code is not None:
                if info.exit_code:
                    raise RuntimeError(f'{self.name} {label} failed with exit code {info.exit_code}:\n{text[-3000:]}')
                return

    def delete(self):
        try:
            self.sb.delete()
        except Exception as e:  # noqa: BLE001 - best effort cleanup
            log(f'{self.name}: delete failed: {e}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--workers', type=int, default=6)
    ap.add_argument('--seconds', type=float, default=12, help='target seconds of trailer per work item')
    ap.add_argument('--proof', action='store_true')
    ap.add_argument('--cpu', type=int, default=3)
    ap.add_argument('--memory', type=int, default=3, help='GiB per worker (the account allows 10 GiB in total)')
    ap.add_argument('--run', help='resume this run id: items already on the volume are skipped')
    args = ap.parse_args()
    key = os.environ.get('DAYTONA_API_KEY')
    if not key:
        raise SystemExit('Set DAYTONA_API_KEY')
    daytona = Daytona(DaytonaConfig(api_key=key))
    run = args.run or time.strftime('worlds-%Y%m%d-%H%M%S')
    tl = timeline()
    shots = tl['shots']
    items: list[tuple[str, str]] = []
    if args.proof:
        items.append(('proof', ''))
    else:
        items.append(('stills', '--stills-only'))
        for k, part in enumerate(partitions(shots, args.seconds)):
            items.append((f'part-{k:02d}', f"--video-only --picture-only --shots={','.join(map(str, part))}"))
    parts = [name for name, _ in items if name.startswith('part-')]
    log(f'run {run}: {len(items)} work items {[n for n, _ in items]}')

    volume = daytona.volume.get('worlds-release-media', create=True)
    while getattr(volume, 'state', 'ready') not in ('ready', 'VolumeState.READY') and 'ready' not in str(volume.state).lower():
        time.sleep(3); volume = daytona.volume.get('worlds-release-media')
    tarball = source_tarball()
    log(f'source tarball {len(tarball) / 1e6:.1f} MB')

    work: queue.Queue = queue.Queue()
    for item in items:
        work.put(item)
    workers: list[Worker] = []
    lock = threading.Lock()
    errors: list[BaseException] = []

    def worker_loop(index: int):
        try:
            w = Worker(daytona, f'w{index}', volume.id, tarball, args.cpu, args.memory)
        except Exception as e:  # noqa: BLE001 - quota or build failures shrink the pool
            log(f'w{index}: could not start ({e}); continuing with fewer workers')
            return
        with lock:
            workers.append(w)
        while True:
            try:
                name, flags = work.get_nowait()
            except queue.Empty:
                return
            done_marker = 'screenshots-manifest.json' if name in ('stills', 'proof') else 'picture-manifest.json'
            if w.sb.process.exec(f'test -f /media/{run}/{name}/{done_marker}').exit_code == 0:
                log(f'{w.name}: {name} already on the volume, skipping')
                continue
            try:
                start = time.time()
                env = f'PLAYWRIGHT_MODULE={TOOLS} FFMPEG=ffmpeg'
                if name == 'proof':
                    w.long(f"cd /app && {env} node scripts/capture_trailer.mjs --stills-only --stills-width=960 --output=/app/out/{name} 2>&1", name)
                else:
                    w.long(f'cd /app && {env} node scripts/capture_trailer.mjs {flags} --output=/app/out/{name} 2>&1', name)
                w.run(f'mkdir -p /media/{run} && rm -rf /media/{run}/{name} && cp -r /app/out/{name} /media/{run}/{name} && sync', 900)
                log(f'{w.name}: {name} done in {time.time() - start:.0f}s')
            except BaseException as e:  # noqa: BLE001
                log(f'{w.name}: {name} FAILED: {e}')
                with lock:
                    errors.append(e)
                return

    threads = [threading.Thread(target=worker_loop, args=(i,), daemon=True) for i in range(args.workers)]
    for i, t in enumerate(threads):
        t.start()
        time.sleep(2 if i else 45)  # let the first sandbox build the image before the rest reuse it
    try:
        for t in threads:
            t.join()
        if errors:
            raise RuntimeError(f'{len(errors)} work items failed')
        if not workers:
            raise RuntimeError('No Daytona workers could start')
        if not work.empty():
            raise RuntimeError('Work items left unrendered')
        master = workers[0]
        dest = ROOT / 'release-media' / ('daytona-proof' if args.proof else 'revised')
        if args.proof:
            master.run(f"cd /media/{run}/proof && ffmpeg -hide_banner -loglevel error -y -pattern_type glob -i 'screenshots/*.png' -vf scale=480:270,tile=4x5 -frames:v 1 review.png", 300)
            files = ['review.png']
            base = f'/media/{run}/proof'
        else:
            log('assembling, composing and mastering on', master.name)
            master.sb.fs.upload_file(json.dumps({'run': run, 'parts': parts}).encode(), '/app/assemble.json')
            master.sb.fs.upload_file((ROOT / 'scripts/daytona_assemble.mjs').read_bytes(), '/app/scripts/daytona_assemble.mjs')
            master.long('cd /app && FFMPEG=ffmpeg node scripts/daytona_assemble.mjs /app/assemble.json 2>&1', 'master')
            base = '/app/final'
            listing = master.run(f'cd {base} && find . -type f | sort')
            files = [f[2:] for f in listing.split() if f.startswith('./')]
        dest.mkdir(parents=True, exist_ok=True)
        for f in files:
            local = dest / f
            local.parent.mkdir(parents=True, exist_ok=True)
            data = master.sb.fs.download_file(f'{base}/{f}')
            local.write_bytes(data)
            log(f'downloaded {f} ({len(data) / 1e6:.1f} MB)')
        (dest / 'daytona-run.json').write_text(json.dumps({'run': run, 'workers': len(workers), 'items': [n for n, _ in items], 'files': files}, indent=2))
        if not args.proof:
            master.run(f'rm -rf /media/{run}', 600)
        log(f'Daytona render complete: {dest}')
    finally:
        for w in workers:
            w.delete()


if __name__ == '__main__':
    main()
