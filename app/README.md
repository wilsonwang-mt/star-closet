# SEEN. 比赛版应用

品牌 SEEN.（原工作名 Star Closet / 明星衣橱），标识源文件与使用规范见 `docs/宣传/logo/`。

手机优先的 Next.js（App Router）+ TypeScript 网站。授权范围见仓库根目录 [AGENTS.md](../AGENTS.md)；部署未获授权，目前只在本机运行。

## 已有功能

核心路径：首页选一间衣橱 → 走进 `/closet/[id]` → 点一套搭配进入 `/outfit/[id]` → 一键试穿（D67）→ 一句话改编 → 单件 / 多选 / 整套加入试衣间 → 加入购物袋（`/bag`，结算与付款不在本版范围）。目录 v0.2 共 10 间衣橱、60 套搭配、209 件单品（主理人与品牌均为虚构示例，图片与视频为 AI 生成示意，价格为参考价），来源 `data/catalog.json`，数据层 `lib/catalog.ts`。

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
- 导航（`components/SiteNav.tsx`）：顶部悬浮玻璃胶囊（视觉规范 §6.1）。左侧 SEEN. 横排标识（`public/brand/`，深浅主题各一份）；桌面直接排列 衣橱 / 试衣间 / 我的档案（未登录为“登录”）与主题切换；手机（<640px）把链接收进圆形菜单按钮，展开为玻璃下拉面板。向下滚动累计超过 8px 收起，向上滚动、回到顶部或键盘焦点进入时出现，首次加载先显示 2 秒；菜单打开时不收起。在 `/`、`/closet/*`、`/outfit/*` 高亮“衣橱”。
- 个人档案（`/profile`）：昵称、简介、城市、风格与颜色标签、尺码、预算；身高体重须单独勾选同意才保存，可一键清除。只有本人可读写，可见性固定为私密。
- 个人试衣间：登录后保存原搭配、改编版本、单件或多选的单品；每套可“整套试穿”（逐件链式穿到数字分身上）；勾选单品加入购物袋。
- 购物袋（D67）：单件、整套、多选加入；导航栏角标；`/bag` 列出单品、尺码、数量与合计。登录用户存 `bag_item`（迁移 0007）。接口 `GET/POST/PATCH/DELETE /api/bag`、`GET /api/bag/count`。

- 动效（视觉规范 §7.1）：弹簧参数统一在 `lib/motion.ts`（含给 CSS 用的 `linear()` 采样），动效库为 `motion` 14.3.0；只动 transform / opacity / filter，可打断。开启“减弱动态效果”时全部降级为淡入淡出、不播放视频。减弱动态只按 CSS 规则审过，60fps 未在真机测量。
- 404：全局、衣橱、搭配各有中文 404 页。已知问题：衣橱页与搭配页有 `loading.tsx`，页面是流式输出的，`/closet/不存在` 与 `/outfit/不存在` 显示正确的 404 文案，但 HTTP 状态是 200（带 `noindex`）；未匹配任何路由的地址仍返回 404。
- 字体：正文为自托管的思源黑体 Light 300 子集（`public/fonts/`、`app/fonts.css`，许可 `public/fonts/OFL.txt`，D50）。新增大量文案或目录后运行 `npm run fonts:build -- <NotoSansSC[wght].ttf 路径>`（需 `python3 -m pip install fonttools brotli`）重新生成；Bodoni Moda 与思源宋体仍由 next/font 从 Google 获取，构建需要网络。
- 视觉：按 [视觉规范 v5](../docs/design/visual-v04/视觉规范.md)。`app/tokens.css` 复制自 `docs/design/visual-v04/tokens.css`，改动先改源文件再同步；场景图在 `public/scenes/`。深色默认，可切换浅色或跟随系统（cookie `sc-theme`）。

尚未接入：单品可旋转 GLB、打赏、站内支付。场景视频（`public/scenes/*-web.mp4`）只加载并播放当前显示的那一段，减弱动态时只显示首帧。试衣间里的咖啡馆生活场景只是标注了“AI 生成场景示意 · 合身未验证”的示意图。

## 悬浮对话（D66）

全站右下角的圆形入口（首页标题旁还有一枚「说场合和预算」引导胶囊），说出场合、风格、预算、性别或想像谁，对话里直接出卡片：衣橱卡 → `/closet/[id]`，搭配卡 → `/outfit/[id]`，功能卡 → 试衣间、3D 形象、2D 试穿（有 `FAL_KEY` 才出现）、档案、登录。手机是底部抽屉，桌面是右下角浮窗；对话存在 sessionStorage，路由切换与刷新都不丢；遇到吸底操作条（`.cta-bar`）时，手机上入口停靠进操作条右侧、成为主按钮旁的圆形次按钮（操作条加 `data-dock-reserve` 留位），其他会挡住入口的元素（`[data-dock-avoid]`）则把入口抬到它上方。

