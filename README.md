# Star Closet · AI策展衣橱与个人试穿平台

**v0.3 · 2026-10-15定位调整**：让每个人发现喜欢的审美，通过AI搭配、个人试衣间和自己的形象理解服装，再完成可信选购。Star Closet / 明星衣橱暂作工作名称，不再只面向明星或真实实体衣橱。

## 团队从这里开始

最新产品需求以 **main分支的[PRD](docs/PRD.md)** 为准，确认依据看[决策记录](docs/决策记录.md)；[变更清单](docs/定位调整与需求追踪.md)说明这次保留、新增和替代了什么。Slides用于解释方案，历史研究不覆盖最新要求。

团队本地同步可在工作已保存的情况下执行：

```sh
git switch main
git pull --ff-only origin main
```

这会在分支分歧时停止，不覆盖团队成员现有提交。具体分工与候选下一步见[任务清单](docs/任务清单.md)及[冲刺与团队](docs/两天冲刺与团队.md)。

## 产品两侧

- **主理人及团队**：明星、网红/穿搭博主、品牌主题、风格主题、审核通过个人都可成为公共衣橱供给；用照片、视频、语音让Agent整理草稿，再确认、审核与发布。五类入口可交叠，账户主体与主题分开。
- **大众消费者**：文字/语音表达穿搭诉求，收集服装配饰到个人试衣间，建立本人形象并一键试穿，选择商品与购买路径。点赞收藏、付费私密衣橱和粉丝内容权益纳入完整规划。

“准确3D人物、实时渲染”是长远目标，尚未通过模型、尺寸、时延或合身验证。核心服饰完整可旋转模型目标继续保留；2D生成图、旋转人偶和真实穿着适配分别表达。

## 商业策略

入驻付费服务，或免入驻按有效净成交分享同一个佣金池；补充粉丝独家内容门票与个人私密衣橱服务。价格、比例、阈值和市场未定。数字内容、个人服务、B2B交付和实物订单分别记账；个人衣橱仅本人查看。

优先验证可信供给、建橱效率、搭配复访和单位贡献，再扩大高成本试穿、粉丝内容与订阅。完整可行性、资源整合、运营和经济假设见下列材料。

## 阅读入口

| 内容 | 文档 |
| --- | --- |
| 项目Owner v0.4方案（已确认） | [项目Owner评审与推进方案](docs/项目Owner评审与推进方案.md)、[四份评审报告](docs/review/) |
| 产品全貌 | [产品策略](docs/产品策略.md)、[完整PRD](docs/PRD.md)、[需求说明](docs/需求说明.md)、[愿景与体验目标建议](docs/愿景与用户体验目标.md) |
| 这次改了什么 | [定位调整与需求追踪](docs/定位调整与需求追踪.md)、[决策记录](docs/决策记录.md) |
| 商业与运营 | [商业模式与平台运营](docs/商业模式与平台运营.md)、[交易与履约](docs/交易与履约方案.md) |
| 创建与消费体验 | [入驻与Agent建橱](docs/入驻与Agent建橱.md)、[信息架构与搜索](docs/信息架构与搜索.md)、[功能清单](docs/功能清单.md) |
| 真实感与试穿 | [AI试穿与个人形象](docs/AI试穿与个人形象.md)、[服饰详情与3D体验](docs/服饰详情与3D体验.md)、[设计探索](docs/design/设计探索.md) |
| 实现与比赛 | [实现映射](docs/实现架构与功能映射.md)、[技术决策](docs/技术决策.md)、[冲刺与团队](docs/两天冲刺与团队.md)、[任务清单](docs/任务清单.md) |
| 事实与协作 | [交付记录](docs/交付记录.md)、[独立评审](docs/评审记录.md)、[协作流程](docs/协作流程.md)、[AGENTS](AGENTS.md) |
| Claude Mac App接手 | [Code本地项目启动资料与首条指令](docs/ClaudeCode项目启动.md)、[Claude项目入口](CLAUDE.md)、[本地交接记录与下一批任务](docs/ClaudeCode本地交接.md) |

## 线上与静态材料

- [HTML Slides](https://wilsonwang-mt.github.io/star-closet/presentation/star-closet-hackathon.html) · [设计画廊](https://wilsonwang-mt.github.io/star-closet/design/preview.html) · [PDF](https://wilsonwang-mt.github.io/star-closet/presentation/star-closet-hackathon.pdf) · [材料入口](https://wilsonwang-mt.github.io/star-closet/)
- [HTML/PDF文件与打开说明](docs/presentation/README.md)、[设计素材清单](docs/design/素材清单.md)。静态概念与流程图不代表应用、模型或支付已经实现。

线上链接已更新为v0.3，Pages部署和6个公开文件远端校验通过；实际记录见交付记录。历史原图保留并注明基线身份。

## 当前执行状态

用户已授权产品文档、静态设计/演示、静态预览及提交合并。本轮未创建网站应用、接入真实AI/支付/供给或采集身体资料；应用实施范围、技术栈和首版还需决定。用户已说明时尚顾问/博主组队，不推定已有明星、品牌、供应商或素材合作。

[原研究摘要](docs/研究摘要.md)与[2026-10-12原始HTML](research/明星衣橱_Hackathon研究简报.html)作为历史证据保留；旧排除试穿/收藏与明星单一定位不再覆盖v0.3需求。

仓库：[wilsonwang-mt/star-closet](https://github.com/wilsonwang-mt/star-closet)。
