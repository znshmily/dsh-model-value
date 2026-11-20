/**
 * dsh-model-value — client half.
 *
 * Two surfaces, all reading the same Host-built payload
 * (`/dsh-model-value/api/rank`) so the ranking arithmetic lives in exactly one
 * place:
 *
 *   conversation.input.model.options  top-3 value picks inside the model menu,
 *                                     plus any pinned model; one click switches
 *                                     the session's model, and the last row
 *                                     opens the full table;
 *   main                              the full sortable ranking table, where a
 *                                     checkbox pins a model into that menu.
 *
 * No Harness client package is required: plain React + `--dsw-alias-*` tokens.
 */

window.__ModuleLoader__.load({
  id: 'dsh-model-value',
  factory(require) {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement

    const NS = 'modelValue'
    const PANEL_ID = 'model-value-ranking'
    const ROUTE = '/dsh-model-value/api/rank'
    const SELECT_PATH = '/dsh-model-value/api/select'
    const PINS_PATH = '/dsh-model-value/api/pins'
    const inject = ['slots', 'locale']
    /** Recommendations the menu shows when nothing is pinned. */
    const TOP_ROWS = 3
    /** Rows that fit in the menu's 152px list box; more than this scrolls. */
    const VISIBLE_ROWS = 4

    const STRINGS = {
      zh: {
        'title': '模型性价比',
        'panel.title': '模型性价比排行',
        'panel.subtitle': '单价 × 智力 → 性价比，帮你决定这一轮用哪个模型',
        'col.rankAll': '全部排名',
        'col.rankGroup': '组内排名',
        'col.model': '模型',
        'col.input': '输入',
        'col.output': '输出',
        'col.blended': '加权',
        'col.iq': '智力',
        'col.value': '性价比',
        'sort.label': '排序',
        'sort.value': '性价比',
        'sort.price': '单价',
        'sort.iq': '智力',
        'currency.label': '货币',
        'refresh': '刷新',
        'refreshing': '正在刷新…',
        'action.switching': '切换中…',
        'menu.top': '★ 性价比 Top 3',
        'menu.pinsTitle': '★ 性价比 Top 3 + 已勾选 {n}',
        'menu.more': '查看完整排行',
        'menu.locked': '当前会话不可切换模型',
        'menu.scrollHint': '共 {n} 行 · 可滚动',
        'col.pin': '菜单',
        'panel.selected': '已选',
        'action.clearSelected': '清空选择',
        'pin.title': '固定到输入框菜单顶部',
        'pin.hint': '勾选后会加到输入框菜单里（推荐固定在顶部，勾选的全部显示）',
        'missing.iq': '智力未收录',
        'meta.asOf': '数据时间',
        'meta.sources': '数据来源',
        'meta.count': '{n} 个模型',
        'meta.weights': '权重 {w}',
        'meta.hidden': '已隐藏 {free} 个免费模型 · {unscored} 个无智力评分 · {unpriced} 个无价格',
        'block.all': '全部模型（{n}）',
        'block.connected': '已接入模型（{n}）',
        'block.marketOnly': '未接入模型（{n}）',
        'block.grouped': '按提供方分组排名',
        'scope.label': '范围',
        'scope.all': '全部',
        'scope.connected': '已接入',
        'scope.unconnected': '未接入',
        'badge.market': '未接入',
        'group.providerMeta': '{n} 个模型',
        'group.best': '组内最佳 {x}',
        'market.hint': '未接入的模型价格与智力都已核实；接入后会自动移到「按提供方分组排名」里。',
        'market.hintMore': '另有 {n} 个只有价格、尚无公开智力分，暂不参与排名。',
        'price.estimated': '价格沿用同权重的基础档（服务档未单独定价）',
        'estimate.title': '这一行有推算值，悬停看具体来源',
        'rank.all': '全部第 {n}',
        'rank.connected': '已接入第 {n}',
        'search.placeholder': '搜索模型名（只高亮，不过滤）',
        'search.clear': '清空搜索',
        'search.matches': '匹配 {n} 行',
        'copy.name': '复制模型名',
        'copy.done': '已复制',
        'empty.title': '还没有价格数据',
        'empty.hint': '在插件设置里粘贴价格与智力 JSON，或打开在线价格源后刷新。',
        'error.title': '排行接口不可用',
        'error.retry': '重试',
        'error.writerHeld': '另一个 DSH 实例正在使用该会话',
        'error.remote': '模型切换服务未就绪，请确认插件已在终端启用',
        'error.switchFailed': '切换失败：{message}',
        'warn.providers': '{n} 个提供方的模型目录获取失败',
        'value.multiple': '×{x} 中位数',
        'iq.unranked': '—',
        'perM': '/百万',
      },
      en: {
        'title': 'Model value',
        'panel.title': 'Model value ranking',
        'panel.subtitle': 'Price × intelligence → value, to pick a model per task',
        'col.rankAll': 'Overall',
        'col.rankGroup': 'Rank',
        'col.model': 'Model',
        'col.input': 'Input',
        'col.output': 'Output',
        'col.blended': 'Blended',
        'col.iq': 'IQ',
        'col.value': 'Value',
        'sort.label': 'Sort',
        'sort.value': 'Value',
        'sort.price': 'Price',
        'sort.iq': 'IQ',
        'currency.label': 'Currency',
        'refresh': 'Refresh',
        'refreshing': 'Refreshing…',
        'action.switching': 'Switching…',
        'menu.top': '★ Top 3 by value',
        'menu.pinsTitle': '★ Top 3 + {n} pinned',
        'menu.more': 'See full ranking',
        'menu.locked': 'The model cannot be switched in this session',
        'menu.scrollHint': '{n} rows · scroll',
        'col.pin': 'Menu',
        'panel.selected': 'Selected',
        'action.clearSelected': 'Clear selection',
        'pin.title': 'Pin to the top of the composer menu',
        'pin.hint': 'Checked models are added to the composer menu (recommendations stay on top)',
        'missing.iq': 'No score on file',
        'meta.asOf': 'Data as of',
        'meta.sources': 'Sources',
        'meta.count': '{n} models',
        'meta.weights': 'mix {w}',
        'meta.hidden': 'Hidden: {free} free · {unscored} without a score · {unpriced} without a price',
        'block.all': 'All models ({n})',
        'block.connected': 'Connected ({n})',
        'block.marketOnly': 'Not connected ({n})',
        'block.grouped': 'Ranked by provider',
        'scope.label': 'Scope',
        'scope.all': 'All',
        'scope.connected': 'Connected',
        'scope.unconnected': 'Market',
        'badge.market': 'market',
        'group.providerMeta': '{n} models',
        'group.best': 'best {x}',
        'market.hint': 'Priced and scored but not offered by this DSH; connect one and it moves into the provider groups below.',
        'market.hintMore': '{n} more are priced but have no public score, so they cannot be ranked.',
        'price.estimated': 'Price inherited from the base model; this serving tier has no own price',
        'estimate.title': 'This row carries an inherited value; hover for the source',
        'rank.all': 'overall #{n}',
        'rank.connected': 'connected #{n}',
        'search.placeholder': 'Search model names (highlights, never filters)',
        'search.clear': 'Clear search',
        'search.matches': '{n} match(es)',
        'copy.name': 'Copy model name',
        'copy.done': 'Copied',
        'empty.title': 'No price data yet',
        'empty.hint': 'Paste price and intelligence JSON in the plugin settings, or enable the online price feed and refresh.',
        'error.title': 'Ranking endpoint unavailable',
        'error.retry': 'Retry',
        'error.writerHeld': 'Another DSH instance owns this session',
        'error.remote': 'The model switch service is not running - check that the plugin is enabled',
        'error.switchFailed': 'Switch failed: {message}',
        'warn.providers': '{n} provider catalog(s) failed to load',
        'value.multiple': '×{x} median',
        'iq.unranked': '—',
        'perM': '/M',
      },
    }

    const CSS = `
/* ----- composer model menu: Top 3 + pinned ----- */
.dmv-menu{display:flex;flex-direction:column;flex:0 0 auto;gap:4px;padding:8px 8px 4px;border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.16))}
.dmv-menu-head{display:flex;flex:none;align-items:baseline;justify-content:space-between;gap:8px;padding:0 6px 2px}
.dmv-menu-title{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:650;letter-spacing:.02em;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95))}
.dmv-menu-meta{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-caption,rgba(128,128,128,.8))}
.dmv-menu-list{display:flex;flex:0 1 auto;flex-direction:column;gap:1px;max-height:156px;overflow-y:auto;overscroll-behavior:contain}
.dmv-menu-row{display:flex;align-items:center;gap:10px;min-height:32px;padding:5px 7px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:13px;line-height:1.25;text-align:left;cursor:pointer}
.dmv-menu-row:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14))}
.dmv-menu-row:disabled{opacity:.55;cursor:not-allowed}
/* The name wraps instead of truncating: a tooltip cannot be read while picking,
   and a half-shown name is the one thing that made two channels look the same. */
.dmv-menu-name{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.dmv-menu-provider{flex:none;max-width:46%;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));font-size:10px;line-height:1.5;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmv-rank{flex:none;min-width:26px;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--dsw-alias-brand-primary,#6b7cff)}
.dmv-rank-star{color:var(--dsw-alias-state-warning-primary,#e2a03f)}
.dmv-menu-more{flex:none;min-height:26px;margin-top:2px;padding:0 7px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));font:inherit;font-size:12px;text-align:left;cursor:pointer}
.dmv-menu-more:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14))}

/* ----- ranking panel ----- */
.dmv-panel{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:1.45;user-select:text;--dmv-cols:30px 62px minmax(0,1fr) 80px 80px 80px 42px minmax(92px,124px);--dmv-gap:10px;--dmv-pad:20px;--dmv-split-h:34px;--dmv-th-h:28px}
.dmv-head{flex:none;display:flex;flex-direction:column;gap:5px;padding:16px var(--dmv-pad) 12px;border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.16))}
.dmv-head-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px 16px;flex-wrap:wrap}
.dmv-title{margin:0;font-size:15px;font-weight:650;letter-spacing:.01em}
.dmv-subtitle{margin:3px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95))}
.dmv-controls{display:flex;align-items:center;gap:6px 8px;flex-wrap:wrap}
.dmv-seg{display:inline-flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.2));border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1))}
.dmv-seg button{min-height:22px;padding:0 10px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));font:inherit;font-size:12px;line-height:1;cursor:pointer}
.dmv-seg button:hover{color:var(--dsw-alias-label-secondary,rgba(128,128,128,1))}
.dmv-seg button[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.3));color:var(--dsw-alias-label-primary,inherit);font-weight:600}
.dmv-ghost{min-height:26px;padding:0 11px;border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.28));border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,rgba(128,128,128,1));font:inherit;font-size:12px;line-height:1;cursor:pointer}
.dmv-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.dmv-ghost:disabled{opacity:.55;cursor:progress}
.dmv-meta{display:flex;align-items:center;flex-wrap:wrap;gap:2px 12px;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-caption,rgba(128,128,128,.8))}
.dmv-meta>span+span::before{content:"·";margin:0 9px 0 0;opacity:.55}
.dmv-meta-dim{opacity:.85}
.dmv-hint{display:flex;align-items:stretch;gap:8px;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-caption,rgba(128,128,128,.8))}
.dmv-hint::before{content:"";flex:none;width:2px;border-radius:2px;background:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));background:color-mix(in srgb,var(--dsw-alias-brand-primary,#6b7cff) 65%,transparent);opacity:.55}
/* Search highlights, it never hides a row. */
.dmv-search{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dmv-search-input{display:flex;align-items:center;gap:4px;flex:0 1 280px;min-width:180px;min-height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.28));border-radius:8px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08))}
.dmv-search-input:focus-within{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#6b7cff) 55%,transparent)}
.dmv-search-input input{flex:1 1 auto;min-width:0;border:0;background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:12px;line-height:1.4;outline:none}
.dmv-search-input input::placeholder{color:var(--dsw-alias-label-caption,rgba(128,128,128,.8))}
.dmv-search-clear{flex:none;width:18px;height:18px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));font:inherit;font-size:13px;line-height:1;cursor:pointer}
.dmv-search-clear:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary,inherit)}
.dmv-search-count{font-size:11px;color:var(--dsw-alias-label-caption,rgba(128,128,128,.8));font-variant-numeric:tabular-nums}
.dmv-mark{padding:0 1px;border-radius:3px;background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#e2a03f) 38%,transparent);color:inherit}
/* Copies the model name; the ranking page is where details are meant to be copied.
   The icon is drawn with two borders so it cannot depend on a font having ⧉. */
.dmv-copy{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));font:inherit;font-size:11px;line-height:1;cursor:pointer;opacity:.5}
.dmv-copy::before,.dmv-copy::after{content:"";position:absolute;width:8px;height:8px;border:1px solid currentColor;border-radius:2px}
.dmv-copy::before{left:4px;top:6px}
.dmv-copy::after{left:7px;top:3px;background:var(--dsw-alias-bg-base,#1b1d22)}
.dmv-row:hover .dmv-copy,.dmv-copy:focus-visible{opacity:1}
.dmv-copy-done{opacity:1;color:var(--dsw-alias-label-primary,inherit)}
.dmv-copy-done::before,.dmv-copy-done::after{content:none}
.dmv-selected{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,rgba(128,128,128,1))}
.dmv-scroll{flex:1;min-height:0;overflow:auto;padding:0 0 18px;overscroll-behavior:contain}
.dmv-block{position:relative}
.dmv-block+.dmv-block{margin-top:14px}
.dmv-grid{display:grid;grid-template-columns:var(--dmv-cols);align-items:center;column-gap:var(--dmv-gap)}
.dmv-split{position:sticky;top:0;z-index:4;display:flex;align-items:center;gap:8px;height:var(--dmv-split-h);padding:0 var(--dmv-pad);border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.16));background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#1b1d22));font-size:12px;font-weight:650;letter-spacing:.01em;color:var(--dsw-alias-label-secondary,rgba(128,128,128,1))}
/* The hairline is a real element so a control can sit to its right. */
.dmv-split-rule{flex:1;min-width:12px;height:1px;background:currentColor;opacity:.16}
.dmv-split-scope{flex:none;display:flex;align-items:center}
.dmv-split-scope .dmv-seg{padding:0;gap:1px;border-color:transparent;background:transparent}
.dmv-split-scope .dmv-seg button{min-height:20px;padding:0 8px;font-size:11px}
.dmv-th{position:sticky;top:var(--dmv-split-h);z-index:3;min-height:var(--dmv-th-h);padding:0 var(--dmv-pad);border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.16));background:var(--dsw-alias-bg-base,#1b1d22);font-size:10.5px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-caption,rgba(128,128,128,.8))}
.dmv-th>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmv-th-num{text-align:right}
.dmv-row{min-height:46px;padding:0 var(--dmv-pad);border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.1))}
.dmv-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08))}
.dmv-cell{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}
.dmv-cell-num{text-align:right;color:var(--dsw-alias-label-secondary,rgba(128,128,128,1))}
.dmv-cell-blend{color:var(--dsw-alias-label-primary,inherit);font-weight:550}
.dmv-cell-dim{color:var(--dsw-alias-label-caption,rgba(128,128,128,.8))}
/* Two lines: the name with its pills, then the raw 提供方/模型ID. The id used to
   live in a tooltip, where it could be read but never copied. */
.dmv-name{display:flex;flex-direction:column;align-items:flex-start;gap:1px;min-width:0;overflow:hidden}
.dmv-name-top{display:flex;align-items:center;gap:6px;max-width:100%;min-width:0}
/* The name and everything that belongs to it stay together on the left; the
   slack of the 1fr column sits after them, not between the name and its chips. */
.dmv-name strong{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:550}
.dmv-key{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;line-height:1.4;letter-spacing:.01em;color:var(--dsw-alias-label-caption,rgba(128,128,128,.8))}
.dmv-tag{flex:none;display:inline-flex;align-items:center;height:15px;padding:0 4px;border-radius:4px;font-size:10px;font-weight:600;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14))}
.dmv-badge-market{flex:none;display:inline-flex;align-items:center;height:15px;padding:0 5px;border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.3));border-radius:4px;font-size:10px;font-weight:600;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));white-space:nowrap}
/* The other numbering, always visible: a pill in the same shape as the channel. */
.dmv-rank-chip{flex:none;display:inline-flex;align-items:center;height:15px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));font-size:10px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,rgba(128,128,128,1));white-space:nowrap}
/* The host checkbox is a native control: a page without color-scheme paints a
   white square on dark rows, so draw our own in label colours instead. */
.dmv-pin{position:relative;display:flex;align-items:center;justify-self:start}
.dmv-pin::after{content:"✓";position:absolute;left:0;top:0;width:14px;height:14px;font-size:10px;line-height:14px;text-align:center;color:var(--dsw-alias-bg-base,#1b1d22);opacity:0;pointer-events:none}
.dmv-pin:has(input:checked)::after{opacity:1}
.dmv-pin input{-webkit-appearance:none;appearance:none;width:14px;height:14px;margin:0;border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.45));border-radius:4px;background:transparent;cursor:pointer;transition:background-color .12s ease,border-color .12s ease}
.dmv-pin input:hover{border-color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95))}
.dmv-pin input:checked{border-color:var(--dsw-alias-label-primary,currentColor);background:var(--dsw-alias-label-primary,currentColor)}
.dmv-pin input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#6b7cff);outline-offset:1px}
/*
 * Never a solid brand fill behind text we do not control: some themes ship a
 * light brand-primary, and the old #1 badge then painted white text on white.
 * A translucent tint over the row stays readable whichever way the palette goes.
 */
.dmv-badge-rank{justify-self:start;display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:20px;padding:0 6px;border:1px solid transparent;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));font-size:11px;font-weight:650;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,rgba(128,128,128,1))}
.dmv-badge-rank[data-top="1"]{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));background:color-mix(in srgb,var(--dsw-alias-brand-primary,#6b7cff) 24%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#6b7cff) 55%,transparent);color:var(--dsw-alias-label-primary,inherit);font-weight:700}
.dmv-badge-rank[data-top="2"],.dmv-badge-rank[data-top="3"]{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));background:color-mix(in srgb,var(--dsw-alias-brand-primary,#6b7cff) 12%,transparent);color:var(--dsw-alias-label-secondary,rgba(128,128,128,1))}
.dmv-value{display:flex;align-items:center;justify-content:flex-end;gap:7px;min-width:0}
.dmv-bar{flex:1 1 auto;max-width:70px;height:4px;border-radius:99px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16));overflow:hidden}
.dmv-bar span{display:block;height:100%;border-radius:99px;background:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));background:color-mix(in srgb,var(--dsw-alias-brand-primary,#6b7cff) 72%,transparent)}
.dmv-value-x{flex:none;min-width:32px;text-align:right;font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95))}
.dmv-group-head{position:sticky;top:calc(var(--dmv-split-h) + var(--dmv-th-h));z-index:2;display:flex;align-items:center;gap:8px;min-height:32px;padding:0 var(--dmv-pad);border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.16));background:var(--dsw-alias-bg-base,#1b1d22);font-size:12px;font-weight:650;color:var(--dsw-alias-label-secondary,rgba(128,128,128,1))}
.dmv-group-name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmv-group-meta{flex:none;font-size:11px;font-weight:500;color:var(--dsw-alias-label-caption,rgba(128,128,128,.8))}
.dmv-group-best{flex:none;margin-left:auto;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));background:color-mix(in srgb,var(--dsw-alias-brand-primary,#6b7cff) 16%,transparent);font-size:11px;font-weight:650;color:var(--dsw-alias-label-primary,inherit);font-variant-numeric:tabular-nums}
.dmv-market-hint{padding:6px var(--dmv-pad);border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.16));background:var(--dsw-alias-bg-base,#1b1d22);font-size:11px;line-height:1.5;color:var(--dsw-alias-label-caption,rgba(128,128,128,.8))}
.dmv-note{margin:10px var(--dmv-pad) 0;padding:8px 10px;border-radius:8px;font-size:12px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1))}
.dmv-note-error{color:var(--dsw-alias-state-error-primary,#e5484d)}
.dmv-empty{display:flex;flex-direction:column;gap:8px;align-items:flex-start;padding:32px var(--dmv-pad)}
.dmv-empty strong{font-size:13px}
.dmv-empty span{font-size:12px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95))}
.dmv-foot{flex:none;display:flex;gap:12px;flex-wrap:wrap;align-items:center;padding:10px var(--dmv-pad);border-top:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.16));font-size:11px;color:var(--dsw-alias-label-caption,rgba(128,128,128,.8))}
.dmv-foot a{color:inherit;text-decoration:underline;text-underline-offset:2px}
/* On a narrow panel the model name wins over the secondary ranking pill: the
   other numbering is still in the grouped table and in the menu tooltip. */
@media (max-width:900px){.dmv-rank-chip{display:none}}
@media (max-width:640px){.dmv-panel{--dmv-cols:26px 56px minmax(0,1fr) 72px 72px 72px 36px minmax(78px,96px);--dmv-gap:6px;--dmv-pad:14px}}
`

    /* ---------------------------------------------------------------- utils */

    const num = (value) => (value === null || value === undefined || !Number.isFinite(value) ? null : value)

    /**
     * Identity of a concrete picker row: provider + model. The canonical
     * `row.key` is shared by every channel that offers the same underlying
     * model, so pinning by key would tick all channels at once. The picker
     * switches by (provider, model), so pins must use the same granularity.
     */
    const rowId = (row) => `${row.provider}/${row.model}`

    /**
     * The model name exactly as the search box matches it — the string the copy
     * button puts on the clipboard. Nothing on either surface hides content in a
     * tooltip any more: a tooltip cannot be selected or copied, and on the panel
     * the raw 提供方/模型ID now has its own visible line.
     */
    const rowTitle = (row) => (typeof row.name === 'string' ? row.name : '')

    /** Escapes a literal needle so `5.5` or `(` in a model name cannot break the search. */
    const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    /**
     * Wraps the matched part of a label in `<mark>`. The list is never filtered:
     * a search is a finding aid, so unmatched rows keep their place, their rank
     * and their checkbox.
     */
    function highlight(text, term) {
      const needle = String(term ?? '').trim()
      if (needle === '') return text
      const parts = String(text).split(new RegExp(`(${escapeRegExp(needle)})`, 'i'))
      if (parts.length < 3) return text
      return parts.map((part, index) => (index % 2 === 1 ? h('mark', { className: 'dmv-mark', key: index }, part) : part))
    }

    /** True when the row's name contains the search term, case-insensitively. */
    const nameHits = (row, needle) => needle !== '' && String(row.name ?? '').toLowerCase().includes(needle)

    /**
     * Copies through the async clipboard API, falling back to a temporary
     * textarea: the panel is served over plain http on loopback, and a host may
     * not expose `navigator.clipboard`.
     */
    async function copyText(text) {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch {
        /* fall through to the textarea */
      }
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        area.remove()
        return ok === true
      } catch {
        return false
      }
    }

    /**
     * `unit: false` is for table cells: the column header already carries the
     * currency, so repeating the symbol on all 98 rows is noise and it is what
     * pushes the numeric columns out of alignment.
     */
    function moneyText(value, currency, unit = true) {
      const amount = num(value)
      if (amount === null || amount === 0) return '—'
      const symbol = unit ? (currency && currency.symbol ? currency.symbol : '$') : ''
      if (amount >= 100) return `${symbol}${amount.toFixed(0)}`
      if (amount >= 1) return `${symbol}${amount.toFixed(2)}`
      if (amount >= 0.01) return `${symbol}${amount.toFixed(3)}`
      return `${symbol}${String(Number(amount.toFixed(4)))}`
    }

    function iqText(t, row) {
      const iq = num(row.iq)
      if (iq === null) return t('iq.unranked')
      return row.iqEstimated ? `≈${iq}` : String(iq)
    }

    function sourceHost(url) {
      if (typeof url !== 'string' || url === '') return ''
      try {
        return new URL(url).host.replace(/^www\./, '')
      } catch {
        return ''
      }
    }

    function formatDate(value) {
      if (typeof value !== 'string' || value === '') return ''
      return value.length >= 10 ? value.slice(0, 10) : value
    }

    /* ---------------------------------------------------------------- store */

    /**
     * One shared fetch of the Host payload. Every surface subscribes, so opening
     * the menu and the panel costs a single request.
     */
    function createStore(request) {
      const listeners = new Set()
      let state = { status: 'idle', data: null, error: '', sort: 'value', currency: 'USD', scope: 'all', search: '', at: 0 }
      let inflight = null
      /** Optimistic pin list after a local toggle; null = payload is authoritative. */
      let selectedDraft = null
      /** Serial write chain — every toggle appends, so clicks never interleave. */
      let pinChain = Promise.resolve()
      const currentSelected = () => {
        if (selectedDraft !== null) return [...selectedDraft]
        /** Always a copy: `togglePin` pushes/splices the result, and mutating the
         *  payload's array in place would corrupt the very snapshot a failed
         *  write needs to roll back to. */
        return state.data !== null && Array.isArray(state.data.selected) ? [...state.data.selected] : []
      }

      const emit = () => {
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch {
            /* a broken subscriber must not break the others */
          }
        }
      }
      const commit = (patch) => {
        state = { ...state, ...patch }
        emit()
      }

      const store = {
        get: () => ({ ...state, selected: currentSelected() }),
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        /** Loads once per minute unless the caller forces a refresh. */
        ensure() {
          if (state.data !== null && Date.now() - state.at < 60_000) return inflight ?? Promise.resolve(state.data)
          return store.load({})
        },
        setSort(sort) {
          if (sort === state.sort) return Promise.resolve(state.data)
          return store.load({ sort })
        },
        setCurrency(currency) {
          if (currency === state.currency) return Promise.resolve(state.data)
          return store.load({ currency })
        },
        /**
         * Which rows the merged table draws. View state only: the payload
         * already carries both kinds, so no request is needed.
         */
        setScope(scope) {
          if (scope === state.scope) return
          if (scope !== 'all' && scope !== 'connected' && scope !== 'unconnected') return
          commit({ scope })
        },
        /**
         * What the panel highlights. Never filters: the rows, their order and
         * their ranks stay exactly as the Host ranked them.
         */
        setSearch(text) {
          const next = typeof text === 'string' ? text.slice(0, 80) : ''
          if (next === state.search) return
          commit({ search: next })
        },
        clearSearch() {
          if (state.search === '') return
          commit({ search: '' })
        },
        load({ sort, currency, force } = {}) {
          if (inflight !== null) return inflight
          const nextSort = sort ?? state.sort
          const nextCurrency = currency ?? state.currency
          commit({ status: state.data === null ? 'loading' : 'refreshing', error: '', sort: nextSort, currency: nextCurrency })
          const params = new URLSearchParams({ sort: nextSort, currency: nextCurrency })
          if (force) params.set('refresh', '1')
          inflight = request(`${ROUTE}?${params.toString()}`)
            .then((payload) => {
              selectedDraft = null
              commit({
                status: 'ready',
                data: payload,
                error: '',
                at: Date.now(),
                sort: payload.sort ?? nextSort,
                currency: payload.currency?.code ?? nextCurrency,
              })
              return payload
            })
            .catch((error) => {
              commit({ status: state.data === null ? 'error' : 'ready', error: String(error && error.message ? error.message : error) })
              return null
            })
            .finally(() => {
              inflight = null
            })
          return inflight
        },
        /**
         * Writes the whole pin list through the Host route, then re-reads the
         * rank payload so every surface sees the canonical list. Clicked state
         * is applied optimistically; the inflight chain serializes rapid clicks.
         */
        writePins(keys) {
          const next = [...new Set(keys.filter((key) => typeof key === 'string' && key !== ''))]
          selectedDraft = next
          commit({})
          pinChain = pinChain.then(async () => {
            try {
              const response = await request(`${PINS_PATH}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-dsh-model-value': '1' },
                body: JSON.stringify({ keys: next }),
              })
              /** Only adopt the echoed list when no newer toggle superseded this write. */
              if (selectedDraft === next && Array.isArray(response?.selected)) {
                selectedDraft = response.selected
              }
              commit({})
            } catch (error) {
              /** Roll the optimistic tick back to the last canonical list: a
               *  failed write must not leave a checkbox ticked that the Host
               *  never saved and that a reload would immediately undo. */
              if (selectedDraft === next) {
                selectedDraft = state.data !== null && Array.isArray(state.data.selected) ? [...state.data.selected] : null
              }
              commit({ error: String(error && error.message ? error.message : error) })
            }
          })
          return pinChain
        },
        togglePin(key) {
          const next = currentSelected()
          const index = next.indexOf(key)
          if (index === -1) next.push(key)
          else next.splice(index, 1)
          return store.writePins(next)
        },
        clearPins() {
          return store.writePins([])
        },
      }
      return store
    }

    function useStore(store) {
      const [snapshot, setSnapshot] = React.useState(store.get())
      React.useEffect(() => store.subscribe(() => setSnapshot(store.get())), [store])
      return snapshot
    }

    async function requestJson(url, init) {
      const response = await fetch(url, {
        ...(init ?? {}),
        headers: { accept: 'application/json', ...(init?.headers ?? {}) },
        cache: 'no-store',
      })
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok || payload === null || payload.ok !== true) {
        const message = payload && payload.error && payload.error.message ? payload.error.message : `HTTP ${response.status}`
        throw new Error(message)
      }
      return payload
    }

    /* ----------------------------------------------------------- components */

    /**
     * The rank column is aligned for scanning; the pill beside the model name
     * carries the other numbering. No tooltip: hover-only numbers were too easy
     * to miss.
     */
    function RankBadge(props) {
      const { rank } = props
      if (num(rank) === null) return h('span', { className: 'dmv-badge-rank dmv-cell-dim' }, '—')
      return h('span', { className: 'dmv-badge-rank', 'data-top': String(rank) }, `#${rank}`)
    }

    /** `field` picks the scale: the merged table and the grouped table each have their own median. */
    function ValueCell(props) {
      const { row, t, field = 'valueIndex' } = props
      const index = num(row[field])
      if (index === null) return h('span', { className: 'dmv-cell dmv-cell-dim' }, t('missing.iq'))
      const width = Math.max(4, Math.min(100, Math.round((index / 4) * 100)))
      return h('div', { className: 'dmv-value' }, [
        h('div', { className: 'dmv-bar', key: 'bar' }, h('span', { style: { width: `${width}%` } })),
        h('span', { className: 'dmv-value-x', key: 'x', title: t('value.multiple', { x: index }) }, `×${index}`),
      ])
    }

    /**
     * Menu entry: the three best-value picks, plus any pinned model that did
     * not already make that list. Rendered by the shipped picker above its own
     * search box, so it stays short — the full list is one click away in the
     * panel, and the picker's own list is right below.
     */
    function OptionsEntry(props) {
      const { t, store, openPanel, select, available, locked, dismiss, reportFailure } = props
      const snapshot = useStore(store)
      const [busy, setBusy] = React.useState('')
      React.useEffect(() => {
        store.ensure()
      }, [store])

      const data = snapshot.data
      if (data === null) return null
      const selected = new Set(snapshot.selected || [])
      const rows = data.rows || []
      /**
       * Recommendations first: one row per model (several channels can offer
       * the same one), in value order. Pins are concrete (provider, model)
       * rows, so a pinned channel of an already-listed model still counts as
       * listed — only unseen rows are appended. Every pin is shown: hiding one
       * would silently disagree with the checkbox the user just ticked.
       */
      const picks = []
      const seenKeys = new Set()
      for (const row of rows) {
        if (row.group !== 'ranked') continue
        const key = row.key || rowId(row)
        if (seenKeys.has(key)) continue
        seenKeys.add(key)
        picks.push({ row, star: false })
        if (picks.length >= TOP_ROWS) break
      }
      if (selected.size > 0) {
        for (const row of rows) {
          const id = rowId(row)
          if (!selected.has(id)) continue
          if (picks.some((pick) => rowId(pick.row) === id)) continue
          picks.push({ row, star: true })
        }
      }
      if (picks.length === 0) return null

      const run = async (row) => {
        if (busy !== '' || locked) return
        setBusy(`${row.provider}/${row.model}`)
        try {
          const result = await select(row)
          if (result !== undefined && result !== null && result.ok === false) {
            const code = result.error ? result.error.code : ''
            if (code === 'session/writer-held') reportFailure(t('error.writerHeld'))
            else if (code === 'local/unavailable') reportFailure(t('error.remote'))
            else reportFailure(t('error.switchFailed', { message: result.error ? result.error.message : code }))
            return
          }
          if (dismiss) dismiss()
        } catch (error) {
          reportFailure(String(error && error.message ? error.message : error))
        } finally {
          setBusy('')
        }
      }

      const indexName = data.index && data.index.name ? data.index.name : ''
      const pinnedShown = picks.filter((pick) => pick.star).length
      const title = pinnedShown > 0 ? t('menu.pinsTitle', { n: pinnedShown }) : t('menu.top')
      const meta = !available
        ? t('menu.locked')
        : picks.length > VISIBLE_ROWS
          ? t('menu.scrollHint', { n: picks.length })
          : indexName
      return h('div', { className: 'dmv-menu' }, [
        h('div', { className: 'dmv-menu-head', key: 'head' }, [
          h('span', { className: 'dmv-menu-title', key: 'title' }, title),
          h('span', { className: 'dmv-menu-meta', key: 'meta' }, meta),
        ]),
        h('div', { className: 'dmv-menu-list', key: 'list' },
          ...picks.map(({ row, star }) =>
            h(
              'button',
              {
                key: rowId(row),
                type: 'button',
                className: 'dmv-menu-row',
                disabled: Boolean(locked) || !available || busy !== '',
                onClick: () => run(row),
              },
              [
                h(
                  'span',
                  { className: star ? 'dmv-rank dmv-rank-star' : 'dmv-rank', key: 'rank' },
                  star ? '★' : `#${row.rank}`,
                ),
                h('span', { className: 'dmv-menu-name', key: 'name' }, row.name),
                /* The channel decides where the switch lands, so it is spelled out
                   on the row. Names wrap and ids are short, so nothing here needs
                   a tooltip: what is on screen is the whole row. */
                h(
                  'span',
                  { className: 'dmv-menu-provider', key: 'provider' },
                  busy === rowId(row)
                    ? t('action.switching')
                    : row.keyCount > 1
                      ? `${row.providerId} ×${row.keyCount}`
                      : row.providerId,
                ),
              ],
            ),
          ),
        ),
        h('button', { className: 'dmv-menu-more', key: 'more', type: 'button', onClick: openPanel }, t('menu.more')),
      ])
    }

    function Segmented(props) {
      const { label, value, options, onChange } = props
      return h(
        'div',
        { className: 'dmv-seg', role: 'group', 'aria-label': label },
        options.map((option) =>
          h(
            'button',
            {
              key: option.value,
              type: 'button',
              'aria-pressed': String(option.value === value),
              onClick: () => onChange(option.value),
            },
            option.label,
          ),
        ),
      )
    }

    /** Full ranking table: the place to compare before opening a new session. */
    function RankingPanel(props) {
      const { t, store } = props
      const snapshot = useStore(store)
      React.useEffect(() => {
        store.ensure()
      }, [store])

      const data = snapshot.data
      const busy = snapshot.status === 'loading' || snapshot.status === 'refreshing'
      const currency = data !== null && data.currency ? data.currency : { code: 'USD', symbol: '$' }
      const rows = data !== null && Array.isArray(data.rows) ? data.rows : []
      const ranked = rows.filter((row) => row.group === 'ranked')
      /**
       * One block per channel, ordered by its best deal. Rows that are neither
       * priced nor scored are not shown at all — they answer no question the
       * panel asks, and the counts line still reports how many were hidden.
       */
      const providers = data !== null && Array.isArray(data.providers) ? data.providers : []
      const byProvider = new Map()
      for (const row of ranked) {
        const list = byProvider.get(row.provider)
        if (list === undefined) byProvider.set(row.provider, [row])
        else list.push(row)
      }
      for (const list of byProvider.values()) list.sort((a, b) => (a.groupRank ?? 0) - (b.groupRank ?? 0))
      const marketRows = data !== null && Array.isArray(data.market) ? data.market : []
      const counts = data !== null && data.counts ? data.counts : {}

      /**
       * The merged table: connected channels and market models in one list with
       * one numbering. `allRank` is scored on the Host across both sets; a row
       * without one (a market row that lost its score, say) sinks to the end
       * instead of claiming a position.
       */
      const combined = [...ranked, ...marketRows].sort((a, b) => {
        const left = num(a.allRank)
        const right = num(b.allRank)
        if (left === null && right === null) return String(a.key).localeCompare(String(b.key))
        if (left === null) return 1
        if (right === null) return -1
        if (left !== right) return left - right
        return String(a.provider ?? '').localeCompare(String(b.provider ?? ''))
      })
      const scope = snapshot.scope === 'connected' || snapshot.scope === 'unconnected' ? snapshot.scope : 'all'
      const visible = combined.filter((row) => {
        const isMarket = row.group !== 'ranked'
        if (scope === 'connected') return !isMarket
        if (scope === 'unconnected') return isMarket
        return true
      })
      const scopeModels = new Set(visible.map((row) => row.key)).size
      const scopeHasMarket = visible.some((row) => row.group !== 'ranked')
      const scopeHasChannel = visible.some((row) => row.group === 'ranked')
      const scopeTitle = scope === 'connected' ? 'block.connected' : scope === 'unconnected' ? 'block.marketOnly' : 'block.all'

      /**
       * Search finds, it does not filter: `visible` stays untouched, the matches
       * only get a `<mark>` and a count.
       */
      const search = typeof snapshot.search === 'string' ? snapshot.search : ''
      const needle = search.trim().toLowerCase()
      const hitCount = needle === '' ? 0 : visible.filter((row) => nameHits(row, needle)).length

      const weights = data !== null && data.weights ? `${data.weights.rawInput}:${data.weights.rawOutput}` : ''
      const sources = []
      if (data !== null && data.index && data.index.url) sources.push({ label: data.index.name || 'IQ', url: data.index.url })
      const priceHosts = new Set()
      for (const row of rows) {
        const host = sourceHost(row.priceUrl)
        if (host !== '') priceHosts.add(host)
      }
      for (const host of priceHosts) sources.push({ label: host, url: `https://${host}` })

      const pinKeys = snapshot.selected || []
      const [copied, setCopied] = React.useState('')
      /** Copies exactly the string the search box matches on, so a paste always hits. */
      const copyName = async (row, identity) => {
        const ok = await copyText(rowTitle(row))
        if (!ok) return
        setCopied(identity)
        setTimeout(() => setCopied(''), 1200)
      }
      const pinCell = (row) => {
        const id = rowId(row)
        const checked = pinKeys.indexOf(id) !== -1
        return h('span', { className: 'dmv-pin', key: 'pin' },
          h('input', {
            type: 'checkbox',
            checked,
            title: t('pin.title'),
            'aria-label': `${t('pin.title')}: ${row.provider} · ${row.name}`,
            onChange: () => store.togglePin(id),
          }),
        )
      }

      /**
       * The currency lives in the header, not in all ~120 numeric cells: one
       * symbol per column keeps the digits aligned and the rows quiet.
       */
      const perM = `${currency.symbol || '$'}${t('perM')}`
      const unitLabel = (label) => `${label} ${perM}`

      /**
       * The header names the numbering this column shows, so the pill beside the
       * model name is unambiguous — 全部排名 in the merged table, 组内排名 in the
       * provider groups.
       */
      const tableHeader = (kind) => h('div', { className: 'dmv-grid dmv-th', key: 'th' }, [
        h('span', { key: 'pin', title: t('pin.title') }, t('col.pin')),
        h('span', { key: 'rank' }, kind === 'group' ? t('col.rankGroup') : t('col.rankAll')),
        h('span', { key: 'model' }, t('col.model')),
        h('span', { key: 'in', className: 'dmv-th-num' }, unitLabel(t('col.input'))),
        h('span', { key: 'out', className: 'dmv-th-num' }, unitLabel(t('col.output'))),
        h('span', { key: 'blend', className: 'dmv-th-num' }, unitLabel(t('col.blended'))),
        h('span', { key: 'iq', className: 'dmv-th-num' }, t('col.iq')),
        h('span', { key: 'value', className: 'dmv-th-num' }, t('col.value')),
      ])

      /**
       * One ≈ badge covers both kinds of inherited number: a score copied from
       * the parent model and a price copied from the base serving tier. The
       * tooltip carries whichever notes exist, so nothing is silently guessed.
       */
      const estimateTag = (row) => {
        const notes = []
        if (row.priceEstimated) notes.push(row.priceNote || t('price.estimated'))
        if (row.iqEstimated) notes.push(row.iqNote || t('price.estimated'))
        if (notes.length === 0) return null
        return h('span', { className: 'dmv-tag', key: 'e', title: `${t('estimate.title')} — ${notes.join(' · ')}` }, '≈')
      }

      /**
       * A model has two ranks, and both are on screen: the rank column shows the
       * one this table is sorted by, and a pill next to the model name spells
       * out the other one. A tooltip was too easy to miss, and the same model
       * carries different numbers in the merged and the grouped table.
       */
      const otherRank = (row, rankKind) => {
        if (row.group !== 'ranked') return null
        const value = rankKind === 'all' ? row.rank : row.allRank
        if (num(value) === null) return null
        return h('span', { className: 'dmv-rank-chip', key: 'r' }, t(rankKind === 'all' ? 'rank.connected' : 'rank.all', { n: value }))
      }

      /**
       * The raw identity of the row, spelled out on its own line:
       * `providerId/model` for a channel instance (Comate's opaque
       * `proxy_<hash>` included), the model slug for a market row. It used to be
       * a tooltip on the channel chip — readable, never copyable, and invisible
       * in a screenshot. A shared model across two channels repeats it, so a
       * multi-key channel also says how many keys point at the same id.
       */
      const modelKey = (row) => {
        if (row.group !== 'ranked') return String(row.key || row.model || '')
        const id = `${row.providerId || row.provider}/${row.model || ''}`
        return num(row.keyCount) !== null && row.keyCount > 1 ? `${id} ×${row.keyCount}` : id
      }

      /**
       * One row of either table. A connected row is a channel instance — it can
       * be pinned and switched; a market row is a canonical model with no
       * channel, so it has no checkbox and wears a 未接入 pill instead.
       */
      const tableRow = (row, rankKind) => {
        const isMarket = row.group !== 'ranked'
        const identity = isMarket ? `market/${row.key}` : `${row.provider}/${row.model}`
        /* With the scope on 未接入 every row is a market row, so the pill would sit
           on all of them and say nothing; the block title already says it. */
        const showMarketPill = isMarket && scope !== 'unconnected'
        return h(
          'div',
          { className: 'dmv-grid dmv-row', key: `${rankKind}/${identity}` },
          [
            isMarket ? h('span', { key: 'pin' }) : pinCell(row),
            h(RankBadge, { key: 'rank', rank: rankKind === 'all' ? row.allRank : row.groupRank }),
            h('div', { className: 'dmv-name', key: 'name' }, [
              h('div', { className: 'dmv-name-top', key: 'top' }, [
                h('strong', { key: 'n' }, highlight(row.name, search)),
                h(
                  'button',
                  {
                    key: 'copy',
                    type: 'button',
                    className: copied === identity ? 'dmv-copy dmv-copy-done' : 'dmv-copy',
                    title: copied === identity ? t('copy.done') : t('copy.name'),
                    'aria-label': `${t('copy.name')}: ${row.name}`,
                    onClick: () => copyName(row, identity),
                  },
                  copied === identity ? '✓' : null,
                ),
                estimateTag(row),
                otherRank(row, rankKind),
                showMarketPill ? h('span', { className: 'dmv-badge-market', key: 'm' }, t('badge.market')) : null,
              ]),
              h('span', { className: 'dmv-key', key: 'k' }, modelKey(row)),
            ]),
            h('span', { className: 'dmv-cell dmv-cell-num dmv-cell-dim', key: 'in' }, moneyText(row.price && row.price.input, currency, false)),
            h('span', { className: 'dmv-cell dmv-cell-num dmv-cell-dim', key: 'out' }, moneyText(row.price && row.price.output, currency, false)),
            h('span', { className: 'dmv-cell dmv-cell-num dmv-cell-blend', key: 'blend' }, moneyText(row.blended, currency, false)),
            h('span', { className: 'dmv-cell dmv-cell-num', key: 'iq' }, iqText(t, row)),
            h(ValueCell, { key: 'value', row, t, field: rankKind === 'all' ? 'allValueIndex' : 'valueIndex' }),
          ],
        )
      }

      return h('div', { className: 'dmv-panel' }, [
        h('div', { className: 'dmv-head', key: 'head' }, [
          h('div', { className: 'dmv-head-top', key: 'top' }, [
            h('div', { key: 'titles' }, [
              h('h2', { className: 'dmv-title', key: 't' }, t('panel.title')),
              h('p', { className: 'dmv-subtitle', key: 's' }, t('panel.subtitle')),
            ]),
            h('div', { className: 'dmv-controls', key: 'controls' }, [
              h(Segmented, {
                key: 'sort',
                label: t('sort.label'),
                value: snapshot.sort,
                onChange: (value) => store.setSort(value),
                options: [
                  { value: 'value', label: t('sort.value') },
                  { value: 'price', label: t('sort.price') },
                  { value: 'iq', label: t('sort.iq') },
                ],
              }),
              h(Segmented, {
                key: 'currency',
                label: t('currency.label'),
                value: snapshot.currency,
                onChange: (value) => store.load({ currency: value }),
                options: [
                  { value: 'USD', label: 'USD' },
                  { value: 'CNY', label: 'CNY' },
                ],
              }),
              h(
                'button',
                {
                  className: 'dmv-ghost',
                  key: 'refresh',
                  type: 'button',
                  disabled: busy,
                  onClick: () => store.load({ force: true }),
                },
                busy ? t('refreshing') : t('refresh'),
              ),
              h('span', { className: 'dmv-selected', key: 'selected' }, `${t('panel.selected')} ${pinKeys.length}`),
              h(
                'button',
                {
                  className: 'dmv-ghost',
                  key: 'clear',
                  type: 'button',
                  disabled: busy || pinKeys.length === 0,
                  onClick: () => store.clearPins(),
                },
                t('action.clearSelected'),
              ),
            ]),
          ]),
          /**
           * Provenance, then the exclusions, then the one instruction that makes
           * the checkbox column legible — three quiet lines, in that order.
           */
          h('div', { className: 'dmv-meta', key: 'meta' }, [
            data !== null
              ? h('span', { key: 'count' }, t('meta.count', { n: counts.distinct ?? ranked.length }))
              : null,
            weights !== '' ? h('span', { key: 'w' }, t('meta.weights', { w: weights })) : null,
            data !== null && data.asOf && data.asOf.prices
              ? h('span', { key: 'asof' }, `${t('meta.asOf')} ${formatDate(data.asOf.prices)}`)
              : null,
            data !== null && data.index
              ? h('span', { key: 'index' }, `${data.index.name || 'IQ'}${data.index.version ? ` ${data.index.version}` : ''}`)
              : null,
            /* eslint-disable-next-line no-nested-ternary */
            data !== null && data.counts && data.counts.failures > 0
              ? h('span', { key: 'fail', style: { color: 'var(--dsw-alias-state-error-primary, #e5484d)' } }, t('warn.providers', { n: data.counts.failures }))
              : null,
          ]),
          /**
           * Rows that cannot be compared are left out of the table, so say how
           * many and why — a silently shorter list looks like missing data.
           */
          data !== null && ((counts.free ?? 0) + (counts.unscored ?? 0) + (counts.unpriced ?? 0)) > 0
            ? h(
                'div',
                { className: 'dmv-meta dmv-meta-dim', key: 'hidden' },
                h('span', { key: 'h' }, t('meta.hidden', {
                  free: counts.free ?? 0,
                  unscored: counts.unscored ?? 0,
                  unpriced: counts.unpriced ?? 0,
                })),
              )
            : null,
          /**
           * The checkbox column is meaningless without saying what it does:
           * a pin adds the model to the composer menu, it does not filter here.
           * With nothing pinnable on screen (the 未接入 view) the hint is noise.
           */
          scopeHasChannel
            ? h(
                'div',
                { className: 'dmv-hint', key: 'pinhint' },
                h('span', { key: 'h' }, t('pin.hint')),
              )
            : null,
          /**
           * Search highlights instead of filtering: the rows keep their order,
           * their rank and their checkbox, and the count says how many matched.
           */
          h('div', { className: 'dmv-search', key: 'search' }, [
            h('div', { className: 'dmv-search-input', key: 'box' }, [
              h('input', {
                key: 'i',
                type: 'text',
                value: search,
                placeholder: t('search.placeholder'),
                'aria-label': t('search.placeholder'),
                onChange: (event) => store.setSearch(event && event.target ? event.target.value : ''),
              }),
              search === ''
                ? null
                : h(
                    'button',
                    {
                      key: 'clear',
                      type: 'button',
                      className: 'dmv-search-clear',
                      title: t('search.clear'),
                      'aria-label': t('search.clear'),
                      onClick: () => store.clearSearch(),
                    },
                    '×',
                  ),
            ]),
            needle === ''
              ? null
              : h('span', { className: 'dmv-search-count', key: 'count' }, t('search.matches', { n: hitCount })),
          ]),
        ]),

        data === null && snapshot.status === 'error'
          ? h('div', { className: 'dmv-empty', key: 'error' }, [
              h('strong', { key: 't', className: 'dmv-note-error' }, t('error.title')),
              h('span', { key: 'm' }, snapshot.error),
              h(
                'button',
                { className: 'dmv-ghost', key: 'r', type: 'button', onClick: () => store.load({ force: true }) },
                t('error.retry'),
              ),
            ])
          : null,

        data !== null && rows.length === 0
          ? h('div', { className: 'dmv-empty', key: 'empty' }, [
              h('strong', { key: 't' }, t('empty.title')),
              h('span', { key: 'h' }, t('empty.hint')),
            ])
          : null,

        data !== null && visible.length > 0
          ? h('div', { className: 'dmv-scroll', key: 'scroll' }, [
              /**
               * Block 1: everything the plugin knows a price and a score for —
               * the channels you have and the market models you do not — in one
               * list with one numbering. The chips on the title bar narrow it.
               */
              h('div', { className: 'dmv-block', key: 'all' }, [
                h('div', { className: 'dmv-split', key: 'split' }, [
                  h('span', { key: 't' }, t(scopeTitle, { n: scopeModels })),
                  h('span', { className: 'dmv-split-rule', key: 'rule' }),
                  h(
                    'span',
                    { className: 'dmv-split-scope', key: 'scope' },
                    h(Segmented, {
                      label: t('scope.label'),
                      value: scope,
                      onChange: (value) => store.setScope(value),
                      options: [
                        { value: 'all', label: t('scope.all') },
                        { value: 'connected', label: t('scope.connected') },
                        { value: 'unconnected', label: t('scope.unconnected') },
                      ],
                    }),
                  ),
                ]),
                scopeHasMarket
                  ? h(
                      'div',
                      { className: 'dmv-market-hint', key: 'market-hint' },
                      [t('market.hint'), counts.market && counts.market.unscored > 0 ? ` ${t('market.hintMore', { n: counts.market.unscored })}` : ''].join(''),
                    )
                  : null,
                tableHeader('all'),
                ...visible.map((row) => tableRow(row, 'all')),
              ]),
              /* Block 2: per-provider groups, with that channel's own ranking. */
              h('div', { className: 'dmv-block', key: 'grouped' }, [
                h('div', { className: 'dmv-split', key: 'split' }, [
                  h('span', { key: 't' }, t('block.grouped')),
                  h('span', { className: 'dmv-split-rule', key: 'rule' }),
                ]),
                tableHeader('group'),
                ...providers.flatMap((group) => {
                  const list = byProvider.get(group.id) ?? []
                  if (list.length === 0) return []
                  const median = num(data.medianValue)
                  const ratio = group.bestValue === null || median === null || median <= 0 ? null : Math.round((group.bestValue / median) * 100) / 100
                  const head = h('div', { className: 'dmv-group-head', key: `group/${group.id}` }, [
                    h('span', { className: 'dmv-group-name', key: 'n', title: group.name }, group.name),
                    h('span', { className: 'dmv-group-meta', key: 'm' }, t('group.providerMeta', { n: group.models })),
                    ratio === null
                      ? null
                      : h(
                          'span',
                          { className: 'dmv-group-best', key: 'b', title: t('value.multiple', { x: ratio }) },
                          t('group.best', { x: `×${ratio}` }),
                        ),
                  ])
                  return [head, ...list.map((row) => tableRow(row, 'group'))]
                }),
              ]),
            ])
          : null,

        data !== null && Array.isArray(data.warnings) && data.warnings.length > 0
          ? h(
              'div',
              { className: 'dmv-note dmv-note-error', key: 'warn' },
              data.warnings.slice(0, 3).join(' · '),
            )
          : null,

        h('div', { className: 'dmv-foot', key: 'foot' }, [
          h('span', { key: 'src' }, t('meta.sources')),
          ...sources.slice(0, 4).map((source) =>
            h('a', { key: source.url, href: source.url, target: '_blank', rel: 'noreferrer noopener' }, source.label),
          ),
        ]),
      ])
    }

    /* ------------------------------------------------------------------ apply */

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, STRINGS), 'dsh-model-value: strings')
      const t = ctx.locale.bind(NS)
      const store = createStore(requestJson)

      let layout = null
      let sessions = null
      ctx.effect(() => ctx.inject(['layout'], (scope) => {
        layout = scope.layout
      }), 'dsh-model-value: layout')
      ctx.effect(() => ctx.inject(['sessions'], (scope) => {
        sessions = scope.sessions
      }), 'dsh-model-value: sessions')

      /**
       * The switch runs on the Host: the browser-side `remote` namespace is a
       * Client Service face and is not reachable from a workspace bundle
       * (`ctx.remote` stays undefined even with `inject: ['remote']`). The Host
       * owns `sessionController`, so it performs the selection and answers
       * `{ok:true}` / `{ok:false,error:{code,message}}` — the same shape the
       * Remote boundary would have produced.
       */
      const select = async (sessionId, row) => {
        const body = { sessionId, provider: row.provider, model: row.model }
        if (row.reasoningEffort !== undefined) body.reasoningEffort = row.reasoningEffort
        try {
          const response = await fetch(SELECT_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dsh-model-value': '1' },
            body: JSON.stringify(body),
          })
          const payload = await response.json().catch(() => null)
          if (payload === null || typeof payload !== 'object') {
            return { ok: false, error: { code: `http/${response.status}`, message: `HTTP ${response.status}` } }
          }
          return payload
        } catch (error) {
          return { ok: false, error: { code: 'network', message: String(error && error.message ? error.message : error) } }
        }
      }

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = 'dsh-model-value'
        style.dataset.pluginCss = 'modelValue'
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'dsh-model-value: stylesheet')

      const openPanel = () => {
        try {
          if (layout !== null && typeof layout.selectPanel === 'function') layout.selectPanel(PANEL_ID)
        } catch {
          /* the panel lives in the main column; a missing layout is not fatal */
        }
      }

      const available = (sessionId) => {
        try {
          if (sessions === null || typeof sessions.subagentAddress !== 'function') return true
          return sessions.subagentAddress(sessionId) === undefined
        } catch {
          return true
        }
      }

      // Top-3 picks inside the composer's model menu.
      ctx.effect(() => ctx.slots.inject('conversation.input.model.options', () => ctx.slots.register({
        name: 'conversation.input.model.options',
        id: 'model-value-top',
        order: 10,
        locale: NS,
        inject: (sessionId) => ({
          sessionId,
          store,
          openPanel,
          available: available(sessionId),
          select: (row) => select(sessionId, row),
        }),
      }, OptionsEntry)), 'dsh-model-value: menu entry')

      // Full ranking table in the main column.
      ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ store }),
      }, RankingPanel)), 'dsh-model-value: panel')

      try {
        ctx.logger?.info?.('dsh-model-value client ready')
      } catch {
        /* logging must never break the bundle */
      }
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