- 接口：`POST /api/chat` 返回 NDJSON 流。第一行是规则层结果（`lib/locate/core.ts`：像谁 / 风格 / 场合 / 性别 / 预算 / 否定六个信号，复用 `parseConstraints`、`allowedGenders`；目录快照在服务端内存缓存 5 分钟，根布局会提前读一次），本机实测首字节约 10ms；随后是 Claude 的流式文字，最后是它用工具（`show_outfits` / `show_closets` / `open_page` / `suggest_replies`）选出的卡片。工具只返回 id，服务端按目录与性别校验后才转成卡片。
- 模型：`claude-opus-5-5`，effort `low`，**fast mode**（`speed: "fast"`，beta `fast-mode-2026-02-01`，价格为标准 2 倍，Claude API 研究预览；2026-10-16 用户决定）；未开通或被限流且还没流出文字时自动用标准速度重试一次（标准速度下带服务端 `fallbacks: "default"`）。目录在系统提示里缓存。`CHAT_SPEED=standard` 关掉 fast，`CHAT_MODEL` 换模型。本机实测（2026-10-17，4 句样例）fast：4 句样例中 3 句首段文字 1.9–2.3 秒、整轮 2.6–3.2 秒（标准速度同 3 句 2.8–4.5 / 5.3–6.6 秒）；“暖一点的颜色”一句模型思考更久，fast 首字 9.5 秒、标准 10.7 秒。首字 15 秒、整轮 25 秒超时；没有 key、超时或出错时停在规则结果，不显示“规则模式”（D48）。
- 用户的话不落库，服务端日志只记错误类型。
- 测试：`lib/locate/locate.test.ts`（17 个样例，直接读 `data/catalog.json`）。

## 数字分身（原 3D 形象）

入口 `/profile/avatar`（登录后，档案页底部也有入口）。存储与第三方处理规则见 AGENTS.md「2026-10-16 个人影像存储决定」（D47）；方案与边界见决策记录 D63。

### 数字分身模式（D63，比赛版现行，未用真实 key 实测）

不做 3D：用户上传 3–5 张照片，得到一组照片级“标准形象照”（正面、四分之三侧面、背面），在页面左右滑动查看，代替 3D 旋转；之后试穿用这组照片作底图。

- 启用：`FAL_KEY` 存在，且 `AVATAR3D_PROVIDER` 未设或为 `twin`（`lib/avatar/providers.ts` 的 `twinEnabled()`）。此模式不加载 MetaPerson 创建器。配置 `ANTHROPIC_API_KEY` 时同意卡多一项照片分析。
- 同意卡（D47，三项各自勾选）：保存我的照片与形象，仅自己可见（必选）；由 fal.ai 上的 AI 图像模型根据我的照片生成我的形象（必选才能上传）；由 Anthropic（Claude）分析我的照片（可选）。`consent_version = avatar-consent-v2:store+twin` 或 `…:store+twin+anthropic`。
- 上传卡：正脸（`face`，必传）、全身正面（`front`，必传，同时是试穿底图）、侧脸（`extra`）、全身侧面（`side`）、半身或其他（`back`），每格一张，至少 2 张、最多 5 张；浏览器压缩为 JPEG，服务端再剥元数据，存私有存储，照片自上传起 30 天到期。形象性别在上传区自选。
- 生成 `POST /api/avatar/twin { gender }`（`lib/avatar/twin.ts` 的 `generateTwin`，同步，`maxDuration = 120`）：需登录与同意；先（同意且有 key 时）用 `claude-opus-5-5` 分析全部照片，得到一句不超过 30 字的概括、特征（发型、发色、脸型、肤色、身材、肩/腰/臀/腿、眼镜）和一段英文外观描述，30 秒超时则跳过；再以全部照片为 `image_urls`（顺序：正脸、侧脸、全身正面、全身侧面、半身或其他；每张压到长边 1536、JPEG q90 的 data URI）用指挥台实测达标的提示词模板（同一人、不美化不修身、素色基础款、暖米色影棚、85mm 质感；Claude 描述只作补充短句）并行调用 `fal-ai/nano-banana-pro/edit` 三次（`aspect_ratio 3:4`、`resolution 2K`、`X-Fal-Store-IO: 0`），每张失败且剩余时间足够时重试一次；正面必须成功，侧面/背面失败则为空。结果存 `<userId>/avatars/twin-<jobId>-<front|side|back>.<ext>`，写 `avatar_job`（`provider = twin`，`result_images = { front, side, back, summary, traits, gender, descriptor }`）。新分身成功后才删除旧分身文件；同一用户同时只允许一个生成。
- 展示：“你的形象”卡——画廊可拖动、方向键、圆点切换，交叉淡入 + 轻微视差（只动 transform / opacity，减弱动态只淡入淡出），下方一句概括与特征标签，按钮「去试穿」（`/fitting-room`）「重新生成」「删除这个形象」。生成中显示等待态：本人全身照压暗 + 香槟扫光，阶段文案按真实秒数切换（正在读取你的照片 → 正在理解你的身材与发型 → 正在为你拍摄标准照），显示已用秒数，不显示百分比。
- 删除：「删除这个形象」删形象照、保留照片（`DELETE /api/avatar/jobs/<id>/result`）；「一键删除」清掉全部照片、形象照与记录。
- 给试穿的接口（`lib/avatar/twin.ts`）：`getTwin(userId)`、`readTwinImageDataUri(key)`、`getIdentityRefs(userId)`（分身正面 + 正脸 + 侧脸，最多 4 张 data URI）。
- 数据库：迁移 `drizzle/0005_twin_result_images.sql` 给 `avatar_job` 加 `result_images jsonb`，需要在 Supabase 执行（`npm run db:setup`）；未执行时形象页会因缺列报错。
- 测试：`lib/avatar/twin.test.ts`（全部 mock fal 与分析，合成纯色图片）。
- 成本：建一次分身约 0.45–0.6 美元。

