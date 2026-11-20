#!/usr/bin/env python3
"""Render docs/preview.svg (+ an optional PNG) of the ranking panel.

The panel itself is React inside DSH, so there is nothing to screenshot here.
This script draws the same geometry the stylesheet declares — the 20px gutter,
the `--dmv-cols` tracks, and the 34/28/32/46px bar heights — so the preview
cannot drift from the panel the way a hand-drawn mock would.

A row is two lines: the name with its pills, then the raw `提供方/模型ID`, which
used to be a tooltip on the channel chip and is now ordinary text.

Run: python tools/preview.py [out.png]
"""

import sys
from PIL import Image, ImageDraw, ImageFont

W = 1120
GUTTER = 20
CARD_X = 24
CARD_W = W - CARD_X * 2
CONTENT_X = CARD_X + GUTTER
CONTENT_W = CARD_W - GUTTER * 2
CONTENT_RIGHT = CONTENT_X + CONTENT_W

# --dmv-cols: 30px 46px minmax(0,1fr) 64px 64px 72px 42px minmax(92px,124px)
FIXED = [30, 62, None, 80, 80, 80, 42, 124]
GAP = 10
CARD_TOP = 20
SPLIT_H, TH_H, GROUP_H, ROW_H, HINT_H = 34, 28, 32, 46, 26
# What the demo search box contains: the preview marks this in the names.
SEARCH = 'Claude'

C = {
    'page': '#14161c',
    'card': '#1b1e26',
    'cardBorder': '#2a2f3a',
    'layer1': '#22252e',
    'rowLine': '#242832',
    'chip': '#272b36',
    'track': '#2b303c',
    'checkBorder': '#4a5163',
    'brand': '#6b7cff',
    'segTrack': '#20242d',
    'segActive': '#333a4a',
    'text': '#e6e9f0',
    'text2': '#b6becc',
    'text3': '#8b93a3',
    'caption': '#767e8e',
}

FONT_DIR = 'C:/Windows/Fonts/'
_cache = {}


def font(size, bold=False):
    key = (size, bold)
    if key not in _cache:
        _cache[key] = ImageFont.truetype(FONT_DIR + ('msyhbd.ttc' if bold else 'msyh.ttc'), int(round(size)))
    return _cache[key]


def text_width(s, size, bold=False):
    """Width estimate that works for SVG output too (no metric access there)."""
    wide, narrow = (size * 1.02, size * 0.64) if bold else (size, size * 0.56)
    return sum(wide if ord(ch) > 0x2000 else narrow for ch in str(s))


def esc(s):
    return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


class Canvas:
    """Draws to Pillow when an image is attached, and always records SVG."""

    def __init__(self, image=None):
        self.svg = []
        self.draw = ImageDraw.Draw(image) if image is not None else None

    def text(self, x, y, s, size=12, color=None, bold=False, anchor='start'):
        color = color or C['text']
        self.svg.append(
            f'  <text x="{x:.1f}" y="{y:.1f}" font-family="Segoe UI, Microsoft YaHei, sans-serif" '
            f'font-size="{size}" font-weight="{600 if bold else 400}" fill="{color}" '
            f'text-anchor="{anchor}">{esc(s)}</text>'
        )
        if self.draw is not None:
            anchor_letter = {'start': 'l', 'middle': 'm', 'end': 'r'}[anchor]
            self.draw.text((x, y), s, font=font(size, bold), fill=color, anchor=anchor_letter + 's')

    def rect(self, x, y, w, h, fill=None, stroke=None, rx=0, width=1, opacity=None):
        stroke_attr = '' if stroke is None else f' stroke="{stroke}" stroke-width="{width}"'
        opacity_attr = '' if opacity is None else f' opacity="{opacity}"'
        self.svg.append(
            f'  <rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" '
            f'fill="{fill or "none"}"{stroke_attr}{opacity_attr} />'
        )
        if self.draw is not None:
            self.draw.rounded_rectangle(
                [x, y, x + w - 1, y + h - 1], radius=rx, fill=fill, outline=stroke, width=width
            )

    def line(self, x1, y1, x2, y2, color=None, width=1, opacity=None):
        color = color or C['rowLine']
        opacity_attr = '' if opacity is None else f' opacity="{opacity}"'
        self.svg.append(
            f'  <line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{color}" '
            f'stroke-width="{width}"{opacity_attr} />'
        )
        if self.draw is not None:
            self.draw.line((x1, y1, x2, y2), fill=color, width=width)


