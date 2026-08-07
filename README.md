# GEO 工作区

紫驰「内容 Agent + GEO」本地交付与工具研发仓库。

## 目录约定

| 路径 | 用途 |
|------|------|
| `packages/geo-cli/` | Node.js CLI（`geo-cli` npm 包）：inventory / clean / validate / review-clean / confirm-clean |
| `skills/` | Agent Skill（`zichi-geo` 等）；**`.cursor/skills/zichi-geo` → 软链到此** |
| `projects/{项目名}/` | 按客户拆分；`inputs/` 原始资料；`knowledge/` 等为清洗产物 |
| `openspec/` | 研发期规格驱动变更；不属于最终运行交付 |
| `docs/` | 研发方案、竞品资料、方法论；不属于最终运行依赖 |
| `AGENTS.md` | Agent 防错约定（密钥/身份证/通道等） |

## 文档索引

### 方案与报价
- [`docs/紫驰-GEO工具详细解决方案.md`](./docs/紫驰-GEO工具详细解决方案.md) — **主方案**：企业事实清洗与确认 → 诊断 → 场景/关键词 → 三大权威信源投放，含 Part A/B、目录契约与验收
- [`docs/紫驰-工具开发任务拆分与报价方案.md`](./docs/紫驰-工具开发任务拆分与报价方案.md) — 模块拆分、报价与分成、Skill 路由草案

### 竞品 / 平台资料
- [`docs/各GEO平台资料/`](./docs/各GEO平台资料/) — 大泽、摘星、荟信侧材料、ApexForge、有赞×观树、艾瑞 2026 GEO 白皮书等
- [`docs/各GEO平台资料/平台摸底/`](./docs/各GEO平台资料/平台摸底/) — 演示账号后台摸底与三平台对比（已映射主方案）

### 方法论
- [`docs/方法论文章/`](./docs/方法论文章/) — 工厂 GEO、证据库、微场景、通用 SOP 等

### 模板
- [`docs/GEO信息收集表（建知识库）.xlsx`](./docs/GEO信息收集表（建知识库）.xlsx) — 信息收集表模板

### OpenSpec（进行中）
- [`openspec/changes/clean-projects-to-knowledge-schema/`](./openspec/changes/clean-projects-to-knowledge-schema/) — 华远深洗 → 标准知识库 Schema（proposal/design/specs/tasks）
- [`openspec/changes/rebuild-enterprise-fact-cleaning/`](./openspec/changes/rebuild-enterprise-fact-cleaning/) — 企业事实层重建：来源追踪、语义复核、确认快照与多项目复用；注册材料仅保留原始输入
- [`openspec/changes/add-baseline-geo-diagnosis/`](./openspec/changes/add-baseline-geo-diagnosis/) — 已确认事实 → 小规模种子题 → 多平台基线诊断与缺口
- [`openspec/changes/add-customer-question-scenarios/`](./openspec/changes/add-customer-question-scenarios/) — 已确认诊断 → 紫驰自己的客户问题/购买场景；竞品仅作方法覆盖参考

## geo-cli 快速开始

```bash
cd packages/geo-cli && npm install && npm run build && npm link
geo-cli clean --project projects/南通市海门华远工具厂
geo-cli validate --project projects/南通市海门华远工具厂
geo-cli review-clean --project projects/南通市海门华远工具厂
geo-cli confirm-clean --project projects/南通市海门华远工具厂
```

未 link 时用：`node packages/geo-cli/dist/cli.js clean --project projects/南通市海门华远工具厂`

详见 [`packages/geo-cli/README.md`](./packages/geo-cli/README.md)。

## Cursor Skill（多客户）

`.cursor/skills/zichi-geo` → `skills/zichi-geo/`。它是总路由 Skill，每个业务阶段在 `references/` 有独立文件；未实现阶段明确标记为占位。Skill **不含客户名单**；口述公司名时先：

```bash
geo-cli projects resolve "华远"
geo-cli projects list
```

再对返回的 `path` 跑 clean / validate。新客户：建 `projects/{dir}/inputs/` 并在 `projects/registry.json` 登记。

最终对外交付面仅为 `packages/geo-cli`、`skills/zichi-geo` 与项目目录契约；竞品研究、OpenSpec 和研发文档不进入用户运行流程。

## 执行分期（摘要）

1. **Part A（本地闭环）**：`clean → baseline diagnose → demand scenarios → content plan → generate/review → publish → measure`（年约 1500 篇投三大信源）
这部分的目标是为了在本地coser或者Codex里面直接描述我要分析哪家公司，帮忙洗稿呀，就借助本地的AI数据库、数据清洗、提示词生成以及生成文章。

2. **Part B（上云承接）**：sync + 客户门户 + 可选官网增强信源
然后这些生成的内容会同步到云上展示，所以云上会有一个SaaS系统。

细节见主方案 §0.1 与全文。

## 演示账号（摸底用，勿写入客户知识库 JSON）

### 大泽 GEO
- http://geo.fjdaze.com/user/
- 账号：`dazegeo` / 密码：`dazegeo1234`

### 摘星
- https://geo.zxaigc.com/login
- 用户名：`18056013750` / 密码：`12345678`

### 掌心后台（测试）
- http://ai.zxingo.com/?auth=MWE4YUdzLzhISTFzbzJzSDFjUW94ZktEbnRRTWFGcE1JODVKRnAyNEFWd1hNNzVxdFRoV29EUTRTMEc4eDE3SC9CVDBKQWRxR0IyNHV6YUU2V0ZoalhUanIyemlqS3ZoQWRxQjVhSGYxQjVk
