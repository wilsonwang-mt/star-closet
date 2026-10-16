# Star Closet 比赛版应用

手机优先的 Next.js（App Router）+ TypeScript 网站。授权范围见仓库根目录 [AGENTS.md](../AGENTS.md)；部署未获授权，目前只在本机运行。

## 已有功能

核心路径：首页选一间衣橱 → 走进 `/closet/[id]` → 点一套搭配进入 `/outfit/[id]` → 一句话改编 → 加入试衣间 → 外链到商家页面。目录 v0.2 共 10 间衣橱、60 套搭配、209 件单品（主理人与品牌均为虚构示例，图片与视频为 AI 生成示意，价格为参考价），来源 `data/catalog.json`，数据层 `lib/catalog.ts`。

- 首页“走进谁的衣橱”（`components/home/ClosetCarousel.tsx`）：10 间衣橱排成浅弧形立体轮播，每张卡的远近、转向、缩放、模糊与变暗随离中心的距离连续变化。拖拽跟手（竖向手势交给页面滚动），松手按速度弹簧吸附，可随时打断；键盘左右键 / Home / End、底部按钮、触控板横滑、点侧卡都能切换。只播放中央那一间的视频（窄屏竖版视频，宽屏 `cover_wide` 静态图慢推），侧卡显示海报。头像、衣橱名、tagline 与“走进衣橱”在透视层之外，始终正面。下方有全部衣橱索引，可按性别（女装 / 男装 / 中性）与入驻方类型筛选：桌面筛选在标题右侧，手机（<900px）为了把首屏留给轮播放在索引区头部（D51）。当前选中的一间记在 `?c=` 与 sessionStorage，返回时回到原处。tagline、头像、封面、视频为空时有兜底（`components/closet/data.ts`）。
- 衣橱页 `/closet/[id]`（`components/closet/ClosetExperience.tsx`）：全屏场景（视频 + 海报兜底）随滚动缓推、压暗，衣橱信息与搭配卡依次浮起（CSS scroll-driven animations，不支持时用 Motion `useScroll`）。搭配页的“返回衣橱”回到对应衣橱并定位到该搭配。
- 走进衣橱过渡（`components/closet/transition.ts`）：View Transitions 包住路由跳转，中央预览弹簧放大成衣橱页全屏场景（约 925ms），返回时反向收回；跳转前把正在播放的视频定格成一帧交给下一页并从同一时刻续播。不支持 View Transitions 的浏览器（如 Firefox）用 Motion 覆盖层模拟，这条路径只有代码、未实测。新页面就绪超过 700ms 时跳过 View Transition，改走覆盖层。
- 一句话改编：文字或语音（浏览器 Web Speech API）说出预算、场合或想换的单品，在目录内改编成一整套。
  - 配置了 `ANTHROPIC_API_KEY`：调用 Claude（`claude-opus-5-5`，effort `low`，结构化输出）。
  - 没有 key 或调用失败：后台回退到规则模式，界面不单独标注（D48）。
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
- 字体：正文为自托管的思源黑体 Light 300 子集（`public/fonts/`、`app/fonts.css`，许可 `public/fonts/OFL.txt`，D50）。新增大量文案或目录后运行 `npm run fonts:build -- <NotoSansSC[wght].ttf 路径>`（需 `python3 -m pip install fonttools brotli`）重新生成；Bodoni Moda 与思源宋体仍由 next/font 从 Google 获取，构建需要网络。
- 视觉：按 [视觉规范 v5](../docs/design/visual-v04/视觉规范.md)。`app/tokens.css` 复制自 `docs/design/visual-v04/tokens.css`，改动先改源文件再同步；场景图在 `public/scenes/`。深色默认，可切换浅色或跟随系统（cookie `sc-theme`）。

尚未接入：单品可旋转 GLB、打赏、站内支付。场景视频（`public/scenes/*-web.mp4`）只加载并播放当前显示的那一段，减弱动态时只显示首帧。试衣间里的咖啡馆生活场景只是标注了“AI 生成场景示意 · 合身未验证”的示意图。

## 悬浮对话（D56）

