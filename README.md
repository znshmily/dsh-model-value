# dsh-model-value

当前接入模型的**单价、智力、性价比**排行，长在选模型的地方：模型菜单顶部给出推荐行（末行可打开完整排行面板），另外给 Agent 一个 `model_value_rank` 工具。

- 价格与智力分随插件附带快照（USD / 1M tokens，Artificial Analysis Intelligence Index），**509 条价格键、176 个模型有分**（155 个 AA 实测 + 21 个按 HLE 折算，界面带 `≈`）。数据由 `tools/sync-sources.mjs` 从 [aiapiindex.com](https://aiapiindex.com) 公开镜像同步（AA 榜单 + OpenRouter 全量报价，CC BY 4.0），`tools/fill-gaps.mjs` 补齐镜像还没跟上的新模型。可在设置里手填覆盖，也能定时从 OpenRouter 拉最新报价。
- 排名算法在 Host 侧完成，客户端只渲染；同一个接口 `/dsh-model-value/api/rank` 同时服务面板与工具。
- 排行面板**共用一个滚动容器、分两块**：① **全部模型**——已接入的渠道实例与未接入的市面模型放在同一张表里、用同一套 `allRank` 名次（列头「全部排名」），默认「范围 = 全部」，标题条上的三个胶囊可以只看「已接入」或只看「未接入」（未接入的行没有勾选框，带「未接入」小胶囊；范围选「未接入」时整个列表都是未接入的，胶囊自动隐藏）；② **按提供方分组排名**——始终只列已接入的渠道，用组内名次（列头「组内排名」）。**两种名次都常驻显示**：排名列一个、模型名后面的胶囊一个（「已接入第 N」/「全部第 N」），不用悬停也能对照。每行的模型格是两行：第一行名字 + 胶囊，第二行灰字 **`提供方/模型ID`**（Comate 那种 `proxy_<hash>` 也照原样写出来，不再藏在 tooltip 里），可以选中复制。面板支持**按名搜索（只高亮不过滤，右侧显示匹配行数）**，每行还有一个**复制模型名**的按钮。两块各有吸顶表头，分组头也吸顶；只画同时有价格和智力分的模型，免费/缺分/缺价的只在表头统计个数。未接入的模型接入后下次刷新自动移到分组里。
- 排行面板每行可**按渠道勾选**模型（同一模型多接入各算一行，勾一个不连带其他渠道）；勾选的模型全部追加在模型菜单 Top 3 之后（带 ★，列表高度固定约 4 行，超出在块内滚动并提示「共 N 行」），未勾选时菜单就是 Top 3 推荐；清单持久化在插件 host 端 `state.json`，全局生效。菜单每一行只有**名次 + 完整模型名 + 提供方**（`commandcode`，同一模型多渠道时是 `comate ×2`）——名字换行显示不截断，整个菜单没有 tooltip；价格与智力在排行面板里看。
- 只使用 `--dsw-alias-*` 主题令牌，不引入任何 Harness 客户端包。明暗主题都做了适配：强调色只用来**调色**（`color-mix` 半透明着色），从不做"实心品牌色 + 固定白字"的底色；勾选框自己画（原生 checkbox 在深色页面会画成白方块），所以任何主题下都不会出现白底白字或白框。

完整说明见 [docs/DETAIL.md](docs/DETAIL.md)。

## 开发

```bash
node test/units.mjs      # 键匹配、加权单价、排序分组、组内排名、市面块、payload、pins、工具与切换接口
node test/client.mjs     # 无头渲染真实的 client bundle（12 个场景）
node --check index.js && node --check client.js
```

数据文件在 `data/prices.json`、`data/intelligence.json`；`tools/seed-market.mjs` 是补市面模型数据的一次性生成脚本（改完跑一次，两个 JSON 会按 key 排序重写）；`tools/preview.py` 用和样式表相同的几何画出 `docs/preview.svg`，`tools/preview_menu.py` 画出输入框菜单预览——两者都接受一个 PNG 输出路径参数；`assets/screenshot-*.png` 由这两个脚本生成，`screenshots.json` 把它们声明给插件市场；`tools/make_icon.py` 按 `icon.svg` 的同一份几何画出市场卡片要的位图 `assets/icon-180.png`（市场只收 GitHub 托管的 png/jpg/webp，不收 svg）；`vendor/` 里是随包携带的 Schemastery（裸导入 `@deepseek-ai/schemastery` 在 profile 外无法解析）。

## 安装

从 marketplace / 命令行装（推荐）：

```sh
dsh plugin add dsh-model-value                                      # npm 包
dsh plugin add github:znshmily/dsh-model-value                      # GitHub 源
```

在 DSH 里用插件管理器装本地目录（开发时用；不要手改 profile 的 `package.json` / `cordis.patch.yml`）：

```
plugin_manager install_bundle <path-to-this-directory>
```

安装后重启会话/刷新页面：模型菜单（`/model`）里出现"★ 性价比 Top 3"，最后一行"查看完整排行"进入明细表。

## 许可证

MIT © [znshmily](https://github.com/znshmily)。见 [LICENSE](./LICENSE)。
