#!/usr/bin/env python3
"""
Apply review decisions to the game's public assets.

Input: a JSON file with the review page's `decisions` documents
(list of {item, decision, choice, note}). Only `approve` decisions are applied.

  sfx:<id>   review/sfx/<id>_<choice>.mp3       -> public/sfx/<id>.mp3
  img:bg_bathroom  review/images/bg_bathroom_<choice>.jpg -> public/img/bg.jpg (max 1920 wide)
  img:og_image     review/images/og_image_<choice>.jpg    -> public/img/og.jpg (1200x630 cover crop)
  img:app_icon     review/images/app_icon_<choice>.jpg    -> public/icons/icon-source.png (corners trimmed),
                   then run scripts/rasterize-icons.cjs on it
  vline:<lang>:<id>  review/voice-r2/<lang>/<id>.mp3 -> public/audio/<lang>/<id>.mp3
  voice      records the chosen voice in assets/voice.json (lines are generated in round 2)

Every applied item is recorded in assets/manifest.json with status "approved".
"""
import json, shutil, subprocess, sys, datetime
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
REVIEW = ROOT / 'review'
MANIFEST = ROOT / 'assets' / 'manifest.json'

VOICE_IDS = {
    'jessica': 'cgSgspJ2msm6clMCkdW9', 'laura': 'FGY2WhTYpPnrIDTdsKH5', 'bella': 'hpp4J3VqNfWAUOO0d1Us',
    'itai': 'JIxTgeeS5w0UQyBxEnrl', 'liam': 'TX3LPaxmHKxFdv7VOQHJ',
}


def cover(im: Image.Image, w: int, h: int) -> Image.Image:
    s = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    l, t = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((l, t, l + w, t + h))


def main(path: str):
    decisions = json.loads(Path(path).read_text())
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {'items': {}}
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    applied = []
    for d in decisions:
        if d.get('decision') != 'approve':
            continue
        item, choice = d['item'], d.get('choice', '')
        kind, _, ident = item.partition(':')
        src = None
        if kind == 'sfx':
            src = REVIEW / 'sfx' / f'{ident}_{choice}.mp3'
            dst = ROOT / 'public' / 'sfx' / f'{ident}.mp3'
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)
        elif item == 'img:bg_bathroom':
            src = REVIEW / 'images' / f'bg_bathroom_{choice}.jpg'
            im = Image.open(src).convert('RGB')
            im.thumbnail((1920, 1920))
            dst = ROOT / 'public' / 'img' / 'bg.jpg'
            dst.parent.mkdir(parents=True, exist_ok=True)
            im.save(dst, quality=82, optimize=True, progressive=True)
        elif item == 'img:og_image':
            src = REVIEW / 'images' / f'og_image_{choice}.jpg'
            dst = ROOT / 'public' / 'img' / 'og.jpg'
            dst.parent.mkdir(parents=True, exist_ok=True)
            cover(Image.open(src).convert('RGB'), 1200, 630).save(dst, quality=85, optimize=True)
        elif item == 'img:app_icon':
            src = REVIEW / 'images' / f'app_icon_{choice}.jpg'
            im = Image.open(src).convert('RGB')
            trim = round(im.width * 0.075)  # remove drawn rounded corners
            im = im.crop((trim, trim, im.width - trim, im.height - trim)).resize((1024, 1024), Image.LANCZOS)
            dst = ROOT / 'assets' / 'icon-source.png'
            im.save(dst)
            subprocess.run(['node', str(ROOT / 'scripts' / 'rasterize-icons.cjs'), str(dst)], check=True)
        elif kind in ('vline', 'vline2'):
            # narrator line: vline:<lang>:<lineId> (recorded per line) / vline2 (cut from earlier sample reels)
            lang, _, line_id = ident.partition(':')
            src = REVIEW / ('voice-r2' if kind == 'vline' else 'voice-r2b') / lang / f'{line_id}.mp3'
            dst = ROOT / 'public' / 'audio' / lang / f'{line_id}.mp3'
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)
        elif item == 'voice':
            dst = ROOT / 'assets' / 'voice.json'
            dst.write_text(json.dumps({'name': choice, 'voiceId': VOICE_IDS[choice], 'model': 'eleven_v3'}, indent=2) + '\n')
        else:
            continue
        manifest['items'][item] = {
            **manifest['items'].get(item, {}),
            'status': 'approved', 'choice': choice, 'source': str(src.relative_to(ROOT)) if src else None,
            'output': str(dst.relative_to(ROOT)), 'note': d.get('note', ''), 'approvedAt': now,
        }
        applied.append(f'{item} -> {choice}')
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    print('\n'.join(applied) or 'nothing to apply')


if __name__ == '__main__':
    main(sys.argv[1])
