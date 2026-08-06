---
name: zichi-geo
description: >
  紫驰 GEO 本地交付总路由：解析客户项目，并按企业事实清洗、基线诊断、客户问题与购买场景、三平台导出、内容规划、文章生成/审稿、发布、复测优化和 SaaS 同步分阶段执行。
  用户提到 GEO、知识库、信息收集表、clean、validate、geo-cli、诊断报告、关键词/场景词、画像、转化目标、内容计划、写文章、发布、复测、上云或任意客户项目时使用。
---

# zichi-geo

将本文件只作为**总路由**。每次确定当前阶段后，只加载该阶段 reference；不要一次读完所有文件，也不要跨过人工确认门。

客户工作区为 `projects/{项目名}/`；客户名单只在 `projects/registry.json`，不得写入 Skill 或通用 CLI。

## 0. 每次先锁定项目

1. 读取仓库根 `AGENTS.md`。
2. 用户给出项目路径时直接使用。
3. 用户给出公司名、简称或 `app_id` 时，按 `references/project-resolution.md` 运行 `geo-cli projects resolve`。
4. 用户未说明项目时，运行 `geo-cli projects list` 并只问一句。

## 总流程

| 阶段 | 要解决的问题 | 必读 reference | 当前状态 | 完成标志 |
|---|---|---|---|---|
| 1 企业事实清洗 | 原始 Excel/Word/图片里有哪些可信企业事实 | `clean-enterprise.md` | 已实现 | confirmed `fact_snapshot_id` |
| 2 基线诊断 | AI 当前是否理解、提及、推荐企业 | `diagnose-baseline.md` | 已规划 | confirmed diagnosis run/report |
| 3 需求场景库 | 谁为什么问、怎样问、企业凭什么回答 | `build-demand-scenarios.md` | 已规划 | confirmed scenario library version |
| 4 三平台导出 | 同一场景如何映射为各平台术语 | `export-platform-views.md` | 已规划 | versioned local exports |
| 5 内容规划 | 哪些场景变成 FAQ、选题、Prompt 和生产任务 | `plan-content.md` | 占位 | confirmed content plan version |
| 6 文章生成 | 如何依据任务与事实生成草稿 | `generate-articles.md` | 占位 | article `draft` |
| 7 人工审稿 | 草稿是否事实正确、合规、适合渠道 | `review-articles.md` | 占位 | article `approved` |
| 8 发布 | 已批准稿件发到哪里并如何留回执 | `publish-articles.md` | 占位 | idempotent publish receipt |
| 9 复测迭代 | 发布后可见度怎样变化、下一轮补什么 | `measure-and-iterate.md` | 占位 | new diagnosis gaps / iteration plan |
| 10 SaaS 同步 | 哪些本地结果同步到只读门户 | `sync-saas.md` | Part B 占位 | sync receipt |

阶段 4 是阶段 3 的派生导出，不反向修改通用场景。若当前项目不需要第三方平台导出，可跳过阶段 4，进入内容规划。

## 路由规则

- 用户说“清洗、建知识库、validate、onboard” → 阶段 1。
- 用户说“诊断、生成诊断报告、看 AI 是否推荐” → 先确认阶段 1 已完成，再进入阶段 2。
- 用户说“关键词、场景词、用户会怎么问、画像、转换/转化目标” → 先检查诊断 gate，再进入阶段 3；只有明确要求平台格式时再进入阶段 4。
- 用户说“选题、FAQ、Prompt、写作计划、配额” → 阶段 5。
- 用户说“写文章、今日发文” → 阶段 6；生成后进入阶段 7，不直接发布。
- 用户说“审稿、批准” → 阶段 7。
- 用户说“发布、投放” → 阶段 8；外部写入必须有明确授权。
- 用户说“复测、周报、优化下一轮” → 阶段 9。
- 用户说“同步上云、客户门户” → 阶段 10。
- 用户只说“继续” → 读取 `manifest.json` 与现有阶段产物，选择第一个未完成 gate，不凭猜测跳步。

若 reference 标记为“占位/尚未实现”，只能据此完善规格或实现该阶段；不得伪造 CLI、产物、探测、发布或同步结果。

## 阶段 1 特别规则

清洗时读取：

1. `references/clean-enterprise.md`：完整五阶段方法，已包含“企业名片 vs 企业介绍”规则。
2. `references/schema-knowledge.md`：事实、证据、业务视图和快照 Schema。
3. `references/operator-report.md`：提交人工确认前的业务汇报模板。

Skill 与 CLI 的边界：

- CLI 负责文件发现、确定性解析、哈希、稳定 ID、override 执行、Schema/引用/安全校验。
- Skill 负责产品归并、长文语义拆分、主产品、属性/能力/卖点候选和证据支持范围。
- 把项目专属判断写入 `knowledge/clean.overrides.json`；禁止把客户名、目录名或具体 SKU 写入 CLI。
- 用户明确确认企业事实后才运行 `geo-cli confirm-clean --project {PROJECT}`。

## 全流程硬规则

- `inputs/` 只读；产物写入项目内 `knowledge/`、`assets/`、`diagnosis/`、`strategy/`、`articles/`、`publish/` 等阶段目录。
- 密码、Token 只进环境变量或 `.secrets.env`；法人身份证不复制、不 OCR、不进 JSON/文章。
- `public` 事实才可进入公开内容；restricted/internal 资料不用于平台导出、文章或发布。
- 无客服/询盘记录是建议项，不阻断企业事实或场景确认。
- clean 不创建或刷新关键词、FAQ、Prompt、generation plan、诊断题、文章或配额。
- 每一阶段消费上一阶段的**已确认版本**，新变化创建新版本，不覆盖历史确认快照。

## Reference 索引

| 文件 | 用途 |
|---|---|
| `project-resolution.md` | 项目解析与新客户 onboard |
| `clean-enterprise.md` | 企业事实清洗与名片/介绍分桶 |
| `schema-knowledge.md` | 清洗事实层 Schema |
| `operator-report.md` | 清洗确认前运营汇报 |
| `diagnose-baseline.md` | 基线种子题、probe、指标与诊断报告 |
| `build-demand-scenarios.md` | 平台无关的客户问题与购买场景库 |
| `export-platform-views.md` | 大泽、摘星、掌心/荟信派生视图 |
| `plan-content.md` | FAQ、选题、Prompt 与生产计划 |
| `generate-articles.md` | 文章草稿生成 |
| `review-articles.md` | 人工审稿与批准 |
| `publish-articles.md` | 发布适配与回执 |
| `measure-and-iterate.md` | GEO 复测与下一轮优化 |
| `sync-saas.md` | Part B SaaS 同步 |
