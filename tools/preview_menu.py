#!/usr/bin/env python3
"""Render assets/screenshot-menu.png: the composer model menu (Top 3 + pins).

The menu is React inside DSH, so, like tools/preview.py, this draws the same
geometry the stylesheet declares (.dmv-menu-* rules in client.js): a 156px
scroll box, 32px rows, a star-marked pin, and the "see full ranking" footer.

A row is the rank, the model name and its provider — nothing else, and no
tooltips: price and IQ live in the ranking panel, which the footer opens.

Run: python tools/preview_menu.py [out.png]
"""

import sys
from PIL import Image, ImageDraw, ImageFont

W, H = 460, 248
BG = '#1b1d22'
HEAD_BG = '#1b1d22'
ROW_HOVER = '#262a33'
border = '#2a2f3a'
text = '#e6e9f0'
text2 = '#b6becc'
text3 = '#8b93a3'
caption = '#767e8e'
brand = '#6b7cff'
star = '#e2a03f'
chip = '#272b36'

FONT_DIR = 'C:/Windows/Fonts/'
_cache = {}


def font(size, bold=False):
    key = (size, bold)
    if key not in _cache:
        _cache[key] = ImageFont.truetype(FONT_DIR + ('msyhbd.ttc' if bold else 'msyh.ttc'), int(round(size)))
    return _cache[key]


def txt(d, x, y, s, size=12, color=text, bold=False, anchor='ls'):
    d.text((x, y), s, font=font(size, bold), fill=color, anchor=anchor)


def text_width(s, size):
    """Width estimate that matches the SVG/PNG split used by tools/preview.py."""
    return sum(size if ord(ch) > 0x2000 else size * 0.56 for ch in str(s))


def row(d, y, rank, starred, name, provider):
    cy = y + ROW_H // 2
    d.rounded_rectangle([12, y, W - 12, y + ROW_H - 2], radius=6, fill=ROW_HOVER)
    txt(d, 24, cy + 1, '★' if starred else f'#{rank}', 11, star if starred else brand, bold=True)
    txt(d, 60, cy + 1, name, 13, text)
    # the provider chip is the only trailing content: it says which channel the
    # switch lands on, so it is on screen rather than in a tooltip
    chip_w = text_width(provider, 10) + 12
    chip_x = W - 26 - chip_w
    d.rounded_rectangle([chip_x, cy - 7, chip_x + chip_w, cy + 8], radius=9, fill=chip)
    txt(d, chip_x + 6, cy + 3, provider, 10, text3)


ROW_H = 32
MENU_TOP = 12
LIST_TOP = MENU_TOP + 34


def main():
    image = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(image)
    d.rounded_rectangle([4, 4, W - 4, H - 4], radius=14, fill=HEAD_BG, outline=border)

    txt(d, 20, MENU_TOP + 13, '★ 性价比 Top 3 + 已勾选 2', 11, text3, bold=True)
    txt(d, W - 20, MENU_TOP + 13, '共 5 行 · 可滚动', 11, caption, anchor='rs')

    rows = [
        (1, False, 'Claude Haiku 5.5', 'commandcode ×2'),
        (2, False, 'GPT-6 Luna', 'commandcode'),
        (3, False, 'Qwen 3.8 Flash', 'commandcode'),
        (0, True, 'DeepSeek V4.1 Flash', 'comate ×2'),
        (0, True, 'GLM-5.3 Flash', 'comate'),
    ]
    for index, (rank, starred, name, provider) in enumerate(rows):
        row(d, LIST_TOP + index * ROW_H, rank, starred, name, provider)

    foot_y = LIST_TOP + len(rows) * ROW_H + 6
    d.line([12, foot_y, W - 12, foot_y], fill=border)
    txt(d, 20, foot_y + 16, '查看完整排行', 12, text3)

    out = sys.argv[1] if len(sys.argv) > 1 else 'assets/screenshot-menu.png'
    image.save(out)
    print(f'{out}  {W}x{H}')


if __name__ == '__main__':
    main()
