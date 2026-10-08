"""Derive Android launcher assets from the user-selected AI VIBEX icon.

Run from any directory with Python 3, Pillow and NumPy installed.
The source artwork is retained unchanged in assets/branding. Only launcher-mask
preparation, foreground separation and density resizing are performed here.
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets/branding/vibex-ai-icon.png"
RES = ROOT / "android/app/src/main/res"
pixels = np.array(Image.open(SOURCE).convert("RGB").resize((1024, 1024)), dtype=float)

# Reconstruct the existing purple gradient without the generated white outer corners.
left = np.median(pixels[:, 200:220], axis=1)[:, None, :]
right = np.median(pixels[:, 804:824], axis=1)[:, None, :]
x = np.linspace(0, 1, 1024)[None, :, None]
background = np.clip(left * (1-x) + right * x, 0, 255)

# The selected mark is nearly achromatic, over a strongly purple background.
# Its original shaded ribbons and musical negative-space detail remain intact.
difference = np.maximum(1, background[:, :, 2] - background[:, :, 1])
alpha = np.clip(1 - (pixels[:, :, 2] - pixels[:, :, 1]) / difference, 0, 1)
region = np.zeros_like(alpha)
region[300:750, 235:790] = 1
alpha *= region
alpha[alpha < .12] = 0
alpha[alpha > .98] = 1
rgb = np.clip((pixels - background * (1-alpha[:, :, None])) / np.maximum(alpha[:, :, None], .001), 0, 255)
foreground = Image.fromarray(np.dstack([rgb, alpha*255]).astype('uint8'), 'RGBA')
back = Image.fromarray(background.astype('uint8'), 'RGB').convert('RGBA')
combined = Image.alpha_composite(back, foreground)
mono = Image.new('RGBA', foreground.size, 'white')
mono.putalpha(foreground.getchannel('A'))

for density, size in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
    folder = RES / f'mipmap-{density}'
    folder.mkdir(parents=True, exist_ok=True)
    adaptive_size = round(size * 108 / 48)
    foreground.resize((adaptive_size, adaptive_size), Image.Resampling.LANCZOS).save(folder/'ic_launcher_foreground.png')
    back.resize((adaptive_size, adaptive_size), Image.Resampling.LANCZOS).save(folder/'ic_launcher_background.png')
    mono.resize((adaptive_size, adaptive_size), Image.Resampling.LANCZOS).save(folder/'ic_launcher_monochrome.png')
    # Legacy icons use the same central viewport as an adaptive icon's 72dp mask.
    tile = combined.crop((171,171,853,853))
    for name, circular in [('ic_launcher',False),('ic_launcher_round',True)]:
        mask = Image.new('L',tile.size)
        draw = ImageDraw.Draw(mask)
        if circular: draw.ellipse((0,0,681,681), fill=255)
        else: draw.rounded_rectangle((0,0,681,681), radius=140, fill=255)
        icon = tile.copy()
        icon.putalpha(mask)
        icon.resize((size,size),Image.Resampling.LANCZOS).save(folder/(name+'.png'))

for api in [26,33]:
    folder=RES/f'mipmap-anydpi-v{api}'
    folder.mkdir(parents=True,exist_ok=True)
    monochrome='    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n' if api>=33 else ''
    xml=('<?xml version="1.0" encoding="utf-8"?>\n'
         '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
         '    <background android:drawable="@mipmap/ic_launcher_background"/>\n'
         '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'+monochrome+'</adaptive-icon>\n')
    for name in ['ic_launcher','ic_launcher_round']:
        (folder/(name+'.xml')).write_text(xml)

print('Generated legacy, adaptive and Android 13+ monochrome launcher assets at all five densities.')