### MetaPerson 模式（已停用，D63；代码保留）

`AVATAR3D_PROVIDER=metaperson` 且 `AVATARSDK_CLIENT_ID`、`AVATARSDK_CLIENT_SECRET` 都存在时启用（`lib/avatar/metaperson.ts`、`lib/avatar/metaperson-protocol.ts`），否则保持原来的 mock / tripo_fal 流程。没有真实 key，以下流程只有单元测试（mock fetch），尚未与 Avatar SDK 实测。

- 页面（D56）：同意卡两项都要勾（“保存我的照片与 3D 形象”+ D47 要求的单独一项“由 MetaPerson 根据你的自拍生成本人形象”，`consent_version = avatar-consent-v2:store+metaperson`）→ 本站自己的极简上传卡：正脸自拍（`face`，必传）、全身正面（`front`，必传，同时就是 2D 试穿用的正面照，只传一次）、全身侧面（`side`，选传），每格一个细线剪影示意和一句要求；再选“形象性别”（女 / 男，档案里没有性别字段）→「生成我的 3D 形象」→ 本站等待态（本人照片压暗、一道光扫过、“正在用你的照片塑造形象”、已用时间）→ 收到 `model_generated` 后淡入 MetaPerson 创建器，可调整发型与服装 →「保存为我的 3D 形象」→ 服务端导入成功后切换到金色玻璃查看器（360° 旋转，无徽章），可「重新生成」或删除。动效只动 transform / opacity；减弱动态时只淡入淡出。
- 预加载：同意了 MetaPerson 之后（老用户即打开页面时；没有形象或点了「重新生成」时）立即挂载创建器 iframe（视口宽 <768 用 `https://mobile.metaperson.avatarsdk.com/generator`，否则 `https://metaperson.avatarsdk.com/iframe.html`，`allow="fullscreen"`），用户上传照片时引擎在后台加载，上传卡下方一条细线进度与已用时间（没有真实进度事件，曲线趋近但不到头，就绪后填满）。iframe 挂在 `document.body` 的浮层里：隐藏时固定在视口内、`opacity:0`、不可点击、`inert`（玻璃卡的 `backdrop-filter` 会改变 fixed 的定位基准，移出视口的跨域 iframe 会被浏览器节流）；显示时只改样式对齐到卡片里的舞台占位，不移动节点、不重新加载。仍遵守 D47：未勾选 MetaPerson 之前不加载创建器。
- 前端事件（`app/profile/avatar/MetaPersonCreator.tsx`；协议纯函数在 `lib/avatar/metaperson-protocol.ts`，流程状态机在 `lib/avatar/metaperson-flow.ts`）：只处理当前 iframe、来源为上述两个 origin 且 `data.source === "metaperson_creator"` 的消息，回发时 targetOrigin 用该 origin。创建器的布尔字段兼容数字 1/0（桌面 1.42.0 实测）。
  1. `metaperson_creator_loaded` → 依次发送 `{eventName:"authenticate", accessToken}`、`{eventName:"set_export_parameters", format:"glb", lod:2, textureProfile:"1K.jpg", useZip:false}`、`set_ui_parameters`：桌面 `{isExportButtonVisible:false, showSampleAvatars:false, isTakeSelfieButtonVisible:false, isBrowsePhotoButtonVisible:false, isLanguageSelectionVisible:false}`，手机 `{isNoPhotoVisible:false}`。令牌若晚于加载事件到达，到达后再补发。收到 `authentication_status`（`isAuthenticated` 为真）视为引擎就绪；8 秒内没有该事件也视为就绪。
  2. 点「生成我的 3D 形象」→ 浏览器读取本人正脸照（同源私有地址），压到长边 1024px 的 JPEG，转 base64（不带 `data:` 前缀）→ 引擎就绪后发送 `{eventName:"generate_avatar", gender, age:"adult", image, blends:[{name,value}×8]}`（blends 只发桌面版，名称 Body/Neck/Shoulders/Chest/Forearms/Waist/Hips/Legs，裁剪到 -1..1、四舍五入到 0.05）。待机或尚未发出时创建器自己发的 `model_generated`（默认形象）不会让它提前露出。
  3. 兜底：`generate_avatar` 发出 90 秒内没有 `model_generated`，或 `authentication_status` 为假 → 直接显示创建器原生界面，桌面版发 `{eventName:"set_ui_parameters", isBrowsePhotoButtonVisible:true}`，提示“请在下方直接选择你的正脸照片”。
  4. `action_availability_changed`（`actionName:"avatar_export"`）决定主按钮是否可点；从未收到该事件时，以 `model_generated` 为准（兼容手机版）。
  5. 点主按钮 → `{eventName:"export_avatar", format:"glb", lod:2, textureProfile:"1K.jpg", useZip:false}`；120 秒没有 `model_exported` 则恢复按钮。
  6. `model_exported{url, avatarCode}`（无论由本站按钮还是创建器自带按钮触发）→ `POST /api/avatar/metaperson/import`。
