#!/usr/bin/env python3
"""
Pull everything recoverable from a list of Instagram reel/post links so a
recipe can be written from it: the caption, a speech transcript of the audio,
and a handful of video frames (for on-screen text).

    python3 scripts/ig-extract.py links.txt --out /path/to/packets

links.txt: one URL per line (blank lines and # comments ignored). The output
folder gets one <shortcode>.json packet per link plus <shortcode>/frame_NN.jpg,
and a manifest.json. Media files are NOT meant to be committed.

Needs: yt-dlp, faster-whisper (pip install yt-dlp faster-whisper) and ffmpeg.
"""
import argparse, json, os, re, subprocess, sys, time
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument('links')
ap.add_argument('--out', required=True)
ap.add_argument('--model', default='base', help='faster-whisper model: tiny|base|small|medium')
ap.add_argument('--frames', type=int, default=8)
ap.add_argument('--skip-video', action='store_true', help='caption only, no download/transcript')
args = ap.parse_args()

out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
links = [l.strip() for l in Path(args.links).read_text().splitlines() if l.strip() and not l.strip().startswith('#')]
links = list(dict.fromkeys(links))  # dedupe, keep order

def shortcode(url):
    m = re.search(r'/(?:reel|reels|p|tv)/([A-Za-z0-9_-]+)', url)
    return m.group(1) if m else re.sub(r'\W+', '_', url)[-24:]

def run(cmd, timeout=300):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)

model = None
if not args.skip_video:
    from faster_whisper import WhisperModel
    model = WhisperModel(args.model, device='cpu', compute_type='int8')

manifest = []
for i, url in enumerate(links, 1):
    sc = shortcode(url)
    packet = out / f'{sc}.json'
    if packet.exists():
        print(f'[{i}/{len(links)}] {sc}: already done'); manifest.append(json.loads(packet.read_text())); continue
    print(f'[{i}/{len(links)}] {sc}: fetching…', flush=True)
    rec = {'url': url, 'shortcode': sc, 'ok': False}
    work = out / sc; work.mkdir(exist_ok=True)
    try:
        cmd = ['python3', '-m', 'yt_dlp', '-q', '--no-warnings', '--write-info-json', '-o', str(work / 'video.%(ext)s'), url]
        if args.skip_video: cmd.insert(cmd.index('--write-info-json'), '--skip-download')
        r = run(cmd, timeout=600)
        info_files = list(work.glob('*.info.json'))
        if not info_files:
            rec['error'] = (r.stderr or r.stdout).strip()[-400:] or 'no info returned'
        else:
            info = json.loads(info_files[0].read_text())
            rec.update({
                'caption': info.get('description') or '',
                'uploader': info.get('uploader') or info.get('channel') or '',
                'uploader_id': info.get('uploader_id') or '',
                'upload_date': info.get('upload_date') or '',
                'duration': info.get('duration'),
                'like_count': info.get('like_count'),
                'title': info.get('title') or '',
            })
            video = next((p for p in work.glob('video.*') if p.suffix in ('.mp4', '.mov', '.webm', '.mkv')), None)
            if video and not args.skip_video:
                wav = work / 'audio.wav'
                run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(video), '-vn', '-ac', '1', '-ar', '16000', str(wav)])
                if wav.exists():
                    segs, inf = model.transcribe(str(wav), vad_filter=True)
                    rec['transcript'] = ' '.join(s.text.strip() for s in segs)
                    rec['language'] = inf.language
                dur = float(info.get('duration') or 30)
                step = max(2.0, dur / args.frames)
                run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(video), '-vf', f'fps=1/{step:.2f},scale=720:-1', str(work / 'frame_%02d.jpg')])
                rec['frames'] = sorted(str(p.relative_to(out)) for p in work.glob('frame_*.jpg'))
                for junk in (wav, video): junk.unlink(missing_ok=True)
            rec['ok'] = True
    except Exception as e:
        rec['error'] = str(e)[-400:]
    packet.write_text(json.dumps(rec, ensure_ascii=False, indent=1))
    manifest.append(rec)
    print(f'   {"ok" if rec["ok"] else "FAILED: " + rec.get("error", "")}  caption {len(rec.get("caption", ""))} chars, transcript {len(rec.get("transcript", "").split())} words', flush=True)
    time.sleep(2)

(out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
ok = sum(1 for r in manifest if r['ok'])
print(f'\n{ok}/{len(manifest)} links extracted → {out}')
