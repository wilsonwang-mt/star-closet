# Star Closet 比赛版应用

手机优先的 Next.js（App Router）+ TypeScript 网站。授权范围见仓库根目录 [AGENTS.md](../AGENTS.md)；部署未获授权，目前只在本机运行。

## 已有功能

核心路径：首页选一间衣橱 → 走进 `/closet/[id]` → 点一套搭配进入 `/outfit/[id]` → 一句话改编 → 加入试衣间 → 外链到商家页面。目录 v0.2 共 10 间衣橱、60 套搭配、209 件单品（主理人与品牌均为虚构示例，图片与视频为 AI 生成示意，价格为参考价），来源 `data/catalog.json`，数据层 `lib/catalog.ts`。

- 首页“走进谁的衣橱”（`components/home/ClosetCarousel.tsx`）：10 间衣橱排成浅弧形立体轮播，每张卡的远近、转向、缩放、模糊与变暗随离中心的距离连续变化。拖拽跟手（竖向手势交给页面滚动），松手按速度弹簧吸附，可随时打断；键盘左右键 / Home / End、底部按钮、触控板横滑、点侧卡都能切换。只播放中央那一间的视频（窄屏竖版视频，宽屏 `cover_wide` 静态图慢推），侧卡显示海报。头像、衣橱名、tagline 与“走进衣橱”在透视层之外，始终正面。可按性别（女装 / 男装 / 中性）与入驻方类型筛选，下方有全部衣橱索引。当前选中的一间记在 `?c=` 与 sessionStorage，返回时回到原处。tagline、头像、封面、视频为空时有兜底（`components/closet/data.ts`）。
- 衣橱页 `/closet/[id]`（`components/closet/ClosetExperience.tsx`）：全屏场景（视频 + 海报兜底）随滚动缓推、压暗，衣橱信息与搭配卡依次浮起（CSS scroll-driven animations，不支持时用 Motion `useScroll`）。搭配页的“返回衣橱”回到对应衣橱并定位到该搭配。
- 走进衣橱过渡（`components/closet/transition.ts`）：View Transitions 包住路由跳转，中央预览弹簧放大成衣橱页全屏场景（约 925ms），返回时反向收回；跳转前把正在播放的视频定格成一帧交给下一页并从同一时刻续播。不支持 View Transitions 的浏览器（如 Firefox）用 Motion 覆盖层模拟，这条路径只有代码、未实测。新页面就绪超过 700ms 时跳过 View Transition，改走覆盖层。
- 一句话改编：文字或语音（浏览器 Web Speech API）说出预算、场合或想换的单品，在目录内改编成一整套。
  - 配置了 `ANTHROPIC_API_KEY`：调用 Claude（`claude-opus-5-5`，effort `low`，结构化输出）。
  - 没有 key 或调用失败：规则模式，界面标注“非 AI · 规则模式”。
  - 候选池（`lib/adapt/rules.ts`）：同性别 + 中性单品，同衣橱优先；只把相关类目送进提示词与规则模式；叠穿搭配上装最多 2 件，配饰沿用原搭配件数（最多 2），其余每类 1 件；说了尺码才按尺码过滤。AI、规则模式、服务端校验与逐件替换共用这套规则。
  - 规则模式：“不要皮革”等排除词按同义展开并硬过滤，找不到替代时保留原款并如实说明；“去掉了…”的说明由服务端按原搭配与结果的实际差异生成（`lib/adapt/finalize.ts`）。结果与原搭配相同或没听懂时显示提示态，不提供保存。
  - 服务端校验所有单品都在目录内并去重；总价和是否超预算由服务端计算，不采用模型给出的数字。
  - 改编动效：等待卡列出当前这一套并有光束扫过（至少停留 0.9s），结果出现时被换掉的单品淡出、新单品从上方落入回弹，总价滚动到新值。
  - 改编结果可以逐件替换为同类单品。