def columns():
    fixed = sum(c for c in FIXED if c is not None)
    flex = CONTENT_W - fixed - GAP * (len(FIXED) - 1)
    spans, x = [], CONTENT_X
    for width in FIXED:
        width = flex if width is None else width
        spans.append((x, width))
        x += width + GAP
    return spans


CHECK, RANK, NAME, PRICE_IN, PRICE_OUT, BLEND, IQ, VALUE = columns()


def money(value):
    if value is None:
        return '—'
    if value >= 1:
        return f'{value:.2f}'
    if value >= 0.01:
        return f'{value:.3f}'
    return f'{value:g}'


# rank, name, otherRankPill, key (提供方/模型ID), iqEstimated, input, output, blended, iq, valueRatio, pinned, kind
MERGED = [
    (1, 'Claude Haiku 5.5', '已接入第 1', 'commandcode/anthropic/claude-haiku-5.5 ×2', False, 0.10, 0.50, 0.17, '36', 2.9, True, 'channel'),
    (2, 'Nova Micro', '', 'amazon/nova-micro', False, 0.035, 0.14, 0.06, '5.9', 3.9, False, 'market'),
    (3, 'GPT-6 Luna', '已接入第 2', 'commandcode/openai/gpt-6-luna', False, 0.10, 0.50, 0.17, '28', 2.3, True, 'channel'),
    (4, 'Solar Pro 4', '', 'upstage/solar-pro-4', False, 0.30, 1.20, 0.44, '28.2', 2.6, False, 'market'),
]
COMMAND = [
    (1, 'Claude Haiku 5.5', '全部第 1', 'commandcode/anthropic/claude-haiku-5.5 ×2', False, 0.10, 0.50, 0.17, '36', 4.96),
    (2, 'GPT-6 Luna', '全部第 3', 'commandcode/openai/gpt-6-luna', False, 0.10, 0.50, 0.17, '28', 3.86),
]
COMATE = [
    (1, 'GLM-5.3-Flash', '全部第 5', 'comate/proxy_4c81d2', False, 0.15, 0.50, 0.19, '28', 3.33),
    (2, 'DeepSeek-V4.1-Flash', '全部第 6', 'comate/proxy_9f2c41ab7e ×2', True, 0.30, 1.20, 0.41, '33', 1.82),
]