- 体型分析（D56，`lib/avatar/body.ts`，`POST /api/avatar/body-analysis`）：需登录且已同意 MetaPerson。同意卡在 MetaPerson 模式且配置了 `ANTHROPIC_API_KEY` 时多一项可选的单独勾选“由 Anthropic（Claude）分析我的全身照，参考我的照片调整 3D 形象的体型”（`consent_version = avatar-consent-v2:store+metaperson+anthropic`，`offerVersion` 随之带 `+anthropic`）。勾选后，点生成时服务端读取本人全身正面（必需）与侧面（可选）照片和档案身高体重，照 `lib/adapt/ai.ts` 的写法调用 `claude-opus-5-5`（`messages.parse` + `zodOutputFormat`，effort low，超时 45 秒、重试 1 次），输出性别模板、8 个身体比例参数与一句不超过 30 字的体型概括（数值范围不写进 schema，由代码裁剪到 -1..1、四舍五入到 0.05；概括超长时截断，出现“精准/还原/复刻/1:1”整句丢弃）。未勾选、没有 key、调用失败或拒绝时不报错，只按 BMI 粗设 Body / Waist / Hips（BMI 22 为 0，每 ±8 约 ±1，Waist ×0.8、Hips ×0.6），缺身高体重时全部为 0。只存 Claude 的结果，挂在当前全身正面照的 `avatar_photo.quality_flags.bodyAnalysis`（不改表；同一组照片不重复调用；换照片后重算；撤回体型分析同意后删除；照片删除或到期后由 `purgeExpiredPhotos` 抹掉）；身高体重估算每次重算、不存，档案清空身高体重后不留副本，作为 `generate_avatar` 的 blends 传入，概括显示在等待态、生成结果与形象卡上（“参考你的照片：…”）。界面只说“参考你的照片调整体型”，不写“精准还原”。浏览器最多等 100 秒，超时就不带体型参数继续。未用真实 key 实测。
- `GET /api/avatar/metaperson/token`：需登录且已同意第三方处理，返回 `{ accessToken, expiresIn }`。服务端 `POST https://api.avatarsdk.com/o/token/`（Basic auth `CLIENT_ID:CLIENT_SECRET`，表单 `grant_type=client_credentials`），缓存到过期前 60 秒；secret 不出服务端。
- `POST /api/avatar/metaperson/import`（body `{ url, avatarCode }`）：同样要求同意；`avatarCode` 只允许 `[A-Za-z0-9_-]{1,128}`；导出地址只允许 https、默认端口、主机为 `avatarsdk.com` 及其子域或 `AVATARSDK_EXPORT_HOSTS`（逗号追加）中的主机及其子域；手动跟随最多 3 次重定向、每一跳重新校验；限制 100MB 并校验 glTF 二进制头。存入 `<userId>/avatars/<jobId>.glb`，写一条 `avatar_job`（status succeeded、provider metaperson、`provider_task_id = avatarCode`），并删除本人旧形象的 GLB。主机不在白名单时返回 400，错误信息含主机名——首次实测若报错，把该主机加进 `AVATARSDK_EXPORT_HOSTS`。
- 删除：删除单个形象和一键删除时，对 metaperson 作业调用 `DELETE https://api.avatarsdk.com/avatars/<avatarCode>/`（Bearer 令牌）。该接口对创建器生成的形象是否生效**未核实**；失败只记日志（不含响应体），不在界面提示。本站存储里的文件照常删除。
- 照片（D56）：`POST /api/avatar/photos` 在 MetaPerson 模式下接受 `face | front | side`（其他位置 400），要求已单独同意 MetaPerson（否则 403）；与 photos 模式相同的压缩、去元数据、私有存储与“每个位置只留一张”，并在上传时写 `expires_at = 上传时间 + 30 天`（D47）。导入形象成功后，对本人全部在用照片补写 30 天期限（已有期限不延后）。只有正脸照经 `generate_avatar` 发给 MetaPerson；全身正面照同时是 2D 试穿的正面照（试穿面板也可单独上传正面照，`POST /api/tryon/photo`，上传时同样写 30 天 `expires_at`，见“2D 试穿”）。服务端生成任务接口在该模式下仍返回 400。
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
- 测试：`npm test`（node:test + tsx）覆盖 MetaPerson 接入（`lib/avatar/metaperson.test.ts`：消息解析、令牌缓存、白名单与重定向、导入与替换、远端删除、MetaPerson 模式上传与 30 天期限，全部 mock fetch；`lib/avatar/metaperson-flow.test.ts`：`generate_avatar` 消息构造、blends 裁剪、90 秒与认证失败兜底；`lib/avatar/body.test.ts`：体型分析的同意、BMI 退化、失败/拒绝不报错、结果缓存与随照片删除抹掉、请求形状，Claude 全部用假函数或本地假响应）、元数据剥离、到期清理与规则模式改编回归（`lib/adapt/offline.test.ts`，直接读 `data/catalog.json`）；测试图全部由代码生成。