- 账号：邮箱 + 密码注册/登录/退出（better-auth），登录与注册错误按错误码显示中文。退出登录在导航里（手机在菜单面板底部，桌面点首字母圆钮打开账号面板），`/profile` 底部也保留一个。
- 导航（`components/SiteNav.tsx`）：顶部悬浮玻璃胶囊（视觉规范 §6.1）。左侧 STAR CLOSET 刊头字；桌面直接排列 衣橱 / 试衣间 / 我的档案（未登录为“登录”）与主题切换；手机（<640px）把链接收进圆形菜单按钮，展开为玻璃下拉面板。向下滚动累计超过 8px 收起，向上滚动、回到顶部或键盘焦点进入时出现，首次加载先显示 2 秒；菜单打开时不收起。在 `/`、`/closet/*`、`/outfit/*` 高亮“衣橱”。
- 个人档案（`/profile`）：昵称、简介、城市、风格与颜色标签、尺码、预算；身高体重须单独勾选同意才保存，可一键清除。只有本人可读写，可见性固定为私密。
- 个人试衣间：登录后保存原搭配或改编版本；勾选单品生成购物清单，外链到商家页面购买。

- 动效（视觉规范 §7.1）：弹簧参数统一在 `lib/motion.ts`（含给 CSS 用的 `linear()` 采样），动效库为 `motion` 14.3.0；只动 transform / opacity / filter，可打断。开启“减弱动态效果”时全部降级为淡入淡出、不播放视频。减弱动态只按 CSS 规则审过，60fps 未在真机测量。
- 404：全局、衣橱、搭配各有中文 404 页。已知问题：衣橱页与搭配页有 `loading.tsx`，页面是流式输出的，`/closet/不存在` 与 `/outfit/不存在` 显示正确的 404 文案，但 HTTP 状态是 200（带 `noindex`）；未匹配任何路由的地址仍返回 404。
- 视觉：按 [视觉规范 v5](../docs/design/visual-v04/视觉规范.md)。`app/tokens.css` 复制自 `docs/design/visual-v04/tokens.css`，改动先改源文件再同步；场景图在 `public/scenes/`。深色默认，可切换浅色或跟随系统（cookie `sc-theme`）。

尚未接入：2D 试穿、单品可旋转 GLB、打赏、站内支付。场景视频（`public/scenes/*-web.mp4`）只加载并播放当前显示的那一段，减弱动态时只显示首帧。试衣间里的咖啡馆生活场景只是标注了“AI 生成场景示意 · 合身未验证”的示意图。

## 3D 形象

入口 `/profile/avatar`（登录后，档案页底部也有入口）。流程：同意卡 → 上传三张全身照 → 生成 → 查看 → 删除。存储与第三方处理规则见 AGENTS.md「2026-10-16 个人影像存储决定」（D47）。

- 同意卡分两项：(a) 同意上传并存储本人照片用于生成 3D 形象（必选）；(b) 同意把照片发送给 fal.ai（Tripo 3D）处理——只在配置了真实服务 key 时出现，可选，不勾选只能生成示意模型，之后可在“修改授权”里改。`avatar_job.consent_version` 同时记录两项：`avatar-consent-v2:store` 或 `avatar-consent-v2:store+tripo_fal`（旧版 v1 同意失效，需重新确认）。提交时带上卡片版本（`offerVersion`），处理方变了会要求刷新重读。
- 照片：只收正面 / 侧面 / 背面三张全身照。面部特写与补充照片不参与生成，已不再收集（以前上传的仍可查看、删除）。浏览器端压缩到最长边 1600px 并重新编码为 JPEG；服务端在解析前限制请求体（8MB + 表单开销，按实际读取字节计，覆盖 chunked 与谎报长度），再剥离元数据后存储（`lib/avatar/strip.ts`：JPEG 去 EXIF/GPS/XMP/IPTC/注释，PNG 只留图像与色彩块，WebP 去 EXIF/XMP；EXIF 里非默认的方向会写回一个只含方向的最小 EXIF，其余字段不保留）。按文件头识别 JPG/PNG/WebP，质量提示写入 `quality_flags`。
- 生成：示意模式需要正面 + 侧面或背面；真实服务需要正面 + 侧面（背面可选）。`avatar_job` 状态 draft → queued → processing → succeeded / failed，可取消、可重试。前端每 2 秒轮询 `GET /api/avatar/jobs/[id]`，每次查询推进一步。外部任务编号与状态地址存在 `provider_task_id / provider_status_url`，服务重启后可继续轮询。重新生成成功后删除旧的 GLB。
- 生成服务（`lib/avatar/providers.ts`）：
  - `mock`（默认）：不访问外部网络，约 3 秒后返回程序生成的通用人台，徽章“非本人示意模型”。
  - `tripo_fal`：`AVATAR3D_PROVIDER=tripo_fal` + `FAL_KEY` 且用户勾选了 (b) 才使用，调用 fal.ai 托管的 Tripo H3.1 Multiview-to-3D，只发送三张全身照，请求头带 `X-Fal-Store-IO: 0`；徽章“AI 生成 3D 形象 · 还原度未验证”。未实测（没有 key）。
  - 两种模式都显示“合身：未验证”。Meshy 备选适配器未实现。
