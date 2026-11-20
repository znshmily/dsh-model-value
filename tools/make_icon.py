#!/usr/bin/env python3
"""Render assets/icon-180.png from the same geometry as icon.svg.

The plugin market draws an entry's icon at ~96px and only accepts raster images
hosted on GitHub, so the repo ships a PNG next to the SVG the Host uses. Both
come from the same numbers: background rounded rect (2,2,60,60) rx14 with the
blue→violet diagonal gradient, three opacity-stepped bars, the arrow, and the
coin with a $ on it.

Run: python tools/make_icon.py [out.png]
"""

import sys

from PIL import Image, ImageDraw, ImageFont

SIZE = 180
SS = 4  # supersample, then downsample: the SVG would be smooth, so this is too
S = SIZE * SS
UNIT = S / 64.0

BG_FROM = (0x3B, 0x82, 0xF6)
BG_TO = (0x8B, 0x5C, 0xF6)
FONT_DIR = 'C:/Windows/Fonts/'


def px(value):
    return value * UNIT


def gradient():
    """Linear gradient along (0,0)→(1,1): colour depends on (x+y)/2S."""
    image = Image.new('RGB', (S, S))
    draw = ImageDraw.Draw(image)
    for c in range(2 * S):
        t = c / (2 * S)
        colour = tuple(round(BG_FROM[i] + (BG_TO[i] - BG_FROM[i]) * t) for i in range(3))
        draw.line([(c, 0), (0, c)], fill=colour)
    return image


def main():
    canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))

    # the rounded square: gradient clipped by a rounded-rect mask
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [px(2), px(2), px(62), px(62)], radius=px(14), fill=255
    )
    canvas.paste(gradient(), (0, 0), mask)

    draw = ImageDraw.Draw(canvas)
    # three bars, each a step brighter
    for x, y, h, alpha in ((13, 33, 17, 140), (24, 26, 24, 191), (35, 19, 31, 230)):
        draw.rounded_rectangle(
            [px(x), px(y), px(x + 7), px(y + h)], radius=px(2), fill=(255, 255, 255, alpha)
        )

    # arrow: shaft, then the V of the head, both with round caps
    draw.line([(px(48), px(14)), (px(48), px(36))], fill=(255, 255, 255, 255), width=round(px(4)))
    draw.line(
        [(px(41.5), px(24.5)), (px(48), px(31)), (px(54.5), px(24.5))],
        fill=(255, 255, 255, 255), width=round(px(4)), joint='curve',
    )
    for x, y in ((48, 14), (41.5, 24.5), (54.5, 24.5)):
        r = px(2)
        draw.ellipse([px(x) - r, px(y) - r, px(x) + r, px(y) + r], fill=(255, 255, 255, 255))

    # the coin, with the same $ in the background colour
    draw.ellipse([px(40.5), px(32.5), px(55.5), px(47.5)], fill=(255, 255, 255, 255))
    font = ImageFont.truetype(FONT_DIR + 'msyhbd.ttc', round(px(13)))
    draw.text((px(48), px(40.5)), '$', font=font, fill=(0x69, 0x70, 0xF2, 255), anchor='mm')

    image = canvas.resize((SIZE, SIZE), Image.LANCZOS)
    out = sys.argv[1] if len(sys.argv) > 1 else 'assets/icon-180.png'
    image.save(out)
    print(f'{out}  {SIZE}x{SIZE}')


if __name__ == '__main__':
    main()