API：`GET /api/avatar/metaperson/token`、`POST /api/avatar/metaperson/import`、`POST /api/avatar/body-analysis`（MetaPerson 模式）、`GET|DELETE /api/avatar`、`POST /api/avatar/consent`（`{ store, thirdParty, bodyAnalysis?, offerVersion }`）、`POST /api/avatar/photos`（multipart：slot、file）、`DELETE /api/avatar/photos/[id]`、`POST /api/avatar/jobs`、`GET|DELETE /api/avatar/jobs/[id]`、`DELETE /api/avatar/jobs/[id]/result`、`GET /api/avatar/files/[...key]`。

## 2D 试穿

**2026-10-17 更新（D62 / D63，`feat/twin-tryon`）——以本段为准，下文 FASHN 细节仅适用于 `TRYON_PROVIDER=fashn_fal`：**

- 模型编排（`lib/tryon/provider.ts`，两段式与队列框架不变）：默认 `TRYON_PROVIDER=kolors_nano`——第一段“快出图”用可灵 Kolors（`fal-ai/kling/v1-5/kolors-virtual-try-on`，输入 `human_image_url` / `garment_image_url` / `sync_mode`，输出 `image.url`，约 20 秒），第二段“细化”用 `fal-ai/nano-banana-pro/edit` 多参考（约 45 秒），好了原地替换、界面写“正在细化”。鞋、包、配饰 Kolors 不支持，只跑 nano 一段。可选 `nano_fal`（只跑 nano）、`kolors_fal`（只跑 Kolors）、`fashn_fal`（原 FASHN performance → quality，备选保留）。整套每步一段（默认 Kolors）。
- nano 请求（`lib/tryon/nano.ts`）：`image_urls = [底图, 正脸（有分身时）, 商品图]`，每张转为长边 1536、JPEG q92 的 data URI；`aspect_ratio 3:4`、`resolution 2K`、`num_images 1`；提示词为指挥台实测有效的 virtual try-on 文案，按分身性别换 her / his，没有正脸时去掉 reference 2；鞋包配饰改为 wearing / carrying the item。
- 底图（`lib/tryon/base.ts`）：有数字分身时用分身正面标准形象照（`lib/avatar/twin.ts` 的 `getTwin` + `readTwinImageDataUri`），没有时退回正面全身照；都没有时 409“先建立你的形象”，界面引导去 `/profile/avatar`（保留直接上传正面照作兜底）。缓存键 `twin:<jobId>` / `photo:<id>` + 单品。
- 商品详情页一键试穿：`POST /api/tryon/quick { itemId, consent? }`，同一套逐件两段式，不属于任何搭配；前端轮询 `GET /api/tryon/<id>`。上身效果场景图的身份参考改为 `getIdentityRefs`（最多 4 张），已有一键试穿结果时一并作衣服参考。
- 同意（D47）：文案“同意把我的形象照片发送给 fal.ai 上的 AI 模型生成试穿图”，版本 `tryon-consent-v2:fal`；旧 `tryon-consent-v1:fashn_fal` 需要重新同意，切换 fal 上的模型不需要。
- 测试：`lib/tryon/kolors.test.ts`（模拟队列与数字分身：Kolors 请求体、nano 细化参数与提示词、分身优先、无分身退回正面照、无形象 409、鞋包只跑 nano、同意升级、场景多参考、单段模式）；`lib/tryon/tryon.test.ts` 固定 `TRYON_PROVIDER=fashn_fal` 覆盖 FASHN 备选。真实 key 下的 Kolors 队列、nano `sync_mode` 与耗时未在本分支实测。

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