- 第三方副本删除：真实服务的任务结束并把 GLB 转存到本站后，调用 fal Platform API `DELETE https://api.fal.ai/v1/models/requests/<request_id>/payloads` 删除该请求的 payload 与输出文件；删除单个形象、一键删除、取消时也会请求。结果写回 `provider_status_url`（`remote-purge:sent|failed|pending:<时间>`），界面显示“第三方副本删除请求已发送 / 失败”；失败和“任务未结束”由 `npm run avatar:purge` 重试。没有 key 时不发任何外部请求。注意：fal 文档说明请求输入里的 CDN 文件不会被删除，本站不把照片上传到 fal 存储（Supabase 用 15 分钟签名 URL，本地开发用内联 data URI）；fal 侧是否仍有不可删副本未核实。该接口要求 key 具备相应权限，未实测。
- 30 天删除：生成成功时给本次用到的照片写 `avatar_photo.expires_at = 成功时间 + 30 天`（已有期限不延后）。执行方式两种：
  - `npm run avatar:purge`（`scripts/purge-avatars.ts`）：清理全部用户的到期照片（删存储文件并软删除记录），并重试第三方副本删除；只输出计数。需要由运营方用定时任务每天调用，例如 `0 4 * * * cd /path/to/app && npm run avatar:purge`。比赛版本机演示**没有**配置定时任务。本地 PGlite 只允许一个进程打开，运行前先停掉开发服务器。
  - 惰性清理：打开 `/profile/avatar` 时清理本人的到期照片。旧数据没有 `expires_at` 的，按用过它的成功作业的完成时间补写。
- 存储（`lib/storage/`）：设置 `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` 时用 Supabase Storage 私有桶 `avatar-private`（建桶见 `supabase/storage.sql`，需发起用户手动执行），否则写本地 `.data/uploads/<userId>/`。浏览器只能经 `GET /api/avatar/files/<key>` 读取本人文件，他人请求一律 404。
- 删除：单张照片可删；单个形象可删（保留照片与同意）；“一键删除”清空该用户存储前缀下全部文件，照片软删除、作业标记 canceled，之后需重新同意。
- 查看器：入口 `components/AvatarViewer.tsx`，实现在 `components/avatar-viewer/`（R3F，可拖动旋转；props `{ src, badges, poster?, height?, label?, showReset?, onReset? }`，说明见 `components/AvatarViewer.README.md`）。转动或缩放后右下角浮出“复位视角”，弹簧动画回到正面，可随时被拖动打断；减弱动态时直接跳回。`showReset` 默认 true，传 false 可隐藏。
- mock 人台由 `lib/avatar/mannequin.ts` 程序生成（即 `public/models/mock-mannequin.glb`），来源与许可见 `public/models/LICENSE.md`；没有使用任何真人照片、扫描或第三方模型。
- 测试：`npm test`（node:test + tsx）覆盖元数据剥离、到期清理与规则模式改编回归（`lib/adapt/offline.test.ts`，直接读 `data/catalog.json`）；测试图全部由代码生成。

API：`GET|DELETE /api/avatar`、`POST /api/avatar/consent`（`{ store, thirdParty, offerVersion }`）、`POST /api/avatar/photos`（multipart：slot、file）、`DELETE /api/avatar/photos/[id]`、`POST /api/avatar/jobs`、`GET|DELETE /api/avatar/jobs/[id]`、`DELETE /api/avatar/jobs/[id]/result`、`GET /api/avatar/files/[...key]`。

## 数据库

表结构只有一份：`lib/db/schema.ts`（Drizzle），迁移在 `drizzle/`。