def blend(top, bottom, alpha):
    """color-mix(in srgb, top alpha, transparent) painted over `bottom`."""
    t = [int(top[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(bottom[i:i + 2], 16) for i in (1, 3, 5)]
    mixed = [round(t[i] * alpha + b[i] * (1 - alpha)) for i in range(3)]
    return '#%02x%02x%02x' % tuple(mixed)


def checkbox(cv, x, y, checked):
    if checked:
        # filled with the primary label colour, check punched out in the surface
        cv.rect(x, y, 14, 14, fill=C['text'], rx=4)
        cv.text(x + 7, y + 11, '✓', 10, C['card'], anchor='middle')
    else:
        cv.rect(x, y, 14, 14, stroke=C['checkBorder'], rx=4)


def badge(cv, x, cy, rank):
    # brand only ever tints: a light brand would otherwise paint white on white
    fill, color, stroke = C['chip'], C['text2'], None
    if rank == 1:
        fill, color = blend(C['brand'], C['card'], 0.24), C['text']
        stroke = blend(C['brand'], C['card'], 0.55)
    elif rank in (2, 3):
        fill = blend(C['brand'], C['card'], 0.12)
    cv.rect(x, cy - 10, 28, 20, fill=fill, stroke=stroke, rx=6)
    cv.text(x + 14, cy + 4, f'#{rank}', 11, color, bold=True, anchor='middle')


def row(cv, y, data, kind='channel'):
    rank, name, other_rank, key, estimated, price_in, price_out, blended, iq, ratio, pinned = data
    cy = y + ROW_H / 2
    name_cy = cy - 6          # first line: the name and its pills
    key_cy = cy + 11          # second line: 提供方/模型ID, plain text
    cell_right = NAME[0] + NAME[1] - 2
    if kind == 'channel':
        checkbox(cv, CHECK[0], name_cy - 7, pinned)
    badge(cv, RANK[0], name_cy, rank)

    x = NAME[0]
    # the pills take their width first, then the name gets what is left (same as
    # the flex order in the stylesheet: the name shrinks, the pills never push out)
    trailing = 6 + 24  # gap + copy icon
    trailing += 21 if estimated else 0
    trailing += (text_width(other_rank, 10, bold=True) + 18) if other_rank else 0
    trailing += 40 if kind == 'market' else 0
    name_budget = max(40, cell_right - x - trailing)
    name_w = min(text_width(name, 13), name_budget)
    shown = name if name_w >= text_width(name, 13) else name[:max(3, int(len(name) * name_w / text_width(name, 13)))] + '…'
    # the demo search term is marked, never filtered: only the text is highlighted
    if SEARCH and SEARCH.lower() in shown.lower():
        offset = shown.lower().index(SEARCH.lower())
        mark_x = x + text_width(shown[:offset], 13)
        mark_w = text_width(shown[offset:offset + len(SEARCH)], 13)
        cv.rect(mark_x - 1, name_cy - 8, mark_w + 2, 16, fill=blend('#e2a03f', C['card'], 0.38), rx=3)
    cv.text(x, name_cy + 4.5, shown, 13, C['text'])
    # copy icon: two offset squares, same as the button's CSS (no font glyph)
    icon_x, icon_y = x + name_w + 6, name_cy - 4
    cv.rect(icon_x + 3, icon_y - 3, 8, 8, fill=C['card'], stroke=C['text3'], rx=2)
    cv.rect(icon_x, icon_y, 8, 8, fill=C['card'], stroke=C['text3'], rx=2)
    x += name_w + 24
    if estimated:
        cv.rect(x, name_cy - 7.5, 15, 15, fill=C['chip'], rx=4)
        cv.text(x + 7.5, name_cy + 3, '≈', 10, C['text3'], anchor='middle')
        x += 21
    if other_rank:
        # the second numbering, always visible instead of hover-only
        pill_w = text_width(other_rank, 10, bold=True) + 12
        cv.rect(x, name_cy - 7.5, pill_w, 15, fill=C['chip'], rx=8)
        cv.text(x + 6, name_cy + 3, other_rank, 10, C['text2'])
        x += pill_w + 6
    if kind == 'market':
        # outlined pill: a market model has no channel to pin or switch to
        cv.rect(x, name_cy - 7.5, 34, 15, stroke=C['cardBorder'], rx=3)
        cv.text(x + 5, name_cy + 3, '未接入', 10, C['text3'])
        x += 40

    # the id line: what used to be the channel chip's tooltip, now on screen
    key_w = cell_right - NAME[0]
    shown_key = key
    if text_width(key, 10.5) > key_w:
        keep = max(4, int(len(key) * key_w / text_width(key, 10.5)))
        shown_key = key[:keep] + '…'
    cv.text(NAME[0], key_cy + 4, shown_key, 10.5, C['caption'])

    # input/output are context; the blended price and the ratio carry the answer
    for span, value in ((PRICE_IN, price_in), (PRICE_OUT, price_out)):
        cv.text(span[0] + span[1], cy + 4.5, money(value), 12, C['text3'], anchor='end')
    cv.text(BLEND[0] + BLEND[1], cy + 4.5, money(blended), 12, C['text'], bold=True, anchor='end')
    cv.text(IQ[0] + IQ[1], cy + 4.5, iq, 12, C['text2'], anchor='end')

    right, width = VALUE[0] + VALUE[1], VALUE[1]
    bar_w = min(70, width - 32 - 7)
    bar_x = right - 32 - 7 - bar_w
    cv.rect(bar_x, cy - 2, bar_w, 4, fill=C['track'], rx=2)
    cv.rect(bar_x, cy - 2, max(4.0, bar_w * min(1.0, ratio / 4)), 4,
            fill=blend(C['brand'], C['track'], 0.72), rx=2)
    cv.text(right, cy + 4, f'×{ratio}', 11, C['text3'], anchor='end')

    cv.line(CARD_X, y + ROW_H - 0.5, CARD_X + CARD_W, y + ROW_H - 0.5, C['rowLine'])
    return y + ROW_H


def split(cv, y, title, scope=None):
    cv.rect(CARD_X, y, CARD_W, SPLIT_H, fill=C['layer1'])
    cv.text(CONTENT_X, y + 21.5, title, 12, C['text2'], bold=True)
    left = CONTENT_X + text_width(title, 12, bold=True) + 14
    right = CONTENT_RIGHT
    widths = []
    if scope is not None:
        widths = [text_width(label, 11, bold=True) + 16 for label, _ in scope]
        right = CONTENT_RIGHT - (sum(widths) + 2 * (len(widths) - 1)) - 12
    cv.line(left, y + 17, max(left, right), y + 17, C['text3'], opacity=0.16)
    if scope is not None:
        cursor = CONTENT_RIGHT - (sum(widths) + 2 * (len(widths) - 1))
        for (label, active), width in zip(scope, widths):
            if active:
                cv.rect(cursor, y + 7, width, 20, fill=C['segActive'], rx=10)
            cv.text(cursor + width / 2, y + 21, label, 11, C['text'] if active else C['text3'],
                    bold=bool(active), anchor='middle')
            cursor += width + 2
    cv.line(CARD_X, y + SPLIT_H - 0.5, CARD_X + CARD_W, y + SPLIT_H - 0.5, C['cardBorder'])
    return y + SPLIT_H


def table_header(cv, y, rank_label='全部排名'):
    cv.rect(CARD_X, y, CARD_W, TH_H, fill=C['card'])
    base = y + TH_H / 2 + 3.5
    cv.text(CHECK[0], base, '菜单', 10.5, C['caption'], bold=True)
    cv.text(RANK[0], base, rank_label, 10.5, C['caption'], bold=True)
    cv.text(NAME[0], base, '模型', 10.5, C['caption'], bold=True)
    for span, label in ((PRICE_IN, '输入'), (PRICE_OUT, '输出'), (BLEND, '加权')):
        cv.text(span[0] + span[1], base, f'{label} $/百万', 10.5, C['caption'], bold=True, anchor='end')
    cv.text(IQ[0] + IQ[1], base, '智力', 10.5, C['caption'], bold=True, anchor='end')
    cv.text(VALUE[0] + VALUE[1], base, '性价比', 10.5, C['caption'], bold=True, anchor='end')
    cv.line(CARD_X, y + TH_H - 0.5, CARD_X + CARD_W, y + TH_H - 0.5, C['cardBorder'])
    return y + TH_H


def group_head(cv, y, name, meta, best):
    cv.rect(CARD_X, y, CARD_W, GROUP_H, fill=C['card'])
    base = y + GROUP_H / 2 + 4
    cv.text(CONTENT_X, base, name, 12, C['text2'], bold=True)
    cv.text(CONTENT_X + text_width(name, 12, bold=True) + 10, base, meta, 11, C['caption'])
    label = f'组内最佳 {best}'
    chip_w = text_width(label, 11) + 16
    cv.rect(CONTENT_RIGHT - chip_w, y + 6, chip_w, 20, fill=blend(C['brand'], C['card'], 0.16), rx=10)
    cv.text(CONTENT_RIGHT - chip_w / 2, base, label, 11, C['text'], bold=True, anchor='middle')
    cv.line(CARD_X, y + GROUP_H - 0.5, CARD_X + CARD_W, y + GROUP_H - 0.5, C['cardBorder'])
    return y + GROUP_H


def segmented(cv, right, y, labels, active):
    widths = [text_width(label, 12) + 20 for label in labels]
    total = sum(widths) + 4
    x = right - total
    cv.rect(x, y, total, 26, fill=C['segTrack'], stroke=C['cardBorder'], rx=13)
    cursor = x + 2
    for index, width in enumerate(widths):
        if index == active:
            cv.rect(cursor, y + 2, width, 22, fill=C['segActive'], rx=11)
        cv.text(cursor + width / 2, y + 17.5, labels[index], 12,
                C['text'] if index == active else C['text3'],
                bold=index == active, anchor='middle')
        cursor += width
    return total


def ghost(cv, right, y, label):
    width = text_width(label, 12) + 22
    cv.rect(right - width, y, width, 26, stroke=C['cardBorder'], rx=13)
    cv.text(right - width / 2, y + 17.5, label, 12, C['text2'], anchor='middle')
    return width


def build(cv):
    card_top = CARD_TOP
    title_y = card_top + 36
    cv.text(CONTENT_X, title_y, '模型性价比排行', 15, C['text'], bold=True)
    cv.text(CONTENT_X, title_y + 21, '单价 × 智力 → 性价比，帮你决定这一轮用哪个模型', 12, C['text3'])

    # controls: two segmented tracks up top, the actions on the second line
    cursor = CONTENT_RIGHT
    cursor -= ghost(cv, cursor, title_y - 12, '清空选择') + 8
    selected_w = text_width('已选 1', 11) + 18
    cv.rect(cursor - selected_w, title_y - 12, selected_w, 26, fill=C['chip'], rx=13)
    cv.text(cursor - selected_w / 2, title_y + 5.5, '已选 1', 11, C['text2'], bold=True, anchor='middle')
    cursor -= selected_w + 8
    cursor -= ghost(cv, cursor, title_y - 12, '刷新') + 8
    cursor -= segmented(cv, cursor, title_y - 12, ['USD', 'CNY'], 0) + 8
    segmented(cv, cursor, title_y - 12, ['性价比', '单价', '智力'], 0)

    meta_y = title_y + 47
    cv.text(CONTENT_X, meta_y, '120 个模型 · 权重 3:1 · 数据时间 2026-11-17（快照） · Artificial Analysis v5.0.1', 11, C['caption'])
    cv.text(CONTENT_X, meta_y + 17, '已隐藏 11 个免费模型 · 26 个无智力评分 · 31 个无价格', 11, C['caption'])
    cv.rect(CONTENT_X, meta_y + 25, 2, 16, fill=C['brand'], rx=1)
    cv.text(CONTENT_X + 9, meta_y + 37, '勾选后会加到输入框菜单里（推荐固定在顶部，勾选的全部显示）', 11, C['caption'])

    # the name search: a finding aid, so the box reports matches and filters nothing
    search_y = meta_y + 46
    cv.rect(CONTENT_X, search_y, 280, 26, fill=C['chip'], stroke=C['cardBorder'], rx=8)
    cv.text(CONTENT_X + 10, search_y + 18, SEARCH, 12, C['text'])
    cv.text(CONTENT_X + 266, search_y + 18, '×', 13, C['text3'], anchor='end')
    cv.text(CONTENT_X + 292, search_y + 18, '匹配 1 行', 11, C['caption'])
    head_bottom = search_y + 26 + 12
    cv.line(CARD_X, head_bottom, CARD_X + CARD_W, head_bottom, C['cardBorder'])

    y = head_bottom + 1
    # Block 1: connected channels and market models in one table, one numbering,
    # with the scope chips on its title bar.
    y = split(cv, y, '全部模型（120）', [('全部', 1), ('已接入', 0), ('未接入', 0)])
    cv.rect(CARD_X, y, CARD_W, HINT_H, fill=C['card'])
    cv.text(CONTENT_X, y + 17.5, '未接入的模型价格与智力都已核实；接入后会自动移到「按提供方分组排名」里。', 11, C['caption'])
    cv.line(CARD_X, y + HINT_H - 0.5, CARD_X + CARD_W, y + HINT_H - 0.5, C['cardBorder'])
    y += HINT_H
    y = table_header(cv, y, '全部排名')
    for data in MERGED:
        y = row(cv, y, data[:11], data[11])

    y += 14
    y = split(cv, y, '按提供方分组排名')
    y = table_header(cv, y, '组内排名')
    y = group_head(cv, y, 'Command Code', '22 个模型', '×4.96')
    for data in COMMAND:
        y = row(cv, y, data + (True,))
    y = group_head(cv, y, 'Comate 私有云 Agent', '5 个模型', '×3.33')
    for data in COMATE:
        y = row(cv, y, data + (False,))

    foot_y = y + 16
    cv.line(CARD_X, foot_y, CARD_X + CARD_W, foot_y, C['cardBorder'])
    cv.text(CONTENT_X, foot_y + 22, '数据来源   Artificial Analysis   ·   openrouter.ai   ·   artificialanalysis.ai', 11, C['caption'])
    return int(foot_y + 52)


def main():
    dry = Canvas()
    height = build(dry)
    svg = '\n'.join(
        [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{height}" '
            f'viewBox="0 0 {W} {height}" role="img" '
            f'aria-label="模型性价比排行面板预览：总榜、按提供方分组榜、市面模型三块，表头与分组头吸顶">',
            f'  <rect width="{W}" height="{height}" fill="{C["page"]}"/>',
            f'  <rect x="{CARD_X}" y="{CARD_TOP}" width="{CARD_W}" height="{height - CARD_TOP * 2}" '
            f'rx="14" fill="{C["card"]}" stroke="{C["cardBorder"]}"/>',
            ''.join(dry.svg),
            '</svg>',
            '',
        ]
    )
    with open('docs/preview.svg', 'w', encoding='utf-8') as handle:
        handle.write(svg)
    print(f'docs/preview.svg  {W}x{height}')

    if len(sys.argv) > 1:
        image = Image.new('RGB', (W, height), C['page'])
        ImageDraw.Draw(image).rounded_rectangle(
            [CARD_X, CARD_TOP, CARD_X + CARD_W - 1, height - CARD_TOP],
            radius=14, fill=C['card'], outline=C['cardBorder'],
        )
        build(Canvas(image))
        image.save(sys.argv[1])
        print(f'{sys.argv[1]}  {W}x{height}')


if __name__ == '__main__':
    main()