## 商品详情页与上身效果（T3）

**2026-10-17 更新（D63，`feat/twin-tryon`）：**

- “上身效果”区块顶部新增「一键试穿」（`components/item/LookGallery.tsx`）：已登录且有数字分身或正面全身照时为主按钮；把这件穿到本人形象上（数字分身正面照优先），结果大图展示、点图放大。上装 / 下装 / 外套 / 连衣裙先由可灵 Kolors 快出图（约 20 秒），再由 nano-banana 多参考细化、原地替换（图上标“正在细化”）；鞋、包、配饰只跑 nano-banana（约 45 秒）。接口 `POST /api/tryon/quick { itemId, consent? }`，前端轮询 `GET /api/tryon/<id>`，与试衣间同一套两段式、缓存与同意（见“2D 试穿”）。等待态写阶段文案（正在读取你的形象 → 正在为你换上这件 → 正在调整光影 → 正在收尾）与秒数。没有形象时主按钮为「先建立你的形象」（`/profile/avatar`），场景图的准备区仍保留直接上传正面照作兜底。
- 场景图（`lib/scene/service.ts`）的身份参考由单张正面照改为 `getIdentityRefs(userId)`（数字分身正面 + 正脸 + 侧脸，最多 4 张；没有分身时退回底图一张）；本人已有这件的一键试穿结果时一并作为衣服参考。提示词按图片数量动态编号。`hasFrontPhoto` 改为“有可用形象”（分身或正面照）。
- 同意文案统一为“同意把我的形象照片发送给 fal.ai 上的 AI 模型生成试穿图”（`tryon-consent-v2:fal`）。

入口：衣橱页、搭配页、改编结果里的单品缩略图与名称都链接到 `/item/[id]`（`components/ItemThumb.tsx` 新增可选 `href`，`components/ItemList.tsx` 传入；替换下拉不变）。

- 页面（`app/item/[id]/`）：所属衣橱的场景图做背景（`Scene cover`）；首屏左侧玻璃台面上的商品大图，右侧名称、价格（金箔）、颜色 / 材质 / 尺码 / 版型 / 季节、所属衣橱（链接回衣橱页）与购买按钮（目录 `buy_url` / `buy_label`，新窗口打开）；下方“上身效果”画廊与“这件出现在哪些搭配里”（搭配卡链接 `/outfit/[id]`，N° 为所属衣橱内序号）。不存在的单品返回 404（这一段没有 `loading.tsx`，状态码正确）。
- “上身效果”画廊（`components/item/LookGallery.tsx`），按优先级：
  1. 本人：已登录、有正面全身照（`avatar_photo.slot = front`，与 2D 试穿共用）、已同意（`tryon_consent`，与 2D 试穿同一项）、配置了 `FAL_KEY` → 点“生成我的上身效果”，约 30 秒出 2 张场景图，标题“你的上身效果”。缺照片或同意时，在画廊下方就地上传照片（复用 `POST /api/tryon/photo`）并勾选同意。
  2. 演示模特：读取 `public/demo/manifest.json`（T2 产出，路径只接受 `/demo/` 下的本站文件），标题“模特上身”，并写明“演示模特 · 由 AI 生成的虚构人物”。
  3. 都没有：已登录显示生成入口，未登录为“登录后生成我的上身效果”（`/login?next=/item/[id]`）。