- 设置了 `DATABASE_URL`：连接发起用户的 Supabase Postgres（`postgres` 驱动，已关闭预备语句以兼容 transaction pooler）。首次写入后需在 Supabase SQL Editor 执行一次 `supabase/rls.sql`，为所有表开启 RLS。
- 没有设置：使用本地内嵌 Postgres（PGlite），数据在 `.data/`，不进仓库。PGlite 同一时间只允许一个进程打开；请用 Ctrl+C 正常停止开发服务器，强制结束进程可能损坏本地数据，届时删除 `.data/pglite` 重新执行 `npm run db:setup` 即可。

商品目录来源是 `data/catalog.json`（格式同 [商品目录模板](../docs/supply/商品目录模板.md)），由 `npm run db:setup` 校验后写入数据库，可重复执行。

## 本地运行

以下步骤在 2026-10-16 实际跑通（本地 PGlite、规则模式；目录 v0.2 下 `npm run db:setup` 输出“已写入 209 件单品、60 套搭配”）：

```bash
cd app
npm install
cp .env.example .env.local   # 至少填 BETTER_AUTH_SECRET：openssl rand -base64 32
npm run db:setup
npm run dev                  # http://localhost:3000
```

检查：`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`。没有 `.env.local` 时构建会因 better-auth 默认密钥打印报错（退出码仍为 0），可在命令行临时设置 `BETTER_AUTH_SECRET` 再构建。

### 在 Supabase 上需要执行的步骤（发起用户本人操作）

目录 v0.2、个人档案与 3D 形象之后，据各开发会话的记录，以下步骤都还没有在发起用户的 Supabase 上执行过（这些会话只用本地 PGlite，没有连接用户的 Supabase）：

1. `.env.local` 设置 `DATABASE_URL`（transaction pooler 即可）；迁移需要会话模式连接，可另设 `DATABASE_MIGRATE_URL`（5432 端口）。
2. 运行 `npm run db:setup`：按顺序执行迁移 0001（profile / avatar_photo / avatar_job）与 0002（目录 v0.2 字段、`avatar_photo.expires_at`、外部任务字段），再写入目录 v0.2。衣橱、搭配、单品都做 upsert，搭配与单品的对应关系整体重写；不删除旧行（试衣间引用单品编号），所以 v0.1 中编号不再使用的旧单品会留在库里。
3. 在 SQL Editor 再执行一次 `supabase/rls.sql`，为新表开启 RLS 并收回 Data API 权限。
4. 如需把照片和 GLB 存到 Supabase：在 SQL Editor 执行 `supabase/storage.sql` 建私有桶 `avatar-private`，并在 `.env.local` 设置 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY`（只在服务端使用）。两项都有才启用，否则仍写本地 `.data/uploads/`。
5. 每天运行一次 `npm run avatar:purge` 的定时任务（见上文“30 天删除”）。

可选：`ANTHROPIC_API_KEY`（AI 改编）；`AVATAR3D_PROVIDER=tripo_fal` + `FAL_KEY`（真实 3D 生成，未实测）。

### 2026-10-16 早先的 Supabase 实测（目录 v0.1）

2026-10-16 已在发起用户的 Supabase 项目（新加坡区）实测：
- `npm run db:setup` 建表并写入 37 件单品、7 套搭配；`supabase/rls.sql` 已执行。目录四表对 anon 只读，账号与试衣间表对 Data API 无任何权限；Supabase 安全顾问只剩“已开 RLS 但无策略”的 INFO，这是有意的拒绝全部。
- 注册 → AI 改编 → 加入试衣间：用户、会话与试衣间数据写入 Supabase，试衣间页从库里读回。
- AI 改编（`claude-opus-5-5`，effort `low`）单次耗时约 10–13 秒。发起用户 2026-10-16 决定保持模型与速度，只加等待动画（`components/AdaptWaiting.tsx`）。

连接串注意：把 `[YOUR-PASSWORD]` 整体（含方括号）换成密码；密码含 `@ # / ? %` 等字符需先做百分号编码。

## 说明

- Claude 调用暂未开启服务端拒答回退（`fallbacks`），选品场景收益小；如需开启需改走 beta 接口。
- key、数据库连接串只放 `.env.local`，不提交、不打印到日志。
