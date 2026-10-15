# 视觉方向 v0.4 · 进行中

2026-10-15 晚（UTC+8）。项目 Owner（Claude Code）与发起用户讨论视觉风格的中间记录，**尚未定稿**，定稿后再写入设计探索与决策记录。

## 已确认的用户意见

- 关键词：安静高级、影棚柔光、米白羊皮纸、香槟金点缀、磨砂玻璃、细线无衬线、画廊留白、卡片浮层、缓慢淡入、灯光扫过、镜头推进；隐喻是美术馆、时装杂志、私人衣帽间。
- 香槟金暖光作为基调，与米黄互相烘托。
- 玻璃参考 Apple Liquid Glass，要更通透、更轻盈，避免细节干扰主体。
- 需要 Light / Dark 双模式：浅色为“米白美术馆”，深色延续早期 v0.3 规划（深石墨 `#0B0F14`、暖白文字、香槟金按钮、浅色陈列块）。
- v2 华丽程度“差不多 OK”；金边拱门、光束、微尘要保留并加强。
- 字体排版要更有杂志感；动效要更有重力感和电影场景的真实感。
- 占位衣服太假，用户同意用 Weave（Weavy）额度生成真实商品图。

## 文件

- [米白美术馆样稿v2.html](米白美术馆样稿v2.html)：Liquid Glass + 香槟金，装饰最丰富的一版。
- [米白美术馆样稿v3.html](米白美术馆样稿v3.html)：更通透的玻璃，浅色 / 深色双模式对比（深色排由脚本克隆生成）。
- [米白美术馆样稿v4.html](米白美术馆样稿v4.html)：真实商品图、杂志排版（Bodoni 刊头、思源宋体、N° 编号、竖排图注）、重力进场与阻尼摆动、镜头推近与景深、光束内微尘、胶片颗粒，浅色 / 深色双模式。
- [电影感样稿v5.html](电影感样稿v5.html)：**当前待定稿版本**。用户反馈 v4（米白美术馆）离“电影感、高端”仍有差距；v5 改为界面浮在 AI 生成的统一打光电影画面上，带推镜、光束微尘、胶片颗粒、粉丝打赏礼物动效，第三屏为生活场景试穿示意。
- `keyframes/`：4 张 Weave 生成的电影感关键帧（夜间竖屏、日间竖屏、夜间横屏、咖啡馆生活场景），约 44 积分；人物为虚构 AI 生成。
- `img/`：6 张去背景商品图（AI 生成示意，非真实品牌或在售商品），已缩放到最长边 900px 并裁边。
- 参考板与 Refero 参考截图只存本地 `.local/visual-refs/`（第三方截图，不入库）。

## 已生成的商品图（Weave，Nano Banana Pro + Bria 去背景）

共花费约 70 积分（6 × 11 + 6 × 0.6）。均为 AI 生成的示意商品，不代表任何真实品牌或在售商品。

| 单品 | 去背景 PNG | 原图 |
| --- | --- | --- |
| 米白针织开衫 | https://media.weavy.ai/image/upload/v1792060575/uploads/TKmZ7BkDX7Uvrg6TT2XmWNFfUMI2/j6ixptrf5agx9u4u5i9j.png | https://media.weavy.ai/image/upload/v1792060497/uploads/TKmZ7BkDX7Uvrg6TT2XmWNFfUMI2/kcmflmezj6me16xza7a4.png |
| 浅蓝直筒牛仔裤 | https://media.weavy.ai/image/upload/v1792060584/uploads/TKmZ7BkDX7Uvrg6TT2XmWNFfUMI2/lvtfnwqmj9f3zjdxwjcn.png | https://media.weavy.ai/image/upload/v1792060501/uploads/TKmZ7BkDX7Uvrg6TT2XmWNFfUMI2/yria2b5ffeehhusend58.png |
| 浅棕麂皮乐福鞋 | https://media.weavy.ai/image/upload/v1792060593/uploads/TKmZ7BkDX7Uvrg6TT2XmWNFfUMI2/mq5uk5u76ys1fgrcnue5.png | https://media.weavy.ai/image/upload/v1792060506/uploads/TKmZ7BkDX7Uvrg6TT2XmWNFfUMI2/rstinwrkoy4ghpohlvxd.png |
| 燕麦帆布托特 | https://media.weavy.ai/image/upload/v1792060595/uploads/TKmZ7BkDX7Uvrg6TT2XmWNFfUMI2/l8mja3nfrpgplfknvhqt.png | https://media.weavy.ai/image/upload/v1792060510/uploads/TKmZ7BkDX7Uvrg6TT2XmWNFfUMI2/rqd5vbm6fhlpehgymmlo.png |
| 燕麦亚麻阔腿裤 | https://media.weavy.ai/image/upload/v1792060604/uploads/TKmZ7BkDX7Uvrg6TT2XmWNFfUMI2/umcybip1dellrrwrwxju.png | https://media.weavy.ai/image/upload/v1792060519/uploads/TKmZ7BkDX7Uvrg6TT2XmWNFfUMI2/ls5avgydkxxbewy4iybn.png |
| 驼色平底玛丽珍 | https://media.weavy.ai/image/upload/v1792060637/uploads/TKmZ7BkDX7Uvrg6TT2XmWNFfUMI2/eqg9lzbom4kptrmbugas.png | https://media.weavy.ai/image/upload/v1792060534/uploads/TKmZ7BkDX7Uvrg6TT2XmWNFfUMI2/vorgrgxttjv88q39hu65.png |

已下载到 `img/` 并人工检查：面料纹理真实，抠图边缘干净。

## 下一步（v4 样稿）

1. 下载并检查 6 张商品图，替换占位衣服。
2. 加强金边拱门、光束、微尘；玻璃保持通透轻盈。
3. 杂志感排版：高对比衬线标题（中文思源宋体，数字/拉丁 Bodoni 类刊头字体）、N°01 编号、细线分栏、小号大写标签。
4. 重力与电影感：衣架挂点摆动、下落回弹进场、镜头缓推与景深、光束内浮尘、淡胶片颗粒。
5. 浅色 / 深色双排对比，交用户定稿；定稿后再开始应用核心层界面。
6. 评估用 Higgsfield 生成首页背景视频与演示视频开场镜头。