- 生成（`lib/scene/service.ts`，`POST /api/scene { itemId, consent? }`，`maxDuration 120`）：`fal-ai/nano-banana-pro/edit`，输入本人正面照 + 单品图 + 场景描述（`lib/scene/scenes.ts`，按单品场合与风格标签从 T2 那组 6 个场景里选 2 个），要求单品颜色款式材质与商品图一致、人物长相不变；两张并行生成。请求头 `X-Fal-Store-IO: 0`。同一用户同一件单品只保留最新一组（重新生成前删旧记录与文件）。
- Live：场景图存好后立即向 fal queue 提交 `fal-ai/kling-video/v2.5-turbo/pro/image-to-video`（5 秒、细微动作、无声），状态地址存 `scene_render.video_status_url`；`GET /api/scene?itemId=` 每次推进一次轮询，完成后取回 mp4 存私有存储。浏览器每 5 秒查询一次，视频就绪前卡片用纯前端效果（推镜 + 光影扫过、无 LIVE 标），就绪后显示 LIVE 标并播放真视频。视频经 `GET /api/scene/video/[id]` 读取（支持 Range，iOS Safari 需要；他人 404）。Kling 原始输出约 1080p、14–17MB，未在服务端转码。
- `<LivePhoto>`（`components/live/`）：桌面悬停约 150ms、手机长按约 300ms（`navigator.vibrate` 可用时轻震一次）开始，松开或移出回到静态图；按下时弹簧放大到约 1.04、预先模糊的一层同图淡入再淡出、视频从第一帧淡入、LIVE 圆环描一圈。视频 `preload="none"`，首次激活才设置地址；减弱动态时只显示静态图。只动 transform / opacity（模糊层的 blur 为静态值，只改 opacity；LIVE 圆环为 14px SVG 的描边动画）。
- 存储：`<userId>/avatars/scene-<id>.jpg|mp4`（沿用现有 key 规则）。3D 形象“一键删除”在 `lib/avatar/service.ts` 的 `deleteAll` 里多一行调用 `deleteAllSceneRenders()`，删除记录与文件。
- 表：`scene_render`（id、user_id → user 级联删除、item_id、scene_id、status、image_key、video_key、video_status_url、error、created_at；索引 user_id + item_id），迁移 `drizzle/0004_scene_render.sql`；`supabase/rls.sql` 为它开启 RLS 并收回 Data API 权限。Supabase 上需执行 `npm run db:setup`（迁移 0004）后再执行一次 `supabase/rls.sql`。
- 测试：`lib/scene/scenes.test.ts`（场景挑选、演示清单路径过滤）。fal 调用没有单元测试，真实 key 实测见 `demo-assets/T3报告.md`。

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
2. 运行 `npm run db:setup`：按顺序执行尚未执行的迁移——0001（profile / avatar_photo / avatar_job）、0002（目录 v0.2 字段、`avatar_photo.expires_at`、外部任务字段）、0003（2D 试穿 `tryon` / `tryon_consent`）、0004（上身效果 `scene_render`）、0005（数字分身 `avatar_job.result_images`）、0006（每日限次 `usage_counter`，D64），再写入目录 v0.2。MetaPerson 不需要新表（沿用 `avatar_job`，provider 为 `metaperson`）。衣橱、搭配、单品都做 upsert，搭配与单品的对应关系整体重写；不删除旧行（试衣间引用单品编号），所以 v0.1 中编号不再使用的旧单品会留在库里。
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

## 部署到 Vercel（受保护演示）

授权范围见仓库根目录 AGENTS.md「2026-10-17 部署授权（受保护演示，D64）」：只允许开启 Deployment Protection 的演示部署，不公开上线、不绑自定义域名、不收款。部署、Vercel 账号与环境变量录入由发起用户本人操作；本节只写步骤与变量名，不写任何值。

### 项目设置

- Root Directory：`app`（Framework 自动识别为 Next.js；构建命令 `npm run build`，安装命令 `npm install`）。
- 函数区域：`app/vercel.json` 已写 `"regions": ["sin1"]`，与 Supabase 新加坡区同地。
- 函数时长：数字分身 `/api/avatar/twin` 300 秒、上身效果 `/api/scene` 120 秒、试穿 `/api/tryon*` 与改编、体型分析 60 秒（路由内 `maxDuration`），Pro 套餐都在上限内。
- **Deployment Protection 必须开启，并覆盖所有部署（含 Production）**：优先 Password Protection（Pro 加购项）；未购买时用 Vercel Authentication + Shareable Links。部署后先确认未登录 Vercel、无密码时打不开页面。