全站右下角的圆形入口（首页标题旁还有一枚「说场合和预算」引导胶囊），说出场合、风格、预算、性别或想像谁，对话里直接出卡片：衣橱卡 → `/closet/[id]`，搭配卡 → `/outfit/[id]`，功能卡 → 试衣间、3D 形象、2D 试穿（有 `FAL_KEY` 才出现）、档案、登录。手机是底部抽屉，桌面是右下角浮窗；对话存在 sessionStorage，路由切换与刷新都不丢；遇到吸底操作条（`.cta-bar`）时，手机上入口停靠进操作条右侧、成为主按钮旁的圆形次按钮（操作条加 `data-dock-reserve` 留位），其他会挡住入口的元素（`[data-dock-avoid]`）则把入口抬到它上方。

- 接口：`POST /api/chat` 返回 NDJSON 流。第一行是规则层结果（`lib/locate/core.ts`：像谁 / 风格 / 场合 / 性别 / 预算 / 否定六个信号，复用 `parseConstraints`、`allowedGenders`；目录快照在服务端内存缓存 5 分钟，根布局会提前读一次），本机实测首字节约 10ms；随后是 Claude 的流式文字，最后是它用工具（`show_outfits` / `show_closets` / `open_page` / `suggest_replies`）选出的卡片。工具只返回 id，服务端按目录与性别校验后才转成卡片。
- 模型：`claude-opus-5-5`，effort `low`，**fast mode**（`speed: "fast"`，beta `fast-mode-2026-02-01`，价格为标准 2 倍，Claude API 研究预览；2026-10-16 用户决定）；未开通或被限流且还没流出文字时自动用标准速度重试一次（标准速度下带服务端 `fallbacks: "default"`）。目录在系统提示里缓存。`CHAT_SPEED=standard` 关掉 fast，`CHAT_MODEL` 换模型。本机实测（2026-10-17，4 句样例）fast：4 句样例中 3 句首段文字 1.9–2.3 秒、整轮 2.6–3.2 秒（标准速度同 3 句 2.8–4.5 / 5.3–6.6 秒）；“暖一点的颜色”一句模型思考更久，fast 首字 9.5 秒、标准 10.7 秒。首字 15 秒、整轮 25 秒超时；没有 key、超时或出错时停在规则结果，不显示“规则模式”（D48）。
- 用户的话不落库，服务端日志只记错误类型。
- 测试：`lib/locate/locate.test.ts`（17 个样例，直接读 `data/catalog.json`）。

## 3D 形象

入口 `/profile/avatar`（登录后，档案页底部也有入口）。流程：同意卡 → 上传三张全身照 → 生成 → 查看 → 删除（MetaPerson 模式见下一小节）。存储与第三方处理规则见 AGENTS.md「2026-10-16 个人影像存储决定」（D47）。

### MetaPerson 模式（比赛版推荐，未实测）

`AVATAR3D_PROVIDER=metaperson` 且 `AVATARSDK_CLIENT_ID`、`AVATARSDK_CLIENT_SECRET` 都存在时启用（`lib/avatar/metaperson.ts`、`lib/avatar/metaperson-protocol.ts`），否则保持原来的 mock / tripo_fal 流程。没有真实 key，以下流程只有单元测试（mock fetch），尚未与 Avatar SDK 实测。

- 页面：同意卡两项都要勾（“保存我的 3D 形象”+ D47 要求的单独一项“由 MetaPerson 根据你的自拍生成本人形象”，`consent_version = avatar-consent-v2:store+metaperson`）→ 玻璃卡里嵌入 MetaPerson 创建器（手机 70dvh、桌面 640px，加载中显示人形骨架；视口宽 <768 用 `https://mobile.metaperson.avatarsdk.com/generator`，否则 `https://metaperson.avatarsdk.com/iframe.html`，`allow="fullscreen"`）→ 用户在创建器里上传自拍并生成 → 可导出时出现主按钮「保存为我的 3D 形象」→ 服务端导入成功后切换到金色玻璃查看器（360° 旋转，无徽章），可「重新生成」或删除。
- 前端事件（`app/profile/avatar/MetaPersonCreator.tsx`）：只处理当前 iframe、来源为上述两个 origin 且 `data.source === "metaperson_creator"` 的消息，回发时 targetOrigin 用该 origin。
  1. `metaperson_creator_loaded` → 依次发送 `{eventName:"authenticate", accessToken}`、`{eventName:"set_export_parameters", format:"glb", lod:2, textureProfile:"1K.jpg", useZip:false}`，桌面版再发 `{eventName:"set_ui_parameters", isExportButtonVisible:false}`（手机版字段未核实，不发）。令牌若晚于加载事件到达，到达后再补发。
  2. `authentication_status` 中 `isAuthenticated=false` → 显示错误。
  3. `action_availability_changed`（`actionName:"avatar_export"`）决定主按钮是否可点；从未收到该事件时，以 `model_generated` 为准（兼容手机版）。
  4. 点主按钮 → `{eventName:"export_avatar", format:"glb", lod:2, textureProfile:"1K.jpg", useZip:false}`；120 秒没有 `model_exported` 则恢复按钮。
  5. `model_exported{url, avatarCode}`（无论由本站按钮还是创建器自带按钮触发）→ `POST /api/avatar/metaperson/import`。
