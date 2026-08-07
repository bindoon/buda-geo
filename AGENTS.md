# AGENTS.md — 防错手册（非架构说明书）

主方案见 `docs/紫驰-GEO工具详细解决方案.md`。此处只写**读代码也容易做错**的约定。

最终设计的目标需要考虑到二期的 SaaS，会建立线上数据库，所以一期就要考虑到数据结构未来如何存储。

## 目录与数据

- 客户工作区是 `projects/{项目名}/`，**不是** `clients/`。
- `projects/*/inputs/` **只读**：清洗产物写到 `knowledge/`、`assets/`、`manifest.json` 等，不要改原件。
- 发布通道只有三大权威信源 + 可选官网：`social` | `media` | `b2b` | `site`。不要为凑量往未评级站群发。

## 安全（必守）

- ❌ 不要把媒体账号**密码**、Token 写入任何 `knowledge/*.json`。
- ✅ 密码进 `projects/{名}/.secrets.env`（已被 gitignore）或环境变量。
- ❌ 法人身份证**不要**复制进 `assets/`、不要 OCR 进 JSON、不要写进文章。用途仅是五大自媒体企业实名（百家号/搜狐/头条/抖音图文/知乎）。
- ❌ 营业执照、商标证、许可证图片和平台注册材料也只保留在原始 `inputs/`：不要复制、OCR、转成事实或恢复已删除的 `company.evidence.json` / `_trust`。
- ❌ 演示账号口令只在根 `README.md` 摸底备注；不要拷进客户知识库。

## 清洗 / Schema

- 允许字段缺失，但必须写入 `manifest.missing`，并带 `block` | `recommend` | `optional`。
- **`company.baseinfo.json` = 名片**（电话/地址/店铺/账号）；**`company.profile.json` = 介绍文案**（intro/产品服务/优势/背书）。二者不要混；画像里不要再写联系方式。
- 无客服记录 → `recommend`（`chat_logs`），**不阻断** clean 确认。
- 配图先本地 `path`（`assets/images/...`）；`url`/OSS 仅在发文需要 CDN 时再做。
- ❌ 不要把图片创建成 `company.facts.json` 的 subject 或 `path` fact；原图追溯在 `source-index.json`，产品配图关系在 `company.skus.json.images`。
- ✅ 普通用户从项目根 `clean-review.md` 确认；Skill 语义问题持久化到 `clean.overrides.json.review_notes`，不要让用户读 Facts JSON。
- `app_id` 必须在各 `company.*.json` 与 `manifest.json` 一致。

## Skill vs CLI

- 语义装填（docx 画像、SKU 归桶、人话缺失）走 **`skills/zichi-geo`**（`.cursor/skills/zichi-geo` 软链）。
- 表解析、inventory、validate 走 **`packages/geo-cli`**（Node.js，`geo-cli`）。
- **客户名单**在 `projects/registry.json`，用 `geo-cli projects list` / `resolve`；**不要**写进 Skill 正文。
- Skill 应调用 `geo-cli`，不要在对话里手搓校验规则。

## 研发对标 vs 最终交付

- `docs/各GEO平台资料/`、演示账号和竞品术语仅供**开发阶段研究**；不是运行时输入、输出格式或集成目标。
- ❌ 不要在发布用 Skill、CLI、Schema、客户产物中出现大泽/摘星/掌心/荟信专用路由或导出适配器，也不要向竞品提交客户数据。
- ✅ 把对标结论抽象成紫驰自己的通用事实、诊断、场景、内容和发布方法；研发说明写在 `docs/`、OpenSpec 或本文件。
- 最终运行交付面只有 `packages/geo-cli`、`skills/zichi-geo` 和 `projects/{项目名}/` 目录契约；`docs/`、`openspec/`、竞品资料不应成为运行时依赖。
- SaaS 首期只同步展示本地产物；把清洗/诊断/场景/内容能力迁到 SaaS 属后续独立阶段，禁止提前维护两套生产逻辑。
- ❌ 不要从 confirmed 场景直接写文章；✅ 先确认 `manifest.gates.content_plan`，下游只读取 approved 的 `ready | research_only` planned tasks。
- 内容计划复核以 `strategy/content-plan-review.md` 的 Topic bundle 为用户入口，必须展示实际事实内容；不要让普通用户只看 Fact ID 或底层 JSON。
- 文章生成必须先 `article prepare`，Agent 只读目标 brief 的 allowlist facts 与 `allowed_images`，正文用本地 `assets/images/...` 相对路径插图，再用 `article ingest` 落盘；❌ 不要直接从整个 knowledge 或场景库自由写文章，也不要外链或上传 OSS。
- `article ingest` 只产生 `draft + requires_human_review`；❌ 不要在生成阶段写 approved/queued/published，也不要创建发布回执。
- 文章批准必须有五项 assessment 且绑定当前正文 SHA-256；revision 后必须重审。❌ 不要把 approved 解释为已经发布。

## 进行中的 OpenSpec

- 企业事实清洗：`openspec/changes/archive/2026-08-07-rebuild-enterprise-fact-cleaning/`（已归档）。
- 基线诊断：`openspec/changes/add-baseline-geo-diagnosis/`（已完成待归档）。
- 客户问题与购买场景：`openspec/changes/archive/2026-08-07-add-customer-question-scenarios/`（已归档）。
- 内容规划：`openspec/changes/archive/2026-08-07-add-content-planning-workflow/`（已归档）。
- 文章草稿生成：`openspec/changes/archive/2026-08-07-add-article-generation-workflow/`（已归档）。
- 文章审稿：`openspec/changes/archive/2026-08-07-add-article-review-workflow/`（已归档）。





数据部分：
河北仁丹药业有限公司  才合作不久 没有啥询盘记录。 
南通市海门华远工具厂  也同样没有

建议用：晶铭服饰 作为样板。