### 环境变量（只列名字；Production 与 Preview 分开录入，标记 Sensitive）

必填（Vercel 上缺前三项任何一个，接口会直接报错并写明缺哪个，不会退回本地 PGlite 或本地文件，见 `lib/env.ts`）：

- `DATABASE_URL`（Supabase transaction pooler，6543 端口）
- `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`（私有桶 `avatar-private`；service role key 只在服务端使用，不能加 `NEXT_PUBLIC_` 前缀）
- `BETTER_AUTH_SECRET`（正式环境新生成）
- `BETTER_AUTH_URL`（线上地址，如 `https://<项目名>.vercel.app`；本次部署的 `https://$VERCEL_URL` 会自动加入 trustedOrigins，https 下 cookie 自动 Secure）

按需：

- `ANTHROPIC_API_KEY`（改编、体型分析；建议设花费上限的正式 key）
- `FAL_KEY`、`TRYON_PROVIDER`、`AVATAR3D_PROVIDER`、`AVATAR3D_MAX_POLL_SECONDS`、`TWIN_QUEUE_POLL_MS`
- `AVATARSDK_CLIENT_ID`、`AVATARSDK_CLIENT_SECRET`、`AVATARSDK_EXPORT_HOSTS`（MetaPerson，已停用）
- 每日上限覆盖（正整数，不填用默认）：`QUOTA_ADAPT`（100）、`QUOTA_TRYON`（60，试衣间与一键试穿共用）、`QUOTA_SCENE`（30）、`QUOTA_TWIN`（10）、`QUOTA_BODY_ANALYSIS`（20）

不要在 Vercel 上设置：`PGLITE_DIR`、`UPLOADS_DIR`（本地专用）；`DATABASE_MIGRATE_URL` 只在本机跑迁移时用。

### 部署前在 Supabase 上执行（本机，不在 Vercel 构建时跑）

1. 本机 `.env.local` 设置 `DATABASE_URL` 与 `DATABASE_MIGRATE_URL`（5432 会话模式），运行 `npm run db:setup`：执行到 0006（`usage_counter`）并写入目录。
2. SQL Editor 整份执行 `supabase/rls.sql`（为 `usage_counter` 等新表开启 RLS、收回 anon / authenticated 权限）；未建桶时再执行 `supabase/storage.sql`。
3. 用 Supabase 安全顾问（Security Advisor）复查：应只剩“已开 RLS 但无策略”的 INFO。
4. 删除或改密测试账号（见 AGENTS.md D64 节）。

### 私有文件与响应大小

Vercel 函数响应上限 4.5 MB。`/api/avatar/files/*`（照片、试穿图、GLB）与 `/api/scene/video/<id>`（Live 视频）在校验登录与归属后，Supabase 存储时 302 跳到 60–300 秒有效的签名链接（`Cache-Control: private, no-store`），不经函数转发；本地存储时照旧直接返回字节。

### 部署后冒烟检查

- [ ] 不带密码 / 未登录 Vercel 打开站点与任意 `/api/*`：被 Deployment Protection 拦下。
- [ ] 注册新账号、退出、再登录；刷新后仍保持登录（cookie 为 Secure）。
- [ ] 未登录点“改编这一套”跳到登录页；登录后改编成功（AI 或规则兜底）。
- [ ] 改编结果“加入试衣间”，试衣间页能读回。
- [ ] 个人页建数字分身：作业进入生成中，结束后三张形象图能显示（图片地址经 302 到 Supabase 签名链接）。
- [ ] 商品详情页一键试穿：先出快图，随后自动换成清晰版。
- [ ] 上身效果：场景图出现，Live 视频能播放（含 iPhone Safari）。
- [ ] Vercel 运行日志（Runtime Logs）没有“缺少环境变量”、5xx 或函数超时；区域显示 sin1。
- [ ] 当日超过上限时返回中文提示（可临时把某个 `QUOTA_*` 设为 1 验证后改回）。

照片 30 天删除（`npm run avatar:purge`）目前没有配置 Vercel Cron，演示期间由本机定时执行或手动执行。

## 说明

- Claude 调用暂未开启服务端拒答回退（`fallbacks`），选品场景收益小；如需开启需改走 beta 接口。
- key、数据库连接串只放 `.env.local`，不提交、不打印到日志。
