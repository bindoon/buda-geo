# AGENTS.md — 防错手册（非架构说明书）

主方案见 `docs/紫驰-GEO工具详细解决方案.md`。此处只写**读代码也容易做错**的约定。

## 目录与数据

- 客户工作区是 `projects/{项目名}/`，**不是** `clients/`。
- `projects/*/inputs/` **只读**：清洗产物写到 `knowledge/`、`assets/`、`manifest.json` 等，不要改原件。
- 发布通道只有三大权威信源 + 可选官网：`social` | `media` | `b2b` | `site`。不要为凑量往未评级站群发。

## 安全（必守）

- ❌ 不要把媒体账号**密码**、Token 写入任何 `knowledge/*.json`。
- ✅ 密码进 `projects/{名}/.secrets.env`（已被 gitignore）或环境变量。
- ❌ 法人身份证**不要**复制进 `assets/`、不要 OCR 进 JSON、不要写进文章。用途仅是五大自媒体企业实名（百家号/搜狐/头条/抖音图文/知乎）。
- ❌ 演示账号口令只在根 `README.md` 摸底备注；不要拷进客户知识库。

## 清洗 / Schema

- 允许字段缺失，但必须写入 `manifest.missing`，并带 `block` | `recommend` | `optional`。
- **`company.baseinfo.json` = 名片**（电话/地址/店铺/账号）；**`company.profile.json` = 介绍文案**（intro/产品服务/优势/背书）。二者不要混；画像里不要再写联系方式。
- 无客服记录 → `recommend`（`chat_logs`），**不阻断** clean 确认。
- 配图先本地 `path`（`assets/images/...`）；`url`/OSS 仅在发文需要 CDN 时再做。
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

## 进行中的 OpenSpec

- 企业事实清洗：`openspec/changes/rebuild-enterprise-fact-cleaning/`。
- 基线诊断：`openspec/changes/add-baseline-geo-diagnosis/`。
- 客户问题与购买场景：`openspec/changes/add-customer-question-scenarios/`。





数据部分：
河北仁丹药业有限公司  才合作不久 没有啥询盘记录。 
南通市海门华远工具厂  也同样没有

建议用：晶铭服饰 作为样板。