- `GET /api/avatar/metaperson/token`：需登录且已同意第三方处理，返回 `{ accessToken, expiresIn }`。服务端 `POST https://api.avatarsdk.com/o/token/`（Basic auth `CLIENT_ID:CLIENT_SECRET`，表单 `grant_type=client_credentials`），缓存到过期前 60 秒；secret 不出服务端。
- `POST /api/avatar/metaperson/import`（body `{ url, avatarCode }`）：同样要求同意；`avatarCode` 只允许 `[A-Za-z0-9_-]{1,128}`；导出地址只允许 https、默认端口、主机为 `avatarsdk.com` 及其子域或 `AVATARSDK_EXPORT_HOSTS`（逗号追加）中的主机及其子域；手动跟随最多 3 次重定向、每一跳重新校验；限制 100MB 并校验 glTF 二进制头。存入 `<userId>/avatars/<jobId>.glb`，写一条 `avatar_job`（status succeeded、provider metaperson、`provider_task_id = avatarCode`），并删除本人旧形象的 GLB。主机不在白名单时返回 400，错误信息含主机名——首次实测若报错，把该主机加进 `AVATARSDK_EXPORT_HOSTS`。
- 删除：删除单个形象和一键删除时，对 metaperson 作业调用 `DELETE https://api.avatarsdk.com/avatars/<avatarCode>/`（Bearer 令牌）。该接口对创建器生成的形象是否生效**未核实**；失败只记日志（不含响应体），不在界面提示。本站存储里的文件照常删除。
- 照片：MetaPerson 模式下自拍只在创建器内上传给 MetaPerson，本站不接收照片（照片上传与生成任务接口返回 400），因此没有本站原图需要 30 天删除。同时开启 2D 试穿时，试穿用的正面照只能在试穿面板里上传（`POST /api/tryon/photo`，不受上述 400 限制），这张照片上传时即写 30 天 `expires_at`（见“2D 试穿”）。
- 未配置时：未登录请求 `GET /api/avatar/metaperson/token` 返回 401；已登录返回 409 `{"error":"MetaPerson 未启用，请刷新页面"}`，导入接口同样 409，不访问外部服务（2026-10-16 生产构建冒烟实测）。

- 同意卡分两项：(a) 同意上传并存储本人照片用于生成 3D 形象（必选）；(b) 同意把照片发送给 fal.ai（Tripo 3D）处理——只在配置了真实服务 key 时出现，可选，不勾选只能生成示意模型，之后可在“修改授权”里改。`avatar_job.consent_version` 同时记录两项：`avatar-consent-v2:store` 或 `avatar-consent-v2:store+tripo_fal`（旧版 v1 同意失效，需重新确认）。提交时带上卡片版本（`offerVersion`），处理方变了会要求刷新重读。
- 照片：只收正面 / 侧面 / 背面三张全身照。面部特写与补充照片不参与生成，已不再收集（以前上传的仍可查看、删除）。浏览器端压缩到最长边 1600px 并重新编码为 JPEG；服务端在解析前限制请求体（8MB + 表单开销，按实际读取字节计，覆盖 chunked 与谎报长度），再剥离元数据后存储（`lib/avatar/strip.ts`：JPEG 去 EXIF/GPS/XMP/IPTC/注释，PNG 只留图像与色彩块，WebP 去 EXIF/XMP；EXIF 里非默认的方向会写回一个只含方向的最小 EXIF，其余字段不保留）。按文件头识别 JPG/PNG/WebP，质量提示写入 `quality_flags`。
- 生成：示意模式需要正面 + 侧面或背面；真实服务需要正面 + 侧面（背面可选）。`avatar_job` 状态 draft → queued → processing → succeeded / failed，可取消、可重试。前端每 2 秒轮询 `GET /api/avatar/jobs/[id]`，每次查询推进一步。外部任务编号与状态地址存在 `provider_task_id / provider_status_url`，服务重启后可继续轮询。重新生成成功后删除旧的 GLB。
- 生成服务（`lib/avatar/providers.ts`）：
  - `mock`（默认）：不访问外部网络，约 3 秒后返回程序生成的通用人台，查看器只显示“演示模型”小标签（D48）。
  - `tripo_fal`：`AVATAR3D_PROVIDER=tripo_fal` + `FAL_KEY` 且用户勾选了 (b) 才使用，调用 fal.ai 托管的 Tripo H3.1 Multiview-to-3D，只发送三张全身照，请求头带 `X-Fal-Store-IO: 0`；徽章“AI 生成 3D 形象 · 还原度未验证”。未实测（没有 key）。
  - 按 D48，界面不再显示“合身：未验证”“还原度未验证”等提示。Meshy 备选适配器未实现。
