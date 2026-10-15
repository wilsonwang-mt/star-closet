# AvatarViewer · 3D 形象查看器

客户端组件，显示一个可水平旋转的 GLB 形象。three.js 相关代码只在浏览器端按需加载（`next/dynamic`，`ssr: false`），不进首屏包；服务端渲染时只输出容器、徽章和海报。

```tsx
import AvatarViewer from "@/components/AvatarViewer";

<AvatarViewer
  src="/models/mannequin.glb"
  badges={["AI 生成", "合身未验证"]}
  poster="/models/mannequin-poster.png" // 可选
  height={460}
/>
```

可以直接在服务端组件里使用（组件文件自带 `"use client"`）。

## Props

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `src` | `string` | 是 | GLB 地址。同源，或对方允许跨域。换 `src` 会整体重建查看器并重新加载。 |
| `badges` | `string[]` | 是 | 左上角常驻徽章（`.sc-badge`），任何状态下都显示，可传空数组。AI 生成的形象应至少带“AI 生成”。 |
| `poster` | `string` | 否 | 降级时显示的静态图。没有时显示文字说明。 |
| `height` | `number \| string` | 否 | 容器高度，数字按 px，默认 `420`。宽度占满父元素。 |
| `label` | `string` | 否 | 无障碍描述，默认“可旋转的 3D 形象”。 |

## 行为

- 取景：模型按包围盒缩放到统一高度，水平居中，脚底落在地面；相机固定，所以不同来源的模型取景一致。
- 交互：只能水平 360° 拖动旋转、适度缩放；平移关闭，俯仰角锁定。
- 光照：环境光 + 半球光 + 暖色主光 + 香槟色轮廓光，地面接触阴影。没有使用 drei 的 `Environment`/`Stage` 预设（它们会在运行时从外部 CDN 拉 HDR）。
- 背景透明，深浅模式都直接叠在页面底色上。
- 进场：模型从上方受重力下落、回弹一次后静止（0.9 秒内），之后缓慢自转；用户一拖动就停止自转，不再恢复。

## 状态与降级

| 情况 | 显示 |
| --- | --- |
| 首屏 / 服务端渲染 | `poster`（有的话）+ 徽章 |
| 查看器脚本加载中 | “正在准备 3D 查看器…” |
| 模型下载中 | 加载百分比；服务端没给文件大小时只显示“正在加载 3D 形象…” |
| 加载失败（404、解析失败、WebGL 上下文创建失败） | 说明文字 +“重试”按钮；重试会清掉该地址的缓存后重新请求 |
| 浏览器不支持 WebGL | `poster` 或文字说明，不加载 three.js |
| 开启“减弱动态效果” | `poster` 或文字说明，另有“查看 3D（无动画）”按钮；打开后没有下落和自转，仍可拖动 |

## 限制

- 只支持普通 GLB/glTF。Draco / Meshopt 压缩的模型暂不支持（需要额外解码器，Draco 解码器默认从外部 CDN 加载，未开启）。
- 模型自带的骨骼动画不会播放，只显示静止姿态。
- 示例模型 `public/models/mannequin.glb` 是用几何原语合成的人台，不代表任何真实人物，来源与许可见 `public/models/LICENSE.md`。

## 文件

- `components/AvatarViewer.tsx`：对外入口，负责徽章、降级判断和动态加载。
- `components/avatar-viewer/Viewer.tsx`：Canvas、灯光、控制器、模型加载与进场动画。
- `components/avatar-viewer/ErrorBoundary.tsx`：接住加载与 WebGL 错误，提供重试。
- `components/avatar-viewer/AvatarViewer.module.css`：布局样式（颜色取自 `app/tokens.css`）。
