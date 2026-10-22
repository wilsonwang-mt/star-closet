# SEEN. 路演 Slides（我是主理人 2026）

2026-10-17 比赛路演用的交互式 HTML Slides，17 页。替代 `docs/presentation/` 里的 v0.3 方案稿作为路演 deck；v0.3 保留为方案资料。

- 线上地址：<https://seen-pitch.vercel.app>（Vercel 项目 `seen-pitch`，静态单文件，无需登录）。重新发布：在一个只放 `index.html` 的空目录里运行 `vercel link --project seen-pitch --yes`，再 `vercel deploy --prod --yes`。
- `index.html`：构建产物，单文件，图片、标识与 Live 视频都已内联，可直接用浏览器打开。
- `deck.html`：源文件，素材用占位符引用仓库里的文件。
- `build.py`：把占位符内联生成 `index.html`（需要 Pillow）。改完 `deck.html` 后在仓库根目录运行 `python3 docs/pitch/build.py`。
- `assets/`：从本机演示站（未登录状态，手机宽度 390）截取的产品截图，以及 `qa/screenshots/` 里试穿结果的裁切。对话截图面板标题处应用仍残留旧名“Ask Star Closet”，截图里已改为“Ask Seen”（应用本身待改）。

## 操作

- 桌面：← → / 空格 / PageUp PageDown 翻页，Home End 首尾页，F 全屏；地址栏 `#页码` 可直接跳页。
- 手机：左右滑动或右下角按钮翻页，单页内容超出时上下滚动。

## 叙事

封面 → 痛点（钩子、三道坎）→ 解决方案 → 谁是穿搭主理人 → 体验全程 → 走进衣橱 → 一句话改编 → 悬浮 AI 对话 → 穿在我身上 → 试衣间 → 穿搭主理人与 Agent 建橱 → 商业模式 → 智能试衣镜（即将发布的硬件）→ 目前进度 → 下一步与需要的支持 → 结尾。

## 内容依据

- 衣橱、搭配、单品数量：`app/data/catalog.json`（10 / 60 / 209）。
- 一句话改编 ¥3,084 → ¥758：`qa/报告.md` 中 O01 用“预算 800 以内，户外婚礼，换成平底鞋”的实测结果（截图 `qa/screenshots/b01-adapt-wedding.jpg`）。
- 悬浮对话约 2 秒开始回答：交付记录 D66 实测首字 1.9–2.3 秒。
- 一键试穿约 20 秒出图、试穿单价：`app/README.md` 与交付记录 D65（可灵 Kolors 约 0.07 美元/张 + nano 细化约 0.15 美元）。
- 商业模式只写收入结构，不写费率：费率未定，`docs/商业模式与平台运营.md` §10 的百分比是算术示例。
- Agent 建橱、站内下单、合身参考、拍一下就试列在“下一步”，尚未实现。
- 提交数与测试数：`git rev-list --count` 194（2026-10-17 04:00），`npm test` 184 项（交付记录 2026-10-17）。

画面中的模特（f01）与主理人头像都是 AI 生成的虚构人物，没有使用任何真人照片。
- 应用内子页面：同一文件复制为 `app/public/pitch.html`，随应用部署在 Seen 网站的 `/pitch.html`（应用项目开着访问保护时需登录 Vercel 才能看）。改 deck 后两处都要更新。