- 第三方副本删除：真实服务的任务结束并把 GLB 转存到本站后，调用 fal Platform API `DELETE https://api.fal.ai/v1/models/requests/<request_id>/payloads` 删除该请求的 payload 与输出文件；删除单个形象、一键删除、取消时也会请求。结果写回 `provider_status_url`（`remote-purge:sent|failed|pending:<时间>`），界面显示“第三方副本删除请求已发送 / 失败”；失败和“任务未结束”由 `npm run avatar:purge` 重试。没有 key 时不发任何外部请求。注意：fal 文档说明请求输入里的 CDN 文件不会被删除，本站不把照片上传到 fal 存储（Supabase 用 15 分钟签名 URL，本地开发用内联 data URI）；fal 侧是否仍有不可删副本未核实。该接口要求 key 具备相应权限，未实测。
- 30 天删除：生成成功时给本次用到的照片写 `avatar_photo.expires_at = 成功时间 + 30 天`（已有期限不延后）。执行方式两种：
  - `npm run avatar:purge`（`scripts/purge-avatars.ts`）：清理全部用户的到期照片（删存储文件并软删除记录），并重试第三方副本删除；只输出计数。需要由运营方用定时任务每天调用，例如 `0 4 * * * cd /path/to/app && npm run avatar:purge`。比赛版本机演示**没有**配置定时任务。本地 PGlite 只允许一个进程打开，运行前先停掉开发服务器。
  - 惰性清理：打开 `/profile/avatar` 时清理本人的到期照片。旧数据没有 `expires_at` 的，按用过它的成功作业的完成时间补写。
- 存储（`lib/storage/`）：设置 `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` 时用 Supabase Storage 私有桶 `avatar-private`（建桶见 `supabase/storage.sql`，需发起用户手动执行），否则写本地 `.data/uploads/<userId>/`。浏览器只能经 `GET /api/avatar/files/<key>` 读取本人文件，他人请求一律 404。
- 删除：单张照片可删；单个形象可删（保留照片与同意）；“一键删除”清空该用户存储前缀下全部文件，照片软删除、作业标记 canceled，之后需重新同意。
- 查看器：入口 `components/AvatarViewer.tsx`，实现在 `components/avatar-viewer/`（R3F，可拖动旋转；props `{ src, badges, poster?, height?, label?, showReset?, onReset? }`，说明见 `components/AvatarViewer.README.md`）。转动或缩放后右下角浮出“复位视角”，弹簧动画回到正面，可随时被拖动打断；减弱动态时直接跳回。`showReset` 默认 true，传 false 可隐藏。
- mock 人台由 `lib/avatar/mannequin.ts` 程序生成（即 `public/models/mock-mannequin.glb`），来源与许可见 `public/models/LICENSE.md`；没有使用任何真人照片、扫描或第三方模型。
- 测试：`npm test`（node:test + tsx）覆盖 MetaPerson 接入（`lib/avatar/metaperson.test.ts`：消息解析、令牌缓存、白名单与重定向、导入与替换、远端删除，全部 mock fetch）、元数据剥离、到期清理与规则模式改编回归（`lib/adapt/offline.test.ts`，直接读 `data/catalog.json`）；测试图全部由代码生成。

