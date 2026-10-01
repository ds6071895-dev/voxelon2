"""Upload verified media directly from Modal storage to a GitHub Release.

Create the release with gh first, then:
modal run scripts/publish_trailer.py --run=worlds-YYYYMMDD-HHMMSS --tag=worlds-v1.0
The active gh login is passed as an ephemeral Modal secret, never written to disk.
"""
from pathlib import Path
import json
import os
import subprocess
import zipfile

import modal

app = modal.App('worlds-release-publish')
volume = modal.Volume.from_name('worlds-release-media')
image = modal.Image.debian_slim(python_version='3.12').pip_install('requests')
secrets = []
if modal.is_local():
    token = subprocess.check_output(['gh', 'auth', 'token'], text=True).strip()
    secrets = [modal.Secret.from_dict({'GH_TOKEN': token})]
    del token


@app.function(image=image, secrets=secrets, volumes={'/media': volume}, timeout=1800, cpu=1, memory=1024)
def upload(run: str, repo: str, tag: str):
    import requests
    root = Path('/media') / run / 'final'
    verification = json.loads((root / 'verification.json').read_text())
    if verification['decodedFrames'] != 2820 or verification['longBlackGaps']:
        raise ValueError('The revised trailer has not passed verification.')
    headers = {'Authorization': f"Bearer {os.environ['GH_TOKEN']}", 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}
    release = requests.get(f'https://api.github.com/repos/{repo}/releases/tags/{tag}', headers=headers, timeout=60)
    release.raise_for_status()
    release = release.json()
    # ZIP archives are built in cloud temporary storage, not on the user's PC.
    screenshot_zip = Path('/tmp/worlds-v1.0-screenshots.zip')
    with zipfile.ZipFile(screenshot_zip, 'w', compression=zipfile.ZIP_STORED) as archive:
        for file in sorted((root / 'screenshots').glob('*.png')):
            archive.write(file, f'screenshots/{file.name}')
        archive.write(root / 'worlds-title-logo.svg', 'worlds-title-logo.svg')
    music_zip = Path('/tmp/worlds-awaken-original-score.zip')
    with zipfile.ZipFile(music_zip, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
        for file in sorted((root / 'audio').iterdir()):
            if file.suffix in {'.wav', '.m4a', '.json'}:
                archive.write(file, file.name)
    assets = [root / 'video/worlds-november-2026-trailer.mp4', screenshot_zip, music_zip, root / 'verification.json']
    urls = []
    for file in assets:
        existing = next((a for a in release['assets'] if a['name'] == file.name), None)
        if existing:
            raise ValueError(f'Release already contains {file.name}; refusing to overwrite an existing asset.')
        mime = 'video/mp4' if file.suffix == '.mp4' else 'application/zip' if file.suffix == '.zip' else 'application/json'
        with file.open('rb') as data:
            response = requests.post(release['upload_url'].split('{')[0], params={'name': file.name}, headers={**headers, 'Content-Type': mime}, data=data, timeout=900)
        response.raise_for_status()
        asset = response.json()
        urls.append({'name': asset['name'], 'bytes': asset['size'], 'url': asset['browser_download_url']})
        print(f"Uploaded {file.name}: {asset['size'] / 1024**2:.1f} MiB")
    return {'release': release['html_url'], 'assets': urls}


@app.local_entrypoint()
def main(run: str, repo: str = 'ds6071895-dev/voxelon2', tag: str = 'worlds-v1.0'):
    if '/' in run or '..' in run:
        raise ValueError('Invalid Modal run directory.')
    result = upload.remote(run, repo, tag)
    output = Path(__file__).resolve().parents[1] / 'release-media/revised/github-release.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2))
    print(result['release'])