API：`GET /api/avatar/metaperson/token`、`POST /api/avatar/metaperson/import`（MetaPerson 模式）、`GET|DELETE /api/avatar`、`POST /api/avatar/consent`（`{ store, thirdParty, offerVersion }`）、`POST /api/avatar/photos`（multipart：slot、file）、`DELETE /api/avatar/photos/[id]`、`POST /api/avatar/jobs`、`GET|DELETE /api/avatar/jobs/[id]`、`DELETE /api/avatar/jobs/[id]/result`、`GET /api/avatar/files/[...key]`。

## 2D 试穿

用户自己的形象穿着选中的衣服，一件一件来（试衣间主路径）；搭配页改编结果卡仍保留整套“穿在我身上”。服务：fal.ai 上的 FASHN v1.6，走队列接口（`https://queue.fal.run/fal-ai/fashn/tryon/v1.6` 提交，之后用提交响应里的 `status_url` / `response_url` 查询；D62）。2026-10-17 已用本机 `FAL_KEY` 与 AI 生成的虚构模特图实测，耗时见[交付记录](../docs/交付记录.md)。

- 启用：设置 `FAL_KEY`（`TRYON_PROVIDER` 可留空，设置时必须为 `fashn_fal`）。没有 key 时不显示入口，也不发任何外部请求。
- 试衣间（逐件，`components/tryon/LookTryOn.tsx` + `useLookTryon.ts`）：每张 LookCard 里可上身的单品（上装、下装含半身裙、外套、连衣裙）在名称下方有「试穿这件」；鞋、包、配饰不出现这个按钮。点一下打开面板并只穿这一件：
  - 底图：正在看的那张。默认是这一套里最新的一张试穿结果（一件一件把整套穿起来）；还没有结果时是本人正面照。面板里「从我的照片重新开始」切回正面照。
  - 穿搭进度：正面照 → 第 1 件 → 第 2 件……（“第 N 件”= 那张图上穿着的件数），点任一张回看（左右方向键也可以），下一件就穿在正在看的那张上；「删除这张」调用 `DELETE /api/tryon/[id]`。
  - 生成中：底图压暗虚化、香槟光束扫过，写“正在为你穿上 〈单品名〉”和真实阶段 + 已用时间（“正在提交 / 排队中（· 前面 N 位）/ 生成中 · N 秒”，30 秒后补一句“比平时稍久，仍在进行”）；可以关掉面板，卡片对应行显示“正在穿上 · N 秒”，穿好后出现在这一套里。
  - 两段式（D62）：先出 `performance` 的一张立刻展示，舞台右下角标“正在细化”、穿搭进度缩略图左下角一个呼吸点；`quality` 好了以后同一张在原位置交叉淡入成清晰的（`useLookTryon` 后台每 1.5 秒轮询一次，关掉面板也继续）。细化中可以接着穿下一件（底图用当前最好的那张）。细化失败时保留快速出的那张，不提示。
  - 预热：本次在面板里上传正面照、且已同意（已同意过或刚勾选）后，立刻用 `prewarm: true` 跑要穿的那一件（点了「试穿这件」的那件，否则按建议顺序的第一件），只跑 `performance`；结果留在浏览器里不进穿搭进度，点「穿上」时命中缓存直接显示，再补提交 `quality`。每张新照片只预热一次。
  - 结果：新图在同一位置从上一张交叉淡入（只动 opacity / transform）；结果图上穿着的单品在卡片和面板的缩略图上标“已穿上”。减弱动态时只淡入淡出。
  - 首次试穿仍要勾选试穿同意；没有正面照时在面板里上传。卡片上有结果或正在穿时，多一行“On You · 穿搭进度”入口。
  - 首屏历史：`/fitting-room` 用 `listLookTryons()` 一次查出本人在这些搭配上的成功结果（按搭配分组、按先后，每套最多 24 张），不逐个检查结果文件。
- 搭配页（整套，`components/tryon/TryOn.tsx`）：改编结果卡上的「穿在我身上」，面板流程：准备 → 生成（显示“第 N/M 件 · 排队中 / 生成中”）→ 结果（与原搭配并排，点击放大），可删除这张。也走队列：提交第一步就返回，前端轮询，服务端每次轮询推进一步。
- 品类映射（`lib/tryon/plan.ts`，前后端共用）：`stepFor()`——连衣裙（display_category）→ `one-pieces`，上装 → `tops`，下装 → `bottoms`，外套 → `tops`；鞋、包、配饰与没有单品图的返回 null。逐件叠加时 `wearOn()` 算出新图上穿着的单品：连衣裙盖掉全身（含外套），上装盖掉原上装、连衣裙与外套，下装盖掉原下装与连衣裙，外套只盖掉原外套（内搭保留）。整套 `planTryon()`：有连衣裙 → 连衣裙 → 外套；否则 上装内搭 → 下装 → 外套，各取第一件。
- 生成参数：逐件两段，先 `mode=performance`（提交后立即返回），`quality` 在响应之后用 `after()` 提交；整套每步 `mode=balanced`。都带 `garment_photo_type=flat-lay`、`output_format=jpeg`（约 260KB，PNG 约 1.5MB），请求头 `X-Fal-Store-IO: 0`。逐件与整套最后一步 `sync_mode=true`（结果以 data URI 放在响应里，fal 不留 CDN 副本）；整套中间步骤 `sync_mode=false`，把结果地址直接交给下一步。key 只发给 `https://queue.fal.run/` 开头的地址。超时：快速一段与整套每一步从提交起 90 秒，细化 150 秒（超时保留快速的一张），失败返回中文错误。
- 轮询 `GET /api/tryon/[id]`：还在生成或细化时，服务端查一次 fal 状态（细化优先：quality 好了就直接用它）；刚完成时把结果图以 data URI 放在响应里，写入私有存储与更新记录放到响应之后（`after()`）。网络抖动与 5xx 当作“还在等”，4xx 才算这一段失败；两段都失败整条才失败。
- 缓存（`cacheKey` = 底图（正面照 id 或底图试穿 id）+ 单品）：同一套里重复试穿直接返回已有的那条（包括还在生成的，不重复提交）；另一套里已完成的复制结果图生成新记录，不调用 FASHN。失败的不进缓存。
- API `POST /api/tryon`（首次带 `consent: true`）：
  - 逐件：`{ lookId 或 outfitId, itemIds: [一件], baseTryonId?, prewarm? }`。判别规则：带 `baseTryonId` 或 `prewarm`，或 `itemIds` 去重后恰好一件。`prewarm` 只用于正面照（带 `baseTryonId` 时 400），同样要求已同意。旧调用方式发送的 `itemIds` 是整套全部单品，只有一件时两种理解的结果相同。带 `lookId` 时这件必须属于本人这套搭配，否则 404；鞋、包、配饰 422；`baseTryonId` 配多件 400。`baseTryonId` 必须是本人一张 `succeeded` 的结果，否则一律 404“没有找到这张试穿图”（不区分不存在、不属于、失败、处理中；结果文件已被清掉时同样 404 并删除该记录），底图读该结果文件（Supabase 15 分钟签名 URL，本地 data URI），这时不要求正面照；不带时用正面照（没有则 409）。校验都在写记录、调用 FASHN 之前。
  - 整套（旧调用方式，兼容）：`{ lookId }` 或 `{ outfitId, itemIds: [多件] }`。
  - 返回 `TryonView`：在原有字段（`id`、`status`、`resultUrl`、`applied`、`appliedItemIds`、`items`、`sourceLookId`、`sourceOutfitId`、`error`、`createdAt`）上新增 `kind`（`item` / `outfit`）、`mode`（这张图的模式：逐件细化前 `performance`、细化后 `quality`，改造前的旧记录为 `quality`；整套 `balanced`）、`stage`（`queued` / `generating` / `refining` / `done` / `failed`）、`queuePosition`、`refining`、`progress`（整套第几步 / 共几步）、`wornItemId`（这次穿上的单品，整套为 null）、`baseTryonId`（在哪张结果上穿，null 为正面照）。`resultUrl` 是当前最好的一张：存储里的鉴权地址，或刚生成时随响应返回的 data URI。逐件时 `appliedItemIds` / `applied` 是结果图上累计穿着的单品（按 `wearOn()` 去掉被盖掉的）。
  - 其余：`GET|DELETE /api/tryon/[id]`（非本人 404）、`POST /api/tryon/photo`（multipart：file）。
- 存储（未改表）：逐件的 `wornItemId / baseTryonId / basePhotoId / cacheKey / prewarm`、两段生成的队列地址与状态（`fast` / `fine`）和两张结果的 key，记在 `tryon.outfit_snapshot`（jsonb 数组）末尾追加的一条 `{ kind: "step", ... }`；整套的步骤与当前队列请求记在 `{ kind: "chain", ... }`。读出时与单品快照分开；没有这条的旧行即改造前的整套。并发的轮询用 `jsonb_set` 各改各的字段，推进整套下一步与认领预热用条件更新做乐观锁，避免重复提交。`item_ids` / `applied_categories` 存结果图上穿着的单品。
- 照片：复用 3D 形象流程的正面全身照（`avatar_photo.slot = front`；MetaPerson 模式下 3D 流程不收照片，只能在试穿面板里上传）；也可在试穿面板里直接上传（浏览器压缩到最长边 1296px 的 JPEG——FASHN 输出 864×1296，再大没有收益——服务端去元数据后存私有存储，并替换为新的正面照；换照片时同时删掉旧照片上没用上的预热结果）。服务端没有图片库，3D 形象流程上传的更大的正面照按原样发送。试穿面板上传的照片写 `expires_at = 上传时间 + 30 天`（D47，与 3D 形象原始照片同一清理流程：`npm run avatar:purge` / 打开 `/profile/avatar` 时惰性清理）；已过期限但尚未被清理的正面照不再用于试穿。发给 FASHN 时，Supabase 存储用 15 分钟签名 URL，本地存储用 data URI；单品图读 `public/` 转 data URI。
- 同意（D47）：首次试穿前单独勾选“同意把我的正面照发送给 FASHN（fal.ai）生成试穿图”，记录在 `tryon_consent`（`tryon-consent-v1:fashn_fal`）。
- 结果：快速一段存 `<userId>/avatars/tryon-<id>.jpg`，细化后另存 `tryon-<id>-hq.jpg` 并把 `result_key` 指过去（两张都随记录删除；快速那张保留到删除，避免正在读它的请求读空；整套为 `tryon-<id>.jpg`；改造前的旧结果为 `.png`），经 `GET /api/avatar/files/<key>` 读取，他人 404。删除时尽力取消还在跑的 fal 请求。3D 形象的“一键删除”同时调用 `deleteAllTryons()`：删除该用户全部 `tryon` 记录、结果图与 `tryon_consent`（之后再试穿需重新同意），再清空用户存储前缀；单独清空存储前缀时，残留的 `tryon` 记录在下次读取或被用作底图时发现文件不存在即删除。
- 表：`tryon`（id、user_id、source_look_id、source_outfit_id、outfit_snapshot、item_ids、applied_categories、status、result_key、error、created_at）、`tryon_consent`（user_id、consent_version、consent_at），迁移 `drizzle/0003_tryon.sql`；Supabase 上执行 `npm run db:setup` 后再执行一次 `supabase/rls.sql`。
- 测试：`lib/tryon/tryon.test.ts`，fetch 模拟 fal 队列（提交 → 状态 → 结果）：品类映射与逐件叠加规则；两段式依次报排队 → 出图并细化中 → 换成清晰的一张，两张都存、都删；缓存命中不发请求、另一套复制结果；预热只跑 performance、不进穿搭进度、认领时补提交 quality 且不重复；细化中继续穿时底图用快速的一张；细化失败保留快速、快速失败等细化、两段都失败才失败；改造前遗留的处理中记录判为失败；`baseTryonId` 属于他人 / 失败 / 处理中 / 不存在 / 文件已删一律 404 且不调用 FASHN；鞋包配饰 422、不在这套里 404；整套逐步推进、中间步骤把结果地址交给下一步；过期正面照不再使用；试穿面板上传的正面照写入 30 天 `expires_at` 并清掉没用上的预热结果；无 key 与未同意（含预热）不发请求；清空存储后记录清理；3D 形象一键删除同时删除试穿记录与同意。
- 前端轮询（`components/tryon/shared.tsx`）：间隔按两次请求的开始时间计（`pollDelay()`，最少 150 ms），链路慢时不会在每次响应之后再整段等待；测试 `lib/tryon/poll.test.ts`（模拟 fetch）。

## 界面提示（D48）

公司内部比赛版不显示免责类提示（占位数据、AI 生成示意、虚构主理人、合身未验证、规则模式、照片删除日期、第三方删除状态等）；身体数据填写即保存；3D 形象同意为一句话。后台的存储、30 天删除与一键删除规则（D47）不变。

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

检查：`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`。没有 `.env.local` 时构建会因 better-auth 默认密钥打印报错（退出码仍为 0），可在命令行临时设置 `BETTER_AUTH_SECRET` 再构建。构建时 `next/font/google` 要从 Google Fonts 下载 Noto Serif SC（标题衬线字）的上百个分片；生产构建的这类请求没有超时，网络（含本机代理）把大量并发连接重置时，构建会停在 “Retrying 1/3…” 不动。2026-10-16 实测的绕法：不改代码，用 `NODE_OPTIONS="--require <脚本>"` 预加载一行 `require("node:https").globalAgent.maxSockets = 6`，并在该命令的环境里去掉 `HTTPS_PROXY`/`HTTP_PROXY`，构建约 4 分钟完成。

### 在 Supabase 上需要执行的步骤（发起用户本人操作）

目录 v0.2、个人档案与 3D 形象之后，据各开发会话的记录，以下步骤都还没有在发起用户的 Supabase 上执行过（这些会话只用本地 PGlite，没有连接用户的 Supabase）：

1. `.env.local` 设置 `DATABASE_URL`（transaction pooler 即可）；迁移需要会话模式连接，可另设 `DATABASE_MIGRATE_URL`（5432 端口）。
2. 运行 `npm run db:setup`：按顺序执行尚未执行的迁移——0001（profile / avatar_photo / avatar_job）、0002（目录 v0.2 字段、`avatar_photo.expires_at`、外部任务字段）、0003（2D 试穿 `tryon` / `tryon_consent`），再写入目录 v0.2。MetaPerson 不需要新表（沿用 `avatar_job`，provider 为 `metaperson`）。衣橱、搭配、单品都做 upsert，搭配与单品的对应关系整体重写；不删除旧行（试衣间引用单品编号），所以 v0.1 中编号不再使用的旧单品会留在库里。
3. 在 SQL Editor 再执行一次 `supabase/rls.sql`，为新表开启 RLS 并收回 Data API 权限。
4. 如需把照片和 GLB 存到 Supabase：在 SQL Editor 执行 `supabase/storage.sql` 建私有桶 `avatar-private`，并在 `.env.local` 设置 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY`（只在服务端使用）。两项都有才启用，否则仍写本地 `.data/uploads/`。
5. 每天运行一次 `npm run avatar:purge` 的定时任务（见上文“30 天删除”）。

可选：`ANTHROPIC_API_KEY`（AI 改编）；`AVATAR3D_PROVIDER=metaperson` + `AVATARSDK_CLIENT_ID` + `AVATARSDK_CLIENT_SECRET`（MetaPerson 3D 形象，可选 `AVATARSDK_EXPORT_HOSTS`）；`FAL_KEY`（2D 试穿 FASHN；若同时设 `AVATAR3D_PROVIDER=tripo_fal` 则也用于 Tripo 3D）。以上真实服务均未实测。

### 2026-10-16 早先的 Supabase 实测（目录 v0.1）

2026-10-16 已在发起用户的 Supabase 项目（新加坡区）实测：
- `npm run db:setup` 建表并写入 37 件单品、7 套搭配；`supabase/rls.sql` 已执行。目录四表对 anon 只读，账号与试衣间表对 Data API 无任何权限；Supabase 安全顾问只剩“已开 RLS 但无策略”的 INFO，这是有意的拒绝全部。
- 注册 → AI 改编 → 加入试衣间：用户、会话与试衣间数据写入 Supabase，试衣间页从库里读回。
- AI 改编（`claude-opus-5-5`，effort `low`）单次耗时约 10–13 秒。发起用户 2026-10-16 决定保持模型与速度，只加等待动画（`components/AdaptWaiting.tsx`）。

连接串注意：把 `[YOUR-PASSWORD]` 整体（含方括号）换成密码；密码含 `@ # / ? %` 等字符需先做百分号编码。

## 说明

- Claude 调用暂未开启服务端拒答回退（`fallbacks`），选品场景收益小；如需开启需改走 beta 接口。
- key、数据库连接串只放 `.env.local`，不提交、不打印到日志。
